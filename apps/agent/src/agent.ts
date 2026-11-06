import { fileURLToPath } from 'node:url';
import {
  WorkerOptions,
  cli,
  defineAgent,
  log,
  metrics,
  voice,
  type JobContext,
} from '@livekit/agents';
import { TicketApiClient } from '@tca/ticket-providers';
import { AgentApiClient } from './api/agent-api.js';
import { createAgents } from './agents.js';
import { ApiTranscriptRecorder, NullEventSink, RoomEventSink } from './session/events.js';
import { createCallUserData, type CallEventSink, type CallUserData } from './session/state.js';
import { loadVoiceConfig, resolveInitializeProcessTimeout } from './voice/config.js';
import { buildVoiceStack } from './voice/stack.js';

/** The attribute the API puts on the caller's token. */
const CALLER_SUBJECT_ATTRIBUTE = 'caller.subject';

/** Console mode has no real caller, so it needs someone to be. */
const CONSOLE_SUBJECT = process.env['CONSOLE_CALLER_SUBJECT'] ?? 'priya';

export default defineAgent({
  /**
   * Loads the VAD model once per worker process rather than once per call.
   * Silero takes a second or two, which would otherwise be dead air at the
   * start of every conversation.
   */
  prewarm: async (proc) => {
    const { VAD } = await import('@livekit/agents-plugin-silero');
    proc.userData['vad'] = await VAD.load();
  },

  entry: async (ctx: JobContext) => {
    const config = loadVoiceConfig();

    // Connect first: doing it later shows up as a gap between the caller
    // joining and the agent being able to hear them.
    await ctx.connect();

    const api = new AgentApiClient({
      baseUrl: config.api.url,
      serviceToken: config.api.serviceToken,
    });
    const tickets = new TicketApiClient({
      baseUrl: config.api.url,
      serviceToken: config.api.serviceToken,
    });

    const subject = await resolveCallerSubject(ctx);
    const profile = await api.fetchProfile(subject);
    const schema = await tickets.describeSchema({
      actor: { subject, email: profile.email, displayName: profile.displayName },
      requestId: `job_${ctx.job.id}`,
    });

    const roomName = ctx.room.name ?? `console-${Date.now()}`;
    const startedAt = new Date().toISOString();

    const events: CallEventSink = ctx.room.localParticipant
      ? new RoomEventSink(ctx.room)
      : new NullEventSink();

    const userData: CallUserData = createCallUserData({
      profile,
      schema,
      tickets,
      events,
      source: { channel: 'voice', sessionId: ctx.job.id, roomName, startedAt },
      transcript: new ApiTranscriptRecorder((input) => api.saveTranscript(input), {
        roomName,
        sessionId: ctx.job.id,
        callerSubject: subject,
      }),
    });

    const stack = await buildVoiceStack(config);
    const session = new voice.AgentSession<CallUserData>({
      ...stack,
      vad: ctx.proc.userData['vad'] as never,
      userData,
      ttsTextTransforms: ['filter_markdown', 'filter_emoji'],
    });

    // Instrumented from the start: guessing at latency wastes days, and the
    // numbers only mean anything if they were collected from the beginning.
    const usage = new metrics.UsageCollector();
    session.on(voice.AgentSessionEventTypes.MetricsCollected, (event) => {
      metrics.logMetrics(event.metrics);
      usage.collect(event.metrics);
    });
    ctx.addShutdownCallback(async () => {
      log().info({ usage: usage.getSummary() }, 'call finished');
    });

    // Every turn is recorded so a filed ticket can carry what was said. A
    // handoff between agents is also a conversation item, and has no role or
    // text, so it is skipped rather than recorded as an empty turn.
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (event) => {
      const item = event.item as { role?: string; textContent?: string };
      const text = item.textContent;
      if (!item.role || !text) return;

      userData.transcript.record({
        role: item.role === 'user' ? 'caller' : 'agent',
        text,
        at: new Date().toISOString(),
      });
    });

    const { intake } = createAgents(userData);
    await session.start({ agent: intake, room: ctx.room });

    const firstName = profile.displayName.split(' ')[0] ?? profile.displayName;
    session.say(`Hi ${firstName}, it's the IT desk. What's going on?`);
  },
});

/**
 * Who is calling.
 *
 * Read from the participant attribute the API minted, never from anything the
 * client asked for: POST /v1/connection-details derives it from the verified
 * bearer token and ignores the request body's participant_attributes
 * entirely. Console mode has no participant, so it falls back to a seeded
 * subject.
 */
async function resolveCallerSubject(ctx: JobContext): Promise<string> {
  if (ctx.isFakeJob) return CONSOLE_SUBJECT;

  const participant = await ctx.waitForParticipant();
  const subject = participant.attributes[CALLER_SUBJECT_ATTRIBUTE]?.trim();

  if (!subject) {
    // Filing against an unidentified caller would produce a ticket nobody can
    // be contacted about, so refuse rather than guess.
    throw new Error(
      `Participant "${participant.identity}" has no ${CALLER_SUBJECT_ATTRIBUTE} attribute. ` +
        'Tokens must be minted by POST /v1/connection-details.',
    );
  }
  return subject;
}

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    // Naming the agent disables automatic dispatch, so the token's
    // roomConfig.agents[0].agentName must match this exactly or the agent
    // never joins a room.
    agentName: process.env['LIVEKIT_AGENT_NAME'] ?? 'ticket-agent',
    // prewarm loads Silero inside this window; the SDK's 10s default is not
    // enough on a loaded machine and the job then dies with "runner
    // initialization timed out", never reaching the room. Run
    // `pnpm --filter @tca/agent download-files` once so the model is cached
    // before the first call rather than fetched during it.
    initializeProcessTimeout: resolveInitializeProcessTimeout(),
  }),
);
