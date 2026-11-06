import type { z } from 'zod';
import type { EvalExpectations } from './case.js';

type Expectations = z.infer<typeof EvalExpectations>;
type TicketAssertions = NonNullable<Expectations['ticket']>;

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
