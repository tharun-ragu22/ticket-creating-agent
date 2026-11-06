import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { EvalCase, EvalGroup, type EvalGroup as Group } from './case.js';

const SCENARIOS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../scenarios');

export interface Corpus {
  cases: EvalCase[];
  /** Validation failures, kept rather than thrown so one bad file is visible. */
  errors: string[];
}

export interface LoadOptions {
  group?: string;
  caseId?: string;
  /** Only the deterministic subset that also runs as a tier-5 test. */
  t5Only?: boolean;
}

/**
 * Reads the scenario corpus off disk.
 *
 * Validation errors are collected rather than thrown so that `pnpm eval`
 * reports every malformed case at once; a filter that matches nothing does
 * throw, because a gate that silently runs zero cases always passes.
 */
export function loadCorpus(options: LoadOptions = {}): Corpus {
  const cases: EvalCase[] = [];
  const errors: string[] = [];

  const files = readdirSync(SCENARIOS_DIR)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .sort();

  for (const file of files) {
    let raw: unknown;
    try {
      raw = parse(readFileSync(join(SCENARIOS_DIR, file), 'utf8'));
    } catch (cause) {
      // A syntax error in one file must not hide the other fifty cases, and
      // the gate still fails because errors is non-empty.
      errors.push(`${file}: ${cause instanceof Error ? cause.message : 'unparseable'}`);
      continue;
    }

    if (!Array.isArray(raw)) {
      errors.push(`${file}: expected a list of cases at the top level`);
      continue;
    }

    for (const [index, entry] of raw.entries()) {
      const parsed = EvalCase.safeParse(entry);
      if (parsed.success) {
        cases.push(parsed.data);
      } else {
        const id = (entry as { id?: string } | null)?.id ?? `#${index}`;
        errors.push(
          `${file} ${id}: ${parsed.error.issues
            .map((i) => `${i.path.join('.')} ${i.message}`)
            .join('; ')}`,
        );
      }
    }
  }

  const duplicates = cases
    .map((c) => c.id)
    .filter((id, i, all) => all.indexOf(id) !== i);
  if (duplicates.length > 0) {
    errors.push(`duplicate case ids: ${[...new Set(duplicates)].join(', ')}`);
  }

  return { cases: applyFilters(cases, options), errors };
}

function applyFilters(cases: EvalCase[], options: LoadOptions): EvalCase[] {
  let filtered = cases;

  if (options.group !== undefined) {
    const group = EvalGroup.safeParse(options.group);
    if (!group.success) {
      throw new Error(
        `Unknown eval group "${options.group}". Valid groups: ${EvalGroup.options.join(', ')}.`,
      );
    }
    filtered = filtered.filter((c) => c.group === (group.data as Group));
  }

  if (options.caseId !== undefined) {
    filtered = filtered.filter((c) => c.id === options.caseId);
    if (filtered.length === 0) {
      throw new Error(`Unknown eval case "${options.caseId}".`);
    }
  }

  if (options.t5Only) filtered = filtered.filter((c) => c.t5);

  return filtered;
}
