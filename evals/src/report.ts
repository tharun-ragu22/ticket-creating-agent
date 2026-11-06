import type { Scorecard } from './score.js';

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';
const RESET = '\u001b[0m';

/**
 * The scorecard, as text.
 *
 * Grouped so the four hard-fail metrics are read first and cannot be lost in
 * a column of percentages — a 2% category regression and a reporter leak must
 * not look alike.
 */
export function renderScorecard(card: Scorecard, options: { colour?: boolean } = {}): string {
  const colour = options.colour ?? process.stdout.isTTY === true;
  const c = (code: string, text: string) => (colour ? `${code}${text}${RESET}` : text);

  const lines: string[] = [''];

  const failedCases = card.cases.filter((o) => !o.passed);
  if (failedCases.length > 0) {
    lines.push(c(BOLD, 'Failed cases'));
    for (const outcome of failedCases) {
      lines.push(`  ${c(RED, '✗')} ${outcome.id}  ${c(DIM, outcome.group)}`);
      for (const failure of outcome.failures) lines.push(`      ${failure}`);
    }
    lines.push('');
  }

  for (const [heading, hardFail] of [
    ['Must hold (a regression blocks merge)', true],
    ['Quality thresholds', false],
  ] as const) {
    lines.push(c(BOLD, heading));

    for (const metric of card.metrics.filter((m) => m.hardFail === hardFail)) {
      const mark = metric.passed ? c(GREEN, '✓') : c(RED, '✗');
      const value =
        metric.value === null
          ? c(DIM, 'not exercised')
          : `${metric.value.toFixed(1)}%`.padStart(6) +
            c(DIM, ` (min ${metric.min}%, ${metric.applicable} case${metric.applicable === 1 ? '' : 's'})`);

      lines.push(`  ${mark} ${metric.label.padEnd(44)} ${value}`);
    }
    lines.push('');
  }

  lines.push(card.hardFailed ? c(RED, card.summary) : card.summary, '');
  return lines.join('\n');
}
