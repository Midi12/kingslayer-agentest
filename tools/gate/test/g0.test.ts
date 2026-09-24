import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type G0Deps,
  G0_COVERAGE_FLOOR,
  NodeFileSystem,
  type ProcessRequest,
  g0Cli,
} from '../src/index.js';
import {
  coverageLines,
  depcruiseErrors,
  eslintCounts,
  projectKind,
  vitestCounts,
} from '../src/app/g0.js';
import { MemoryOutput, ScriptedProcessRunner } from './support.js';

interface ToolOutcome {
  tscErrors?: number;
  tscExit?: number;
  lint?: { errors: number; warnings: number } | 'crash';
  tests?: { total: number; failed: number; pending: number } | 'crash';
  vitestExit?: number;
  coverage?: number;
  guard?: boolean;
  depErrors?: number | 'crash';
}

let root = '';
let output = new MemoryOutput();

function option(argv: readonly string[], prefix: string): string {
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found === undefined ? '' : found.slice(prefix.length);
}

function after(argv: readonly string[], flag: string): string {
  return argv[argv.indexOf(flag) + 1] ?? '';
}

/** Simulates tsc, eslint, vitest and depcruise by writing their report files. */
function tools(outcomes: Record<string, ToolOutcome>) {
  return new ScriptedProcessRunner((request: ProcessRequest) => {
    const tool = basename(request.argv[0] ?? '');
    const argv = request.argv;
    const pkg =
      Object.keys(outcomes).find(
        (name) => argv.join(' ').includes(name) || request.cwd.endsWith(name),
      ) ?? '';
    const outcome = outcomes[pkg] ?? {};
    switch (tool) {
      case 'tsc': {
        const errors = outcome.tscErrors ?? 0;
        return {
          exitCode: outcome.tscExit ?? (errors > 0 ? 2 : 0),
          tail: Array.from(
            { length: errors },
            (_, index) => `src/a.ts(${String(index + 1)},1): error TS2322: bad`,
          ),
        };
      }
      case 'eslint': {
        if (outcome.lint === 'crash') {
          return { exitCode: 2, tail: ['Oops! Something went wrong!'] };
        }
        const lint = outcome.lint ?? { errors: 0, warnings: 0 };
        writeFileSync(
          after(argv, '--output-file'),
          JSON.stringify([
            { errorCount: lint.errors, warningCount: lint.warnings },
            { errorCount: 0, warningCount: 0 },
          ]),
        );
        return { exitCode: lint.errors > 0 ? 1 : 0 };
      }
      case 'vitest': {
        if (outcome.guard ?? true) {
          writeFileSync(request.env.ARGUS_NETWORK_GUARD_REPORT ?? '', '101\n102\n');
        }
        if (outcome.tests === 'crash') {
          return { exitCode: 1 };
        }
        const tests = outcome.tests ?? { total: 12, failed: 0, pending: 0 };
        writeFileSync(
          option(argv, '--outputFile.json='),
          JSON.stringify({
            numTotalTests: tests.total,
            numFailedTests: tests.failed,
            numFailedTestSuites: 0,
            numPendingTests: tests.pending,
            numTodoTests: 0,
          }),
        );
        const directory = option(argv, '--coverage.reportsDirectory=');
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          join(directory, 'coverage-summary.json'),
          JSON.stringify({ total: { lines: { pct: outcome.coverage ?? 97.5 } } }),
        );
        return { exitCode: outcome.vitestExit ?? (tests.failed > 0 ? 1 : 0) };
      }
      case 'depcruise': {
        if (outcome.depErrors === 'crash') {
          return { exitCode: 1, tail: ['ERROR: bad config'] };
        }
        writeFileSync(
          after(argv, '--output-to'),
          JSON.stringify({ summary: { error: outcome.depErrors ?? 0 } }),
        );
        return { exitCode: 0 };
      }
      default:
        return { exitCode: 127, spawnError: `unknown tool ${tool}` };
    }
  });
}

function makePackage(path: string, files: Record<string, string> = {}): void {
  const directory = join(root, path);
  mkdirSync(join(directory, 'src'), { recursive: true });
  mkdirSync(join(directory, 'test'), { recursive: true });
  writeFileSync(join(directory, 'package.json'), '{}');
  writeFileSync(join(directory, 'src', 'index.ts'), 'export const a = 1;\n');
  writeFileSync(join(directory, 'test', 'a.test.ts'), "import { it } from 'vitest';\n");
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(directory, name, '..'), { recursive: true });
    writeFileSync(join(directory, name), content);
  }
}

