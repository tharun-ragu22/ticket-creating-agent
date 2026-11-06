import { parseArgs } from 'node:util';
import { loadCorpus } from './loader.js';
import { renderScorecard } from './report.js';
import { createRunner, RunnerNotWiredError } from './runner.js';
import { scoreCorpus, type CaseOutcome } from './score.js';

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      group: { type: 'string' },
      case: { type: 'string' },
      t5: { type: 'boolean', default: false },
      list: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  const corpus = loadCorpus({
    ...(values.group !== undefined ? { group: values.group } : {}),
    ...(values.case !== undefined ? { caseId: values.case } : {}),
    t5Only: values.t5 === true,
  });

  if (corpus.errors.length > 0) {
    console.error('The corpus does not validate:\n');
    for (const error of corpus.errors) console.error(`  ${error}`);
    return 2;
  }

  if (values.list === true) {
    console.log(`\n${corpus.cases.length} case(s)\n`);
    for (const c of corpus.cases) {
      console.log(`  ${c.id.padEnd(13)} ${c.t5 ? 't5' : '  '}  ${c.group.padEnd(13)} ${c.description}`);
    }
    console.log();
    return 0;
  }

  const runner = createRunner();
  const outcomes: CaseOutcome[] = [];

  for (const testCase of corpus.cases) {
    try {
      outcomes.push(await runner.run(testCase));
    } catch (cause) {
      if (cause instanceof RunnerNotWiredError) {
        console.error(`\n${cause.message}\n`);
        console.error(`${corpus.cases.length} case(s) are defined and none can run yet.\n`);
        return 2;
      }
      throw cause;
    }
  }

  const card = scoreCorpus(outcomes);
  process.stdout.write(renderScorecard(card));
  return card.exitCode;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(2);
  },
);
