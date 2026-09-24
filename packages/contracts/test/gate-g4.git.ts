/**
 * M01-G4: `v1` stays additive, the part that reads git. It is not in the package's
 * default suite (a clean `git archive` export has no history to read); `test:gate-g4`
 * runs it through `vitest.git.config.ts` after `gate-g4.test.ts` (gate change M01-4).
 *
 * The release reference is the latest `v*` tag when one exists, else the committed
 * snapshot `schemas/baseline/`. Every version of the snapshot ever committed is compared
 * too (gate change M01-1): a commit that rewrites `schemas/baseline/` together with a
 * breaking change still fails, because the snapshot it replaced stays in the history.
 * Outside a git work tree every check here fails; nothing falls back.
 */
import { recordGateMetrics } from '../../testkit/src/gate-metrics.js';
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { relative, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { diffSchemaSets, type BreakingChange } from '../src/index.js';
import { BASELINE_DIR, SCHEMA_DIR } from '../scripts/export-schemas.js';
import { currentSchemas } from './support/additive.js';
import { PACKAGE_DIR, readSchemaDir } from './support/goldens.js';

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
const current = currentSchemas();
let tag: string | undefined;
let baselineSize = 0;
let breaking: BreakingChange[] = [];
let history: { commit: string; schemas: Map<string, unknown> }[] = [];
let historyBreaking: string[] = [];

describe('M01-G4 additive-only schemas against git history', () => {
  it('runs inside a git work tree', () => {
    expect(gitRepository).toBe(true);
  });

  it('finds no breaking change against the latest v* tag, else schemas/baseline', () => {
    tag = latestReleaseTag();
    const baseline =
      tag === undefined ? readSchemaDir(BASELINE_DIR) : schemasAt(tag, repoPath(SCHEMA_DIR));
    baselineSize = baseline.size;
    expect(baselineSize).toBeGreaterThan(0);
    breaking = diffSchemaSets(baseline, current);
    expect(breaking).toEqual([]);
  });

  it('finds no breaking change against any committed version of schemas/baseline', () => {
    history = committedBaselines();
    expect(history.length).toBeGreaterThan(0);
    historyBreaking = history.flatMap(({ commit, schemas }) =>
      diffSchemaSets(schemas, current).map(
        (change) =>
          `${commit.slice(0, 12)} ${change.file}${change.path} ${change.kind}: ${change.detail}`,
      ),
    );
    expect(historyBreaking).toEqual([]);
  });
});

afterAll(() => {
  recordGateMetrics({
    gitRepository,
    baseline: tag === undefined ? 'schemas/baseline' : `tag:${tag}`,
    schemasCompared: baselineSize,
    breakingChanges: breaking.length,
    breakingList: breaking
      .slice(0, 20)
      .map((change) => `${change.file}${change.path} ${change.kind}: ${change.detail}`),
    baselineRevisions: history.length,
    historyBreakingChanges: historyBreaking.length,
    historyBreakingList: historyBreaking.slice(0, 20),
  });
});
