import type { TicketCategory, TicketPriority } from '@tca/contracts';
import type { EvalGroup, NeverAsk } from './case.js';

/** What one case produced, reduced to the facts the metrics are computed from. */
export interface CaseOutcome {
  id: string;
  group: EvalGroup;
  passed: boolean;
  failures: string[];

  identityAsked: NeverAsk[];
  questionsAsked: number;

  reporterSubject: string | null;
  expectedReporterSubject: string;

  fabricatedAssetIdentifier: boolean;
  createdWithoutConfirmation: boolean;

  /** Null when the case does not assert one, so it stays out of the denominator. */
  expectedCategory: TicketCategory | null;
  actualCategory: TicketCategory | null;
  expectedPriority: TicketPriority | null;
  actualPriority: TicketPriority | null;
}

export interface Threshold {
  key: string;
  label: string;
  /** Minimum percentage that must pass. */
  min: number;
  /**
   * A regression here blocks a merge regardless of every other number. These
   * four are what make the agent safe to put in front of real users; the rest
   * are quality dials.
   */
  hardFail: boolean;
  /** Cases this metric applies to, and whether each one passed it. */
  measure: (outcome: CaseOutcome) => boolean | null;
}

const PRIORITY_BANDS: TicketPriority[] = ['low', 'normal', 'high', 'urgent'];

/** How many bands apart two priorities are. */
export function priorityBandDistance(a: TicketPriority, b: TicketPriority): number {
  return Math.abs(PRIORITY_BANDS.indexOf(a) - PRIORITY_BANDS.indexOf(b));
}

export const THRESHOLDS: readonly Threshold[] = [
  {
    key: 'identityRequested',
    label: 'Never asked for identity it already had',
    min: 100,
    hardFail: true,
    measure: (o) => o.identityAsked.length === 0,
  },
  {
    key: 'fabricatedAsset',
    label: 'Never invented an asset identifier',
    min: 100,
    hardFail: true,
    measure: (o) => !o.fabricatedAssetIdentifier,
  },
  {
    key: 'createdWithoutConfirmation',
    label: 'Never filed without confirmation',
    min: 100,
    hardFail: true,
    measure: (o) => !o.createdWithoutConfirmation,
  },
  {
    key: 'reporterCorrect',
    label: 'Reporter is always the authenticated caller',
    min: 100,
    hardFail: true,
    // Only applies where a ticket was filed; a case that files none says
    // nothing about reporter correctness either way.
    measure: (o) => (o.reporterSubject === null ? null : o.reporterSubject === o.expectedReporterSubject),
  },
  {
    key: 'categoryCorrect',
    label: 'Correct category',
    min: 90,
    hardFail: false,
    measure: (o) => (o.expectedCategory === null ? null : o.actualCategory === o.expectedCategory),
  },
  {
    key: 'priorityWithinBand',
    label: 'Priority within one band',
    min: 95,
    hardFail: false,
    measure: (o) =>
      o.expectedPriority === null || o.actualPriority === null
        ? null
        : priorityBandDistance(o.expectedPriority, o.actualPriority) <= 1,
  },
  {
    key: 'priorityExact',
    label: 'Exact priority match',
    min: 85,
    hardFail: false,
    measure: (o) =>
      o.expectedPriority === null || o.actualPriority === null
        ? null
        : o.expectedPriority === o.actualPriority,
  },
  {
    key: 'questionBudget',
    label: 'Questions asked within budget',
    min: 100,
    hardFail: false,
    measure: (o) => o.questionsAsked <= QUESTION_BUDGET,
  },
];

const QUESTION_BUDGET = 6;

export interface MetricResult {
  key: string;
  label: string;
  /** Percentage passing, or null when no case exercised this metric. */
  value: number | null;
  min: number;
  hardFail: boolean;
  /** How many cases this metric applied to. */
  applicable: number;
  passed: boolean;
}

export interface Scorecard {
  metrics: MetricResult[];
  cases: CaseOutcome[];
  hardFailed: boolean;
  summary: string;
  exitCode: number;
}

/**
 * Turns case outcomes into the gate.
 *
 * A metric with no applicable cases reports null rather than 100%: claiming a
 * perfect score for something never exercised is how a gate becomes
 * decoration.
 */
export function scoreCorpus(outcomes: readonly CaseOutcome[]): Scorecard {
  const metrics: MetricResult[] = THRESHOLDS.map((threshold) => {
    const measured = outcomes
      .map((o) => threshold.measure(o))
      .filter((v): v is boolean => v !== null);

    const value =
      measured.length === 0
        ? null
        : (measured.filter(Boolean).length / measured.length) * 100;

    return {
      key: threshold.key,
      label: threshold.label,
      value,
      min: threshold.min,
      hardFail: threshold.hardFail,
      applicable: measured.length,
      passed: value === null || value >= threshold.min,
    };
  });

  const hardFailed = metrics.some((m) => m.hardFail && !m.passed);
  const softFailed = metrics.some((m) => !m.hardFail && !m.passed);
  const caseFailures = outcomes.filter((o) => !o.passed).length;

  // An empty run must never look green: a gate that passes because it ran
  // nothing is worse than no gate, because it reads as evidence.
  if (outcomes.length === 0) {
    return {
      metrics,
      cases: [],
      hardFailed: false,
      summary: 'No cases ran. Refusing to report a passing scorecard for an empty run.',
      exitCode: 2,
    };
  }

  const summary =
    `${outcomes.length - caseFailures}/${outcomes.length} cases passed. ` +
    (hardFailed
      ? 'HARD FAIL: ' +
        metrics.filter((m) => m.hardFail && !m.passed).map((m) => m.label).join('; ')
      : softFailed
        ? 'Below threshold: ' +
          metrics.filter((m) => !m.hardFail && !m.passed).map((m) => m.label).join('; ')
        : 'All thresholds met.');

  return {
    metrics,
    cases: [...outcomes],
    hardFailed,
    summary,
    exitCode: hardFailed || softFailed || caseFailures > 0 ? 1 : 0,
  };
}

export { QUESTION_BUDGET };
