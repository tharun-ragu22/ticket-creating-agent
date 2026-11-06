import { describe, it, expect } from 'vitest';
import { THRESHOLDS, priorityBandDistance, scoreCorpus, type CaseOutcome } from './score.js';

const outcome = (over: Partial<CaseOutcome> = {}): CaseOutcome => ({
  id: 'EV-CAT-01',
  group: 'category',
  passed: true,
  failures: [],
  identityAsked: [],
  questionsAsked: 3,
  reporterSubject: 'priya',
  expectedReporterSubject: 'priya',
  fabricatedAssetIdentifier: false,
  createdWithoutConfirmation: false,
  expectedCategory: 'software',
  actualCategory: 'software',
  expectedPriority: 'high',
  actualPriority: 'high',
  ...over,
});

describe('priorityBandDistance', () => {
  it('is zero for an exact match', () => {
    expect(priorityBandDistance('high', 'high')).toBe(0);
  });

  it('is one for an adjacent band', () => {
    expect(priorityBandDistance('high', 'urgent')).toBe(1);
    expect(priorityBandDistance('normal', 'low')).toBe(1);
  });

  it('is two or more for a distant band', () => {
    expect(priorityBandDistance('low', 'urgent')).toBe(3);
  });
});

describe('scoreCorpus thresholds', () => {
  it('passes a clean run', () => {
    const card = scoreCorpus([outcome(), outcome({ id: 'EV-CAT-02' })]);

    expect(card.hardFailed).toBe(false);
    expect(card.exitCode).toBe(0);
  });

  /**
   * The four hard-fail metrics are what make this safe to put in front of
   * real users. Any one of them blocks a merge regardless of the others, so
   * each gets its own test rather than being covered by one happy path.
   */
  it('hard-fails when the agent asked for identity it already had', () => {
    const card = scoreCorpus([outcome({ id: 'EV-ID-01', group: 'identity', identityAsked: ['email'] })]);

    expect(card.hardFailed).toBe(true);
    expect(card.exitCode).not.toBe(0);
    expect(card.metrics.find((m) => m.key === 'identityRequested')?.passed).toBe(false);
  });

  it('hard-fails on a fabricated asset identifier', () => {
    const card = scoreCorpus([outcome({ fabricatedAssetIdentifier: true })]);

    expect(card.hardFailed).toBe(true);
    expect(card.metrics.find((m) => m.key === 'fabricatedAsset')?.passed).toBe(false);
  });

  it('hard-fails when a ticket was created without confirmation', () => {
    const card = scoreCorpus([outcome({ createdWithoutConfirmation: true })]);

    expect(card.hardFailed).toBe(true);
    expect(card.metrics.find((m) => m.key === 'createdWithoutConfirmation')?.passed).toBe(false);
  });

  it('hard-fails when the reporter was not the authenticated caller', () => {
    const card = scoreCorpus([outcome({ reporterSubject: 'dave', expectedReporterSubject: 'priya' })]);

    expect(card.hardFailed).toBe(true);
    expect(card.metrics.find((m) => m.key === 'reporterCorrect')?.passed).toBe(false);
  });

  it('does not hard-fail on a missed category, which is a quality dial', () => {
    const card = scoreCorpus([
      outcome({ expectedCategory: 'email', actualCategory: 'software' }),
    ]);

    expect(card.hardFailed).toBe(false);
    expect(card.metrics.find((m) => m.key === 'categoryCorrect')?.passed).toBe(false);
    expect(card.exitCode).not.toBe(0);
  });

  it('scores category accuracy as a percentage of the cases that assert one', () => {
    const card = scoreCorpus([
      outcome({ expectedCategory: 'software', actualCategory: 'software' }),
      outcome({ id: 'EV-CAT-02', expectedCategory: 'email', actualCategory: 'software' }),
      // Asserts no category, so it must not dilute the denominator.
      outcome({ id: 'EV-Q-01', group: 'questions', expectedCategory: null, actualCategory: null }),
    ]);

    expect(card.metrics.find((m) => m.key === 'categoryCorrect')?.value).toBeCloseTo(50);
  });

  it('counts a one-band priority miss as within-band but not exact', () => {
    const card = scoreCorpus([outcome({ expectedPriority: 'high', actualPriority: 'urgent' })]);

    expect(card.metrics.find((m) => m.key === 'priorityWithinBand')?.value).toBe(100);
    expect(card.metrics.find((m) => m.key === 'priorityExact')?.value).toBe(0);
  });

  it('fails the question budget when a case exceeded it', () => {
    const card = scoreCorpus([outcome({ questionsAsked: 9 })]);

    expect(card.metrics.find((m) => m.key === 'questionBudget')?.passed).toBe(false);
  });

  /**
   * An empty run must not report a green scorecard. A gate that passes when it
   * ran nothing is worse than no gate, because it looks like evidence.
   */
  it('fails an empty run rather than reporting a perfect score', () => {
    const card = scoreCorpus([]);

    expect(card.exitCode).not.toBe(0);
    expect(card.summary).toMatch(/no cases/i);
  });

  it('reports a metric with no applicable cases as not-applicable, not as 100%', () => {
    const card = scoreCorpus([
      outcome({ group: 'questions', expectedCategory: null, actualCategory: null }),
    ]);

    const category = card.metrics.find((m) => m.key === 'categoryCorrect');
    expect(category?.applicable).toBe(0);
    expect(category?.passed).toBe(true);
    expect(category?.value).toBeNull();
  });

  it('exposes every threshold from the plan', () => {
    expect(THRESHOLDS.map((t) => t.key).sort()).toEqual([
      'categoryCorrect',
      'createdWithoutConfirmation',
      'fabricatedAsset',
      'identityRequested',
      'priorityExact',
      'priorityWithinBand',
      'questionBudget',
      'reporterCorrect',
    ]);
    expect(THRESHOLDS.filter((t) => t.hardFail).map((t) => t.key).sort()).toEqual([
      'createdWithoutConfirmation',
      'fabricatedAsset',
      'identityRequested',
      'reporterCorrect',
    ]);
  });
});
