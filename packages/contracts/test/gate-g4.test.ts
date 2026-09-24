/**
 * M01-G4: `v1` stays additive. The schemas generated from the registry are compared with
 * the schemas of the last release: the latest `v*` git tag when one exists, else the
 * committed snapshot `schemas/baseline/`. No schema or property may be removed, no type
 * or enum narrowed, no property newly required. Fixture pairs prove that every kind of
 * breaking change is detected, and the committed schema files must be fresh.
 */
import { recordGateMetrics } from '@argus/testkit';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { diffSchemaSets, exportJsonSchemas, type BreakingChange } from '../src/index.js';
import { BASELINE_DIR, SCHEMA_DIR, staleFiles } from '../scripts/export-schemas.js';
import { PACKAGE_DIR, readSchemaDir, schemaDiffCases } from './support/goldens.js';

/** The kinds the spec names: removed field, narrowed type, no new required field; plus removed schemas. */
const REQUIRED_KINDS = [
  'removed-property',
  'narrowed-type',
  'narrowed-enum',
  'new-required',
  'removed-schema',
];

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** Whether the package sits in a git work tree (a `git archive` export does not). */
function inGitRepository(): boolean {
  try {
    return git(['rev-parse', '--is-inside-work-tree']).trim() === 'true';
  } catch {
    return false;
  }
}

/** The latest release tag (`v*`, highest version first), or undefined. */
function latestReleaseTag(): string | undefined {
  const tags = git(['tag', '--list', 'v*', '--sort=-v:refname'])
    .split('\n')
    .filter((tag) => tag !== '');
  return tags[0];
}

function schemasAtTag(tag: string): Map<string, unknown> {
  const root = git(['rev-parse', '--show-toplevel']).trim();
  const relative = join(SCHEMA_DIR).slice(root.length + 1);
  const files = git(['ls-tree', '--name-only', `${tag}:${relative}`])
    .split('\n')
    .filter((file) => file.endsWith('.json'));
  return new Map(
    files.map((file) => [file, JSON.parse(git(['show', `${tag}:${relative}/${file}`])) as unknown]),
  );
}

const gitRepository = inGitRepository();
// Outside a work tree (a clean `git archive` build) no tag is visible: the snapshot applies.
const tag = gitRepository ? latestReleaseTag() : undefined;
const baseline = tag === undefined ? readSchemaDir(BASELINE_DIR) : schemasAtTag(tag);
const current = new Map(
  [...exportJsonSchemas()].map(([file, schema]) => [file, schema as unknown]),
);
let breaking: BreakingChange[] = [];
const cases = schemaDiffCases();
let detected = 0;
let additiveClean = true;
const kindsProven = new Set<string>();
let stale: string[] = [];

describe('M01-G4 additive-only schemas', () => {
  it(`finds no breaking change against ${tag ?? 'schemas/baseline'}`, () => {
    expect(baseline.size).toBeGreaterThan(0);
    breaking = diffSchemaSets(baseline, current);
    expect(breaking).toEqual([]);
  });

  it('publishes fresh schema files', () => {
    stale = staleFiles();
    expect(stale).toEqual([]);
  });

  it.each(cases.map((fixture) => [fixture.name, fixture] as const))(
    'fixture pair %s',
    (_name, fixture) => {
      const changes = diffSchemaSets(fixture.before, fixture.after);
      const kinds = [...new Set(changes.map((change) => change.kind))].sort();
      const expected = [...fixture.expectedKinds].sort();
      if (expected.length === 0) {
        if (changes.length > 0) additiveClean = false;
      } else if (JSON.stringify(kinds) === JSON.stringify(expected)) {
        detected++;
        expected.forEach((kind) => kindsProven.add(kind));
      }
      expect(kinds).toEqual(expected);
    },
  );

  it('proves every required kind of breaking change with a fixture pair', () => {
    for (const kind of REQUIRED_KINDS) {
      expect(cases.some((fixture) => fixture.expectedKinds.includes(kind))).toBe(true);
    }
  });
});

afterAll(() => {
  const breakingCases = cases.filter((fixture) => fixture.expectedKinds.length > 0).length;
  recordGateMetrics({
    baseline: tag === undefined ? 'schemas/baseline' : `tag:${tag}`,
    gitRepository,
    schemasCompared: baseline.size,
    breakingChanges: breaking.length,
    breakingList: breaking
      .slice(0, 20)
      .map((change) => `${change.file}${change.path} ${change.kind}: ${change.detail}`),
    fixtureCases: breakingCases,
    fixtureCasesDetected: detected,
    additiveCasesClean: additiveClean,
    requiredKindsMissing: REQUIRED_KINDS.filter((kind) => !kindsProven.has(kind)).length,
    committedSchemasFresh: stale.length === 0,
  });
});
