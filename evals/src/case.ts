import { z } from 'zod';

export const EvalGroup = z.enum([
  'identity',
  'category',
  'priority',
  'questions',
  'confirmation',
  'assets',
  'dedupe',
  'scope',
  'robustness',
]);
export type EvalGroup = z.infer<typeof EvalGroup>;

/** Identity fields the agent already has and must therefore never ask for. */
export const NeverAsk = z.enum([
  'name',
  'email',
  'department',
  'location',
  'employee_id',
  'phone',
]);
export type NeverAsk = z.infer<typeof NeverAsk>;

export const EvalTurn = z.object({
  user: z.string().min(1),
  /** Seconds of silence after this turn, for the go-quiet cases. */
  silenceAfter: z.number().positive().optional(),
});

/**
 * Assertions on the ticket that came out.
 *
 * `fields` is a map of dotted path to expected value, so a case can pin
 * `impact.workBlocked` or `affectedAsset.identifier` without this schema
 * needing to know the ticket shape.
 */
export const TicketAssertions = z.object({
  fields: z.record(z.string(), z.unknown()).default({}),
  /** Substrings that must appear in the description, case-insensitively. */
  descriptionMentions: z.array(z.string()).default([]),
  /** Substrings that must NOT appear — chiefly a colleague named as reporter. */
  descriptionExcludes: z.array(z.string()).default([]),
});

export const EvalExpectations = z.object({
  toolsCalled: z.array(z.string()).default([]),
  toolsNotCalled: z.array(z.string()).default([]),
  /** Exact number of times a tool must fire. Keyed by tool name. */
  toolCallCounts: z.record(z.string(), z.number().int().nonnegative()).default({}),
  maxQuestions: z.number().int().positive().default(6),
  neverAsks: z.array(NeverAsk).default([]),
  judge: z.object({ intent: z.string().min(1) }).optional(),
  ticket: TicketAssertions.optional(),
});

export const EvalCase = z.object({
  id: z.string().regex(/^EV-[A-Z]+-\d{2}$/),
  group: EvalGroup,
  description: z.string().min(1),
  /** A seeded caller fixture. */
  caller: z.enum(['priya', 'dave']).default('priya'),
  /**
   * Whether this case is structural enough to also run as a deterministic
   * tier-5 test on every push, rather than only in the nightly scored gate.
   * A case needing a judge cannot be t5: judging is neither free nor stable.
   */
  t5: z.boolean().default(false),
  turns: z.array(EvalTurn).min(1),
  expect: EvalExpectations,
});
export type EvalCase = z.infer<typeof EvalCase>;

/**
 * A case marked t5 must be assertable without a judge.
 *
 * Enforced rather than documented because the failure is silent and slow: a
 * judged case tagged t5 makes the per-push suite non-deterministic, it starts
 * failing intermittently, and within a week someone disables the whole tier.
 */
export function validateT5(c: EvalCase): string[] {
  const problems: string[] = [];
  if (!c.t5) return problems;

  const structural =
    c.expect.toolsCalled.length > 0 ||
    c.expect.toolsNotCalled.length > 0 ||
    Object.keys(c.expect.toolCallCounts).length > 0 ||
    c.expect.neverAsks.length > 0 ||
    c.expect.ticket !== undefined;

  if (!structural) {
    problems.push(
      `${c.id} is tagged t5 but asserts nothing structural, so it would depend ` +
        'entirely on a judge.',
    );
  }
  return problems;
}
