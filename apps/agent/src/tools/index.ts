import { llm, log, type voice } from '@livekit/agents';
import { z } from 'zod';
import {
  CreateTicketInput,
  ProposeTicketToolInput,
  deriveIdempotencyKey,
  derivePriority,
  formatTicketRefForSpeech,
  renderReadback,
  type AffectedAsset,
  type CallEvent,
  type ProviderCallContext,
  type TicketDraft,
} from '@tca/contracts';
import type { CallUserData } from '../session/state.js';

/**
 * Narrows the run context's user data.
 *
 * llm.tool() takes its UserData as the first generic and the parameter schema
 * as the second, so naming UserData explicitly would stop the schema being
 * inferred and type every tool's args as empty. The tools are registered on an
 * AgentSession<CallUserData>, so this is the one place the narrowing happens.
 */
const callData = (ctx: { userData: unknown }): CallUserData => ctx.userData as CallUserData;

/**
 * Lazy references, because IntakeAgent and ConfirmAgent hand off to each other
 * and so cannot both be constructed first.
 */
export interface ToolDeps {
  confirmAgent: () => voice.Agent;
  intakeAgent: () => voice.Agent;
}

export function makeToolTable(deps: ToolDeps) {
  return {
    propose_ticket: makeProposeTicket(deps),
    create_ticket: makeCreateTicket(),
    amend_draft: makeAmendDraft(deps),
    cancel_ticket: makeCancelTicket(),
    lookup_known_assets: makeLookupKnownAssets(),
    comment_on_existing_ticket: makeCommentOnExisting(),
    end_call: makeEndCall(),
  };
}

// ── propose_ticket ──────────────────────────────────────────────────────────

function makeProposeTicket(deps: ToolDeps) {
  return llm.tool({
    name: 'propose_ticket',
    description:
      'Prepare a ticket summary to read back to the caller. This does NOT file ' +
      'anything. Call it once you understand the problem; you will then read the ' +
      'summary back and ask the caller to confirm before filing.',
    parameters: ProposeTicketToolInput,
    execute: async (args, { ctx }) => {
      const data = callData(ctx);

      const parsed = ProposeTicketToolInput.safeParse(args);
      if (!parsed.success) {
        // Tell the model what to fix rather than storing something unfilable.
        throw new llm.ToolError(
          `That draft is not valid: ${parsed.error.issues
            .map((i) => `${i.path.join('.')} ${i.message}`)
            .join('; ')}`,
        );
      }

      const draft: TicketDraft = {
        ...parsed.data,
        affectedAsset: groundAsset(parsed.data.affectedAsset, data),
        // Priority is derived, never accepted. The model has heard the caller
        // insist it is urgent; derivePriority has not, and takes only impact
        // and category, so there is no parameter for pressure to arrive through.
        priority: derivePriority(parsed.data.impact, parsed.data.category),
      };

      data.draft = { draft, proposedAt: new Date().toISOString() };
      await publish(data, { kind: 'ticket_draft', draft });

      // The read-back travels as the tool result so the confirmation agent
      // speaks it on entry rather than paraphrasing it.
      return llm.handoff({ agent: deps.confirmAgent(), returns: renderReadback(draft) });
    },
  });
}

/**
 * Drops an asset tag the caller does not actually own.
 *
 * The prompt already forbids inventing one; this is the guard for when the
 * model does it anyway. A fabricated tag is worse than none: it sends a
 * technician to the wrong machine (EV-ASSET-03, EV-ASSET-04).
 */
function groundAsset(asset: AffectedAsset | null, data: CallUserData): AffectedAsset | null {
  if (!asset?.identifier) return asset;

  const owned = data.profile.knownAssets.some((a) => a.identifier === asset.identifier);
  return owned ? asset : { ...asset, identifier: null };
}

// ── create_ticket ───────────────────────────────────────────────────────────