function deps(processes: ScriptedProcessRunner, env: Record<string, string> = {}): G0Deps {
  return { fs: new NodeFileSystem(), processes, output, env, root, cwd: root };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'argus-g0-'));
  output = new MemoryOutput();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('g0Cli', () => {
  it('passes clean packages and writes metrics', async () => {
    makePackage('packages/alpha');
    makePackage('apps/web');
    const metricsFile = join(root, 'metrics.json');
    const processes = tools({ 'packages/alpha': {}, 'apps/web': { coverage: 72 } });
    expect(
      await g0Cli(['packages/alpha', 'apps/web'], deps(processes, { GATE_METRICS: metricsFile })),
    ).toBe(0);
    const metrics = JSON.parse(readFileSync(metricsFile, 'utf8')) as Record<string, unknown>;
    expect(metrics).toMatchObject({
      packages: 2,
      typecheckFailures: 0,
      lintErrors: 0,
      lintWarnings: 0,
      tests: 24,
      testsFailed: 0,
      testsSkipped: 0,
      vitestFailures: 0,
      coverageLines: 72,
      coverageBelowFloor: 0,
      depViolations: 0,
      markers: 0,
      networkGuardMissing: 0,
      failedPackages: [],
    });
    expect(metrics.perPackage).toMatchObject({
      'apps/web': { coverageFloor: 70, networkGuardInstalls: 2 },
    });
    const vitest = processes.requests.find(
      (request) => basename(request.argv[0] ?? '') === 'vitest',
    );
    expect(vitest?.cwd).toBe(join(root, 'packages/alpha'));
    expect(vitest?.argv).toContain('--coverage.enabled=true');
    expect(output.text()).toMatch(/PASS packages\/alpha/);
  });

  it.each<[string, ToolOutcome, RegExp]>([
    ['typecheck errors', { tscErrors: 2 }, /typecheck failed \(2 errors\)/],
    ['a typecheck crash', { tscExit: 1 }, /typecheck failed \(0 errors\)/],
    ['lint errors', { lint: { errors: 1, warnings: 0 } }, /lint 1 errors/],
    ['lint warnings', { lint: { errors: 0, warnings: 3 } }, /0 errors 3 warnings/],
    ['an eslint crash', { lint: 'crash' }, /lint 1 errors/],
    ['failing tests', { tests: { total: 5, failed: 1, pending: 0 } }, /1 failed/],
    ['skipped tests', { tests: { total: 5, failed: 0, pending: 2 } }, /2 skipped/],
    ['no tests', { tests: { total: 0, failed: 0, pending: 0 } }, /tests 0 /],
    ['a vitest crash', { tests: 'crash' }, /tests 0 \(1 failed/],
    ['a coverage threshold failure', { vitestExit: 1 }, /FAIL/],
    ['coverage under the floor', { coverage: 84.9 }, /lines 84.9% \(floor 85\)/],
    ['dependency violations', { depErrors: 3 }, /dependency violations 3/],
    ['a depcruise crash', { depErrors: 'crash' }, /dependency violations 1/],
    ['a missing network guard', { guard: false }, /network guard missing/],
  ])('fails on %s', async (_name, outcome, message) => {
    makePackage('packages/alpha');
    expect(await g0Cli(['packages/alpha'], deps(tools({ 'packages/alpha': outcome })))).toBe(1);
    expect(output.text()).toMatch(/FAIL packages\/alpha/);
    expect(output.text()).toMatch(message);
    expect(output.text()).toMatch(/g0: 1 packages, fail \(packages\/alpha\)/);
  });

  it('fails on forbidden markers in src or test and names them', async () => {
    const marker = ['TO', 'DO'].join('');
    makePackage('tools/beta', {
      'src/deep/x.ts': `// ${marker} later\n`,
      'test/fixtures/data.json': `{"note": "${['FIX', 'ME'].join('')}"}`,
      'src/ignored.png': marker,
      'dist/built.js': `// ${marker}`,
    });
    expect(await g0Cli(['tools/beta'], deps(tools({})))).toBe(1);
    expect(output.text()).toMatch(/markers 2/);
    expect(output.text()).toMatch(new RegExp(`marker ${marker} at tools/beta/src/deep/x.ts:1`));
  });

  it('skips the dependency check for a package without src', async () => {
    makePackage('packages/gamma');
    rmSync(join(root, 'packages/gamma/src'), { recursive: true });
    rmSync(join(root, 'packages/gamma/test'), { recursive: true });
    const processes = tools({});
    expect(await g0Cli(['packages/gamma'], deps(processes))).toBe(0);
    expect(
      processes.requests.some((request) => basename(request.argv[0] ?? '') === 'depcruise'),
    ).toBe(false);
  });

  it.each([
    [[], /name at least one package directory/],
    [['--fast'], /unknown option --fast/],
    [['packages/missing'], /is not a package directory/],
    [['../outside'], /is not a package directory/],
  ])('exits 2 for %j', async (argv, message) => {
    expect(await g0Cli(argv, deps(tools({})))).toBe(2);
    expect(output.text()).toMatch(message);
  });

  it('prints usage for --help', async () => {
    expect(await g0Cli(['--help'], deps(tools({})))).toBe(0);
    expect(output.text()).toMatch(/Usage: pnpm g0/);
  });
});

describe('report parsers', () => {
  it('reads eslint, vitest, coverage and depcruise reports', () => {
    expect(eslintCounts([{ errorCount: 2, warningCount: 1 }, { errorCount: 'x' }])).toEqual({
      errors: 2,
      warnings: 1,
    });
    expect(eslintCounts({})).toBeUndefined();
    expect(
      vitestCounts({
        numTotalTests: 3,
        numFailedTests: 1,
        numFailedTestSuites: 1,
        numPendingTests: 1,
        numTodoTests: 1,
      }),
    ).toEqual({
      tests: 3,
      failed: 2,
      skipped: 2,
    });
    expect(vitestCounts([])).toBeUndefined();
    expect(coverageLines({ total: { lines: { pct: 88.1 } } })).toBe(88.1);
    expect(coverageLines({ total: { lines: { pct: 'Unknown' } } })).toBe(0);
    expect(coverageLines(undefined)).toBe(0);
    expect(depcruiseErrors({ summary: { error: 4 } })).toBe(4);
    expect(depcruiseErrors({})).toBeUndefined();
  });

  it('knows the coverage floor by project kind', () => {
    expect(projectKind('apps/api')).toBe('app');
    expect(projectKind('packages/contracts')).toBe('package');
    expect(projectKind('tools/gate')).toBe('package');
    expect(G0_COVERAGE_FLOOR).toEqual({ package: 85, app: 70 });
  });
});
