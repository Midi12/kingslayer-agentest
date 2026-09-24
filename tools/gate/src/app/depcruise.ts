/**
 * `pnpm depcruise [--json <file>] [path...]`: the dependency rules of
 * .dependency-cruiser.cjs. Without paths it checks the real tree (packages, apps and
 * tools that exist), leaving out test fixtures, which break the rules on purpose
 * (M00-G3). With paths it checks exactly those.
 *
 * dependency-cruiser's own exit code is the number of errors, which wraps at 256, and is
 * always 0 for the JSON reporter. The verdict therefore comes from the JSON summary.
 */
import { join } from 'node:path';
import { DEPCRUISE_USAGE, parseDepcruiseArgs } from '../core/cli-args.js';
import type { FileSystem, Output, ProcessRunner } from '../ports/index.js';

export const REAL_TREE_ROOTS = ['packages', 'apps', 'tools'] as const;
export const FIXTURE_EXCLUDE = '(^|/)test/fixtures/';
const TIMEOUT_MS = 10 * 60 * 1000;

export interface DepcruiseDeps {
  readonly fs: FileSystem;
  readonly processes: ProcessRunner;
  readonly output: Output;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly root: string;
  /** The `options.exclude.path` patterns of the configuration. */
  readonly configExcludes: readonly string[];
}

/** Error-severity violations in a dependency-cruiser JSON report, or undefined. */
export function summaryErrors(text: string | null): number | undefined {
  if (text === null) {
    return undefined;
  }
  try {
    const report = JSON.parse(text) as { summary?: { error?: unknown } };
    return typeof report.summary?.error === 'number' ? report.summary.error : undefined;
  } catch {
    return undefined;
  }
}

export async function depcruiseCli(argv: readonly string[], deps: DepcruiseDeps): Promise<number> {
  const parsed = parseDepcruiseArgs(argv);
  if (!parsed.ok) {
    deps.output.error(`depcruise: ${parsed.error}`);
    deps.output.error(DEPCRUISE_USAGE);
    return 2;
  }
  if (parsed.value === 'help') {
    deps.output.info(DEPCRUISE_USAGE);
    return 0;
  }
  const { paths } = parsed.value;
  const scratch =
    parsed.value.jsonFile === undefined ? await deps.fs.makeTempDir('argus-depcruise-') : undefined;
  const jsonFile = parsed.value.jsonFile ?? join(scratch ?? '', 'depcruise.json');
  const args = ['--config', join(deps.root, '.dependency-cruiser.cjs')];
  let targets = paths;
  if (targets.length === 0) {
    targets = [];
    for (const candidate of REAL_TREE_ROOTS) {
      if (await deps.fs.isDirectory(join(deps.root, candidate))) {
        targets.push(candidate);
      }
    }
    args.push('--exclude', [...deps.configExcludes, FIXTURE_EXCLUDE].join('|'));
  }
  const print = (line: string): void => {
    deps.output.info(line);
  };
  const bin = (name: string): string => join(deps.root, 'node_modules', '.bin', name);
  try {
    await deps.fs.remove(jsonFile);
    const cruise = await deps.processes.run({
      argv: [
        bin('depcruise'),
        ...args,
        '--output-type',
        'json',
        '--output-to',
        jsonFile,
        ...targets,
      ],
      cwd: deps.root,
      env: deps.env,
      timeoutMs: TIMEOUT_MS,
      onLine: print,
    });
    const errors = summaryErrors(await deps.fs.readTextIfExists(jsonFile));
    if (errors === undefined) {
      deps.output.error(
        `depcruise: no report was produced (exit ${String(cruise.exitCode)}${cruise.spawnError === undefined ? '' : `, ${cruise.spawnError}`})`,
      );
      return 2;
    }
    await deps.processes.run({
      argv: [bin('depcruise-fmt'), '--output-type', 'err-long', jsonFile],
      cwd: deps.root,
      env: deps.env,
      timeoutMs: TIMEOUT_MS,
      onLine: print,
    });
    return errors === 0 ? 0 : 1;
  } finally {
    if (scratch !== undefined) {
      await deps.fs.remove(scratch);
    }
  }
}