function makeCreateTicket() {
  return llm.tool({
    name: 'create_ticket',
    description:
      'File the proposed ticket. Only call this after you have read the summary ' +
      'back and the caller has clearly agreed. Takes no arguments: the caller and ' +
      'the summary are already known.',
    // No parameters at all, so there is no field through which a reporter,
    // an idempotency key or a different summary could be injected.
    execute: async (_args, { ctx }) => {
      const data = callData(ctx);

      // Layer 2 of the duplicate defence: in-memory short-circuit. "Create
      // fifty tickets for this" gets one ticket and the same reference back.
      if (data.createdTicket) {
        return spokenConfirmation(data.createdTicket.providerTicketId);
      }

      if (data.cancelled) {
        throw new llm.ToolError('The caller cancelled this ticket. Do not file it.');
      }

      // Layer 1, and the structural half of "propose before create": a draft
      // that was never read back has no proposedAt, so this cannot be reached
      // by the model deciding to skip the confirmation step.
      const proposed = data.draft;
      if (!proposed?.proposedAt) {
        throw new llm.ToolError(
          'No confirmed draft exists. Call propose_ticket first, read the summary ' +
            'back to the caller, and only file once they agree.',
        );
      }

      const transcriptRef = await data.transcript.save().catch(() => null);

      const input = CreateTicketInput.parse({
        ...proposed.draft,
        // Layer 1: derived from the call, so a worker restart recomputes the
        // same key and the API returns the existing ticket.
        idempotencyKey: deriveIdempotencyKey({
          roomName: data.source.roomName,
          callerSubject: data.profile.subject,
          startedAt: data.source.startedAt,
          draftSequence: data.draftSequence,
        }),
        reporter: {
          subject: data.profile.subject,
          displayName: data.profile.displayName,
          email: data.profile.email,
          department: data.profile.department,
          jobTitle: data.profile.jobTitle,
          location: data.profile.location,
          phone: data.profile.phone,
        },
        source: data.source,
        transcriptRef,
      });

      let ticket;
      try {
        ticket = await data.tickets.createTicket(input, providerCtx(data));
      } catch (cause) {
        await publish(data, {
          kind: 'ticket_failed',
          reason: cause instanceof Error ? cause.message : 'unknown error',
        });

        /*
         * Logged with the real cause, because the ToolError below deliberately
         * replaces it. Without this line the only trace of a failed filing is
         * the framework's "exception occurred while executing tool", carrying
         * the generic message — so "it ran into issues on the backend" is all
         * anyone ever sees, on the call and in the log, and the status code or
         * timeout that actually caused it is gone.
         */
        log().error(
          {
            err: cause,
            room: data.source.roomName,
            caller: data.profile.subject,
            idempotencyKey: input.idempotencyKey,
          },
          'filing the ticket failed',
        );

        // The worst failure mode of this product is telling a caller their
        // problem is logged when it is not. No reference number appears here,
        // and the cause is kept out of the model's view so it cannot be read
        // aloud to the caller.
        throw new llm.ToolError(
          'Filing the ticket failed. Tell the caller it did not go through and that ' +
            'they should try again shortly. Do not give them a reference number.',
        );
      }

      data.createdTicket = ticket;
      await publish(data, { kind: 'ticket_created', ticket });

      return spokenConfirmation(ticket.providerTicketId);
    },
  });
}

/**
 * The reference, spelled for speech.
 *
 * TTS reads "SI-10432" as something unrepeatable, and the caller is writing it
 * down. The exact string also goes to the app on the ticket_created event,
 * which is the real fix; this is the spoken fallback.
 */
const spokenConfirmation = (providerTicketId: string): string =>
  `Filed as ${formatTicketRefForSpeech(providerTicketId)}. ` +
  `Read that reference back to the caller one character at a time: ` +
  `${formatTicketRefForSpeech(providerTicketId)}. ` +
  `Then tell them what happens next and ask whether there is anything else. ` +
  `Do not end the call yet.`;

// ── amend_draft ─────────────────────────────────────────────────────────────

function makeAmendDraft(deps: ToolDeps) {
  return llm.tool({
    name: 'amend_draft',
    description:
      'The caller corrected something in the summary. Use this to go back and ' +
      'gather the correction, then propose again. Do not file and then fix.',
    parameters: z.object({
      correction: z.string().min(1).describe('What the caller said was wrong or different'),
    }),
    execute: async (args, { ctx }) => {
      const data = callData(ctx);

      if (data.createdTicket) {
        throw new llm.ToolError(
          `Ticket ${data.createdTicket.providerTicketId} is already filed and cannot be ` +
            'amended. Add a comment to it instead, or file a separate ticket.',
        );
      }

      // Dropped rather than merged. A half-corrected draft is how "it's the
      // printer, not the laptop" becomes a ticket mentioning both
      // (EV-CONF-03). draftSequence is untouched: this is still one ticket.
      data.draft = null;

      return llm.handoff({
        agent: deps.intakeAgent(),
        returns:
          `The caller corrected the summary: ${args.correction}. ` +
          'Ask only what you need to fix it, then call propose_ticket again.',
      });
    },
  });
}

