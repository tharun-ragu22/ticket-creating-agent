import { describe, it, expect } from 'vitest';
import { loadCorpus } from './loader.js';
import { validateT5 } from './case.js';

const corpus = loadCorpus();

/**
 * The corpus is the behavioural specification for the agent, so these tests
 * are about the spec itself staying coherent — not about the agent, which
 * does not exist yet.
 */
describe('the eval corpus', () => {
  it('loads and validates every scenario file', () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(45);
    expect(corpus.errors).toEqual([]);
  });

  it('has no duplicate ids', () => {
    const ids = corpus.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * The catalogue in the plan is the contract. If a case is dropped, the
   * agent silently stops being held to a requirement — which is exactly the
   * drift the corpus exists to prevent.
   */
  it('contains every case the plan enumerates', () => {
    const required = [
      'EV-ID-01', 'EV-ID-02', 'EV-ID-03', 'EV-ID-04', 'EV-ID-05', 'EV-ID-06',
      'EV-CAT-01', 'EV-CAT-02', 'EV-CAT-03', 'EV-CAT-04', 'EV-CAT-05',
      'EV-CAT-06', 'EV-CAT-07', 'EV-CAT-08', 'EV-CAT-09',
      'EV-PRI-01', 'EV-PRI-02', 'EV-PRI-03', 'EV-PRI-04', 'EV-PRI-05', 'EV-PRI-06',
      'EV-Q-01', 'EV-Q-02', 'EV-Q-03', 'EV-Q-04', 'EV-Q-05',
      'EV-CONF-01', 'EV-CONF-02', 'EV-CONF-03', 'EV-CONF-04',
      'EV-CONF-05', 'EV-CONF-06', 'EV-CONF-07',
      'EV-ASSET-01', 'EV-ASSET-02', 'EV-ASSET-03', 'EV-ASSET-04',
      'EV-DUP-01', 'EV-DUP-02', 'EV-DUP-03',
      'EV-MULTI-01', 'EV-SCOPE-01', 'EV-SCOPE-02', 'EV-SCOPE-03', 'EV-SCOPE-04',
      'EV-ROB-01', 'EV-ROB-02', 'EV-ROB-03', 'EV-ROB-04',
      'EV-ROB-05', 'EV-ROB-06', 'EV-ROB-07', 'EV-ROB-08',
    ];

    const present = new Set(corpus.cases.map((c) => c.id));
    expect(required.filter((id) => !present.has(id))).toEqual([]);
  });

  it('covers all nine groups', () => {
    const groups = new Set(corpus.cases.map((c) => c.group));
    expect([...groups].sort()).toEqual([
      'assets', 'category', 'confirmation', 'dedupe', 'identity',
      'priority', 'questions', 'robustness', 'scope',
    ]);
  });

  /**
   * A judged case tagged t5 would make the per-push suite non-deterministic.
   * It then fails intermittently and someone disables the whole tier inside a
   * week, which is the documented failure mode of this plan.
   */
  it('has no t5 case that could only be judged', () => {
    expect(corpus.cases.flatMap(validateT5)).toEqual([]);
  });

  it('tags enough cases t5 to be a meaningful per-push gate', () => {
    expect(corpus.cases.filter((c) => c.t5).length).toBeGreaterThanOrEqual(20);
  });

  it('names only seeded callers', () => {
    expect(corpus.cases.every((c) => c.caller === 'priya' || c.caller === 'dave')).toBe(true);
  });

  /** Every identity case feeds a hard-fail metric, so none may be skippable. */
  it('asserts never-asks on the identity cases that carry the headline requirement', () => {
    const identity = corpus.cases.filter((c) => c.group === 'identity');
    expect(identity.length).toBeGreaterThanOrEqual(6);
    expect(
      identity.filter((c) => c.expect.neverAsks.length === 0 && !c.expect.ticket).map((c) => c.id),
    ).toEqual([]);
  });

  it('gives every case something to assert, so none can silently pass', () => {
    const empty = corpus.cases.filter(
      (c) =>
        c.expect.toolsCalled.length === 0 &&
        c.expect.toolsNotCalled.length === 0 &&
        Object.keys(c.expect.toolCallCounts).length === 0 &&
        c.expect.neverAsks.length === 0 &&
        !c.expect.ticket &&
        !c.expect.judge,
    );
    expect(empty.map((c) => c.id)).toEqual([]);
  });

  it('filters by group and by id, as the CLI needs', () => {
    expect(loadCorpus({ group: 'identity' }).cases.every((c) => c.group === 'identity')).toBe(true);
    expect(loadCorpus({ caseId: 'EV-CONF-05' }).cases.map((c) => c.id)).toEqual(['EV-CONF-05']);
  });

  it('reports an unknown filter rather than silently running nothing', () => {
    expect(() => loadCorpus({ caseId: 'EV-NOPE-99' })).toThrow(/EV-NOPE-99/);
    expect(() => loadCorpus({ group: 'nonsense' })).toThrow(/nonsense/);
  });
});
