import type { EvalExpectations } from './case.js';
import type { NeverAsk } from './case.js';
import { z } from 'zod';

type Expectations = z.infer<typeof EvalExpectations>;
type TicketAssertions = NonNullable<Expectations['ticket']>;

/**
 * Patterns that mean "the agent asked for something it already had".
 *
 * Deliberately matched against interrogative phrasing rather than bare
 * keywords: the agent is *supposed* to say the caller's name and may confirm
 * their department back to them. "Hi Priya" and "I have you as Priya Raman in
 * Finance" must both pass, while "what's your name" must not.
 *
 * This is a deterministic stand-in for a judge, so it will miss an unusual
 * phrasing. That is an acceptable trade: a false negative here is one escaped
 * case, whereas depending on a judge for a hard-fail metric makes the
 * per-push suite non-deterministic.
 */
const IDENTITY_PATTERNS: Record<NeverAsk, RegExp[]> = {
  name: [
    /\b(what|may i (have|take|ask)|can i (have|take|get)|could i (have|take|get))\b[^?]{0,40}\byour\s+(full\s+)?name\b/i,
    /\bwho\s+am\s+i\s+(speaking|talking)\s+(to|with)\b/i,
    /\bwhat('s| is)\s+your\s+name\b/i,
    /\byour\s+name,?\s+please\b/i,
  ],
  email: [
    /\b(what|which|confirm|remind me of)\b[^?]{0,40}\byour\s+e-?mail\b/i,
    /\bwhat('s| is)\s+your\s+e-?mail\b/i,
    /\be-?mail\s+address\s+should\s+i\s+use\b/i,
  ],
  department: [
    /\b(what|which)\b[^?]{0,40}\b(department|team|business unit)\b[^?]{0,40}\b(are|do)\s+you\b/i,
    /\bwhich\s+(department|team)\s+are\s+you\s+in\b/i,
    /\bwhat\s+(department|team)\s+(are|do)\s+you\b/i,
  ],
  location: [
    /\b(what|which|where)\b[^?]{0,40}\b(office|site|building|floor|location)\b[^?]{0,30}\b(are|do)\s+you\b/i,
    /\bwhich\s+(office|site|building|floor)\b[^?]{0,20}\b(are|from)\b/i,
    /\bwhere\s+are\s+you\s+(based|located|calling\s+from)\b/i,
    /\bwhat\s+floor\s+are\s+you\s+on\b/i,
  ],
  employee_id: [
    /\b(employee|staff|payroll|personnel)\s+(id|number|reference)\b/i,
  ],
  phone: [
    /\b(what|which|best)\b[^?]{0,40}\b(phone|telephone|mobile|contact)\s+number\b/i,
    /\bnumber\s+to\s+reach\s+you\b/i,
  ],
};

/** Which identity fields, if any, the agent asked the caller to supply. */
export function asksForIdentity(text: string): NeverAsk[] {
  const asked: NeverAsk[] = [];

  for (const [field, patterns] of Object.entries(IDENTITY_PATTERNS)) {
    if (patterns.some((p) => p.test(text))) asked.push(field as NeverAsk);
  }
  return asked;
}

/**
 * How many questions the agent asked.
 *
 * Counts question marks rather than turns, so a compound
 * "when did it start? and is anyone else affected?" counts as two — which is
 * the whole point of EV-Q-04.
 */
export function countQuestions(agentTurns: readonly string[]): number {
  return agentTurns.reduce((total, turn) => total + (turn.match(/\?/g)?.length ?? 0), 0);
}

/** Reads a dotted path, distinguishing a null value from an absent one. */
export function readPath(value: unknown, path: string): unknown {
  let current = value;

  for (const key of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export interface ToolExpectations {
  toolsCalled: readonly string[];
  toolsNotCalled: readonly string[];
  toolCallCounts: Readonly<Record<string, number>>;
}

/**
 * Checks tool usage against a case.
 *
 * `calls` is the ordered list of tool names as they fired, not a set, because
 * "create_ticket was called" and "create_ticket was called once" are different
 * claims and only the second one catches EV-ROB-03.
 */
export function checkTools(
  calls: readonly string[],
  expected: ToolExpectations,
): string[] {
  const failures: string[] = [];
  const count = (name: string) => calls.filter((c) => c === name).length;

  for (const name of expected.toolsCalled) {
    if (count(name) === 0) failures.push(`expected ${name} to be called, it was not`);
  }

  for (const name of expected.toolsNotCalled) {
    const n = count(name);
    if (n > 0) failures.push(`expected ${name} NOT to be called, it was called ${n}x`);
  }

  for (const [name, want] of Object.entries(expected.toolCallCounts)) {
    const got = count(name);
    if (got !== want) failures.push(`expected ${name} to be called ${want}x, got ${got}x`);
  }

  return failures;
}

/** Checks the filed ticket against a case's assert_ticket block. */
export function checkTicket(
  ticket: unknown,
  expected: TicketAssertions,
): string[] {
  const asserts =
    Object.keys(expected.fields).length +
    expected.descriptionMentions.length +
    expected.descriptionExcludes.length;

  if (ticket === null || ticket === undefined) {
    // A case that asserts on a ticket and got none has failed, not passed.
    return asserts > 0 ? ['no ticket was created, but the case asserts on one'] : [];
  }

  const failures: string[] = [];

  for (const [path, want] of Object.entries(expected.fields)) {
    const got = readPath(ticket, path);
    if (!Object.is(got, want)) {
      failures.push(`${path}: expected ${render(want)}, got ${render(got)}`);
    }
  }

  const description = String(readPath(ticket, 'description') ?? '').toLowerCase();

  for (const needle of expected.descriptionMentions) {
    if (!description.includes(needle.toLowerCase())) {
      failures.push(`description should mention "${needle}"`);
    }
  }

  for (const needle of expected.descriptionExcludes) {
    if (description.includes(needle.toLowerCase())) {
      failures.push(`description should not mention "${needle}"`);
    }
  }

  return failures;
}

const render = (value: unknown): string =>
  value === undefined ? 'undefined' : JSON.stringify(value);