// ── cancel_ticket ───────────────────────────────────────────────────────────

function makeCancelTicket() {
  return llm.tool({
    name: 'cancel_ticket',
    description:
      'The caller no longer wants a ticket filed. Drops the summary without filing.',
    execute: async (_args, { ctx }) => {
      const data = callData(ctx);

      data.draft = null;
      data.cancelled = true;

      return 'Nothing was filed. Confirm that to the caller and ask if there is anything else.';
    },
  });
}

// ── end_call ────────────────────────────────────────────────────────────────

function makeEndCall() {
  return llm.tool({
    name: 'end_call',
    description:
      'Hang up. Use it when the caller has said goodbye or said there is nothing ' +
      'else, or when they have stayed off topic across several turns despite being ' +
      'steered back. Filing a ticket is NOT a reason to hang up on its own: ask ' +
      'whether there is anything else and wait for the answer.',
    execute: async (_args, { ctx }) => {
      const data = callData(ctx);

      // A draft that was neither filed nor cancelled means the model is about
      // to hang up on a caller who thinks a ticket is being raised.
      if (data.draft && !data.createdTicket && !data.cancelled) {
        throw new llm.ToolError(
          'There is an unfiled ticket summary. Either file it after the caller ' +
            'confirms, or call cancel_ticket, before ending the call.',
        );
      }

      // drain, not close. The last thing the agent says is the reference read
      // one character at a time; closing without draining cuts that off and
      // leaves the caller with nothing to quote.
      ctx.session.shutdown({ drain: true, reason: 'user_initiated' });

      return 'Call ending.';
    },
  });
}

// ── lookup_known_assets ─────────────────────────────────────────────────────

function makeLookupKnownAssets() {
  return llm.tool({
    name: 'lookup_known_assets',
    description:
      "The equipment on the caller's record. Use it to offer their actual devices " +
      'by name instead of asking what they have.',
    execute: async (_args, { ctx }) => {
      // Reads state only. No network call, so it costs nothing and cannot
      // stall a turn.
      const data = callData(ctx);
      return { assets: data.profile.knownAssets };
    },
  });
}

// ── comment_on_existing_ticket ──────────────────────────────────────────────

function makeCommentOnExisting() {
  return llm.tool({
    name: 'comment_on_existing_ticket',
    description:
      'The caller is reporting something already covered by one of their open ' +
      'tickets. Append to that ticket instead of filing a duplicate.',
    parameters: z.object({
      providerTicketId: z
        .string()
        .min(1)
        .describe('Must be one of the open tickets listed in the caller context'),
      note: z.string().min(1).describe('What the caller added, in one or two sentences'),
    }),
    execute: async (args, { ctx }) => {
      const data = callData(ctx);

      // Grounded against the caller's own open tickets. Without this a
      // hallucinated reference would comment on a stranger's ticket.
      const known = data.profile.openTickets.some(
        (t) => t.providerTicketId === args.providerTicketId,
      );
      if (!known) {
        const list = data.profile.openTickets.map((t) => t.providerTicketId).join(', ');
        throw new llm.ToolError(
          `${args.providerTicketId} is not one of this caller's open tickets` +
            `${list ? ` (${list})` : ''}. Do not guess a reference; file a new ticket instead.`,
        );
      }

      await data.tickets.addComment(args.providerTicketId, args.note, providerCtx(data));
      return `Added to ${formatTicketRefForSpeech(args.providerTicketId)}.`;
    },
  });
}

// ── shared ──────────────────────────────────────────────────────────────────

const providerCtx = (data: CallUserData): ProviderCallContext => ({
  actor: {
    subject: data.profile.subject,
    email: data.profile.email,
    displayName: data.profile.displayName,
  },
  requestId: `call_${data.source.sessionId}`,
});

/**
 * A failed push to the app must never fail the tool: the ticket is the
 * deliverable and the card is a convenience.
 */
async function publish(data: CallUserData, event: CallEvent): Promise<void> {
  await data.events.publish(event).catch(() => undefined);
}
