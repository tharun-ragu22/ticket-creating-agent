import { parseArgs } from 'node:util';
import { loadCorpus } from './loader.js';
import { renderScorecard } from './report.js';
import { createRunner } from './runner.js';
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

  const model = process.env['EVAL_LLM_MODEL']?.trim() || 'google/gemini-2.5-flash';
  if (!process.env['LIVEKIT_API_KEY']) {
    console.error(
      '\nLIVEKIT_API_KEY is not set. The eval gate calls a real model through the\n' +
        'LiveKit Inference gateway; run with `node --env-file=.env` or export the\n' +
        'credentials.\n',
    );
    return 2;
  }

  const runner = createRunner({ model });
  const outcomes: CaseOutcome[] = [];

  process.stderr.write(`Running ${corpus.cases.length} case(s) against ${model}\n`);

  for (const testCase of corpus.cases) {
    try {
      const outcome = await runner.run(testCase);
      outcomes.push(outcome);
      process.stderr.write(`  ${outcome.passed ? 'pass' : 'FAIL'}  ${testCase.id}\n`);
    } catch (cause) {
      // One case blowing up must not lose the other fifty results.
      outcomes.push({
        id: testCase.id,
        group: testCase.group,
        passed: false,
        failures: [`threw: ${cause instanceof Error ? cause.message : String(cause)}`],
        identityAsked: [],
        questionsAsked: 0,
        reporterSubject: null,
        expectedReporterSubject: testCase.caller,
        fabricatedAssetIdentifier: false,
        createdWithoutConfirmation: false,
        expectedCategory: null,
        actualCategory: null,
        expectedPriority: null,
        actualPriority: null,
      });
      process.stderr.write(`  ERROR ${testCase.id}\n`);
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
