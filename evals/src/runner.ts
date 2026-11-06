import type { EvalCase } from './case.js';
import type { CaseOutcome } from './score.js';

/**
 * Runs one case against the agent.
 *
 * Unimplemented on purpose. The corpus is authored before the prompt exists
 * (phase 5) so that the specification cannot be quietly rewritten to match
 * whatever the model happened to produce; wiring it to a live AgentSession is
 * phase 6. Until then `pnpm eval` reports the corpus it would run and exits
 * non-zero, which is the honest state: 53 cases defined, none yet satisfied.
 */
export class RunnerNotWiredError extends Error {
  constructor() {
    super(
      'The eval runner is not wired to an agent yet (phase 6). The corpus is the ' +
        'specification; run `pnpm eval --list` to see it.',
    );
    this.name = 'RunnerNotWiredError';
  }
}

export interface Runner {
  run(testCase: EvalCase): Promise<CaseOutcome>;
}

export function createRunner(): Runner {
  return {
    run(): Promise<CaseOutcome> {
      return Promise.reject(new RunnerNotWiredError());
    },
  };
}
