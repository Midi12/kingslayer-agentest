/**
 * M01-G4: `v1` stays additive. The schemas generated from the registry are compared with
 * the schemas of the last release: the latest `v*` git tag when one exists, else the
 * committed snapshot `schemas/baseline/`. No schema or property may be removed, no type
 * or enum narrowed, no property newly required. Fixture pairs prove that every kind of
 * breaking change is detected, and the committed schema files must be fresh.
 *
 * Every version of the snapshot ever committed is compared too (gate change M01-1): a
 * commit that rewrites `schemas/baseline/` together with a breaking change still fails,
 * because the snapshot it replaced stays in the history.
 */
import { recordGateMetrics } from '@argus/testkit';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';
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
  return schemasAt(tag, repoPath(SCHEMA_DIR));
}

/**
 * The JSON files of a directory at a revision. `--full-tree` because `ls-tree` run from
 * a subdirectory lists only entries under it, even for a `<rev>:<path>` tree.
 */
function schemasAt(revision: string, path: string): Map<string, unknown> {
  const files = git(['ls-tree', '--full-tree', '--name-only', `${revision}:${path}`])
    .split('\n')
    .filter((file) => file.endsWith('.json'));
  return new Map(
    files.map((file) => [
      file,
      JSON.parse(git(['show', `${revision}:${path}/${file}`])) as unknown,
    ]),
  );
}

/** Every committed version of the snapshot, oldest first, keyed by commit. */
function committedBaselines(): { commit: string; schemas: Map<string, unknown> }[] {
  const path = repoPath(BASELINE_DIR);
  const commits = git(['log', '--reverse', '--format=%H', '--', `:(top)${path}`])
    .split('\n')
    .filter((commit) => commit !== '');
  return commits.flatMap((commit) => {
    let schemas: Map<string, unknown>;
    try {
      schemas = schemasAt(commit, path);
    } catch {
      return []; // the commit deleted the snapshot
    }
    return schemas.size === 0 ? [] : [{ commit, schemas }];
  });
}

/** Path relative to the repository root, in git's form. */
function repoPath(dir: string): string {
  const root = realpathSync(git(['rev-parse', '--show-toplevel']).trim());
  return relative(root, realpathSync(dir)).split(sep).join('/');
}

const gitRepository = inGitRepository();
// Outside a work tree (a clean `git archive` build) no tag is visible: the snapshot applies.
const tag = gitRepository ? latestReleaseTag() : undefined;
const baseline = tag === undefined ? readSchemaDir(BASELINE_DIR) : schemasAtTag(tag);
const current = new Map(
  [...exportJsonSchemas()].map(([file, schema]) => [file, schema as unknown]),
);
let breaking: BreakingChange[] = [];
const history = gitRepository ? committedBaselines() : [];
let historyBreaking: string[] = [];
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

  it('finds no breaking change against any committed version of schemas/baseline', () => {
    expect(history.length).toBeGreaterThan(0);
    historyBreaking = history.flatMap(({ commit, schemas }) =>
      diffSchemaSets(schemas, current).map(
        (change) =>
          `${commit.slice(0, 12)} ${change.file}${change.path} ${change.kind}: ${change.detail}`,
      ),
    );
    expect(historyBreaking).toEqual([]);
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
    baselineRevisions: history.length,
    historyBreakingChanges: historyBreaking.length,
    historyBreakingList: historyBreaking.slice(0, 20),
  });
});
