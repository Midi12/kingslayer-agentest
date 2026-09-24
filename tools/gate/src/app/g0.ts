/**
 * `pnpm g0 <package-dir...>`: global gate G0 on each package (implementation spec, "Rules
 * that keep gates honest"): typecheck, lint, unit tests with line coverage at the floor
 * of the package kind, dependency rules, no forbidden markers, and proof that the tests
 * ran behind the Tier A network guard.
 */
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { G0_USAGE, parseG0Args } from '../core/cli-args.js';
import { type MarkerHit, isScannedFile, scanForMarkers } from '../core/markers.js';
import type { FileSystem, Output, ProcessResult, ProcessRunner } from '../ports/index.js';

/** Line coverage floor by project kind; a package may configure a higher threshold. */
export const G0_COVERAGE_FLOOR = { package: 85, app: 70 } as const;
const STEP_TIMEOUT_MS = 15 * 60 * 1000;
const SKIPPED_DIRECTORIES = ['node_modules', 'dist', 'coverage', '.turbo'];

export interface G0Deps {
  readonly fs: FileSystem;
  readonly processes: ProcessRunner;
  readonly output: Output;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly root: string;
  readonly cwd: string;
}

export interface PackageReport {
  readonly package: string;
  readonly kind: keyof typeof G0_COVERAGE_FLOOR;
  readonly typecheckErrors: number;
  readonly typecheckFailed: boolean;
  readonly lintErrors: number;
  readonly lintWarnings: number;
  readonly lintFailed: boolean;
  readonly tests: number;
  readonly testsFailed: number;
  readonly testsSkipped: number;
  readonly vitestFailed: boolean;
  readonly coverageLines: number;
  readonly coverageFloor: number;
  readonly depViolations: number;
  readonly depcruiseFailed: boolean;
  readonly markers: readonly MarkerHit[];
  readonly networkGuardInstalls: number;
}

export interface G0Metrics {
  readonly [key: string]: unknown;
  readonly packages: number;
  readonly typecheckErrors: number;
  readonly typecheckFailures: number;
  readonly lintErrors: number;
  readonly lintWarnings: number;
  readonly tests: number;
  readonly testsFailed: number;
  readonly testsSkipped: number;
  readonly vitestFailures: number;
  readonly coverageLines: number;
  readonly coverageBelowFloor: number;
  readonly depViolations: number;
  readonly markers: number;
  readonly networkGuardMissing: number;
  readonly failedPackages: readonly string[];
}

export function projectKind(packagePath: string): keyof typeof G0_COVERAGE_FLOOR {
  return packagePath.split('/')[0] === 'apps' ? 'app' : 'package';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberAt(value: unknown, ...path: string[]): number {
  let current = value;
  for (const segment of path) {
    current = isRecord(current) ? current[segment] : undefined;
  }
  return typeof current === 'number' ? current : 0;
}

async function readJson(fs: FileSystem, path: string): Promise<unknown> {
  const text = await fs.readTextIfExists(path);
  if (text === null) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** Sums errorCount and warningCount over an ESLint JSON report. */
export function eslintCounts(report: unknown): { errors: number; warnings: number } | undefined {
  if (!Array.isArray(report)) {
    return undefined;
  }
  let errors = 0;
  let warnings = 0;
  for (const file of report as unknown[]) {
    errors += numberAt(file, 'errorCount');
    warnings += numberAt(file, 'warningCount');
  }
  return { errors, warnings };
}

/** Test counts from a Vitest JSON report. */
export function vitestCounts(
  report: unknown,
): { tests: number; failed: number; skipped: number } | undefined {
  if (!isRecord(report)) {
    return undefined;
  }
  return {
    tests: numberAt(report, 'numTotalTests'),
    failed: numberAt(report, 'numFailedTests') + numberAt(report, 'numFailedTestSuites'),
    skipped: numberAt(report, 'numPendingTests') + numberAt(report, 'numTodoTests'),
  };
}

/** Line coverage percentage from an Istanbul json-summary report; 0 when absent. */
export function coverageLines(summary: unknown): number {
  return numberAt(summary, 'total', 'lines', 'pct');
}

/** Error-severity violations from a dependency-cruiser JSON report. */
export function depcruiseErrors(report: unknown): number | undefined {
  return isRecord(report) && isRecord(report.summary)
    ? numberAt(report.summary, 'error')
    : undefined;
}

function failed(result: ProcessResult): boolean {
  return result.exitCode !== 0;
}

class G0 {
  constructor(private readonly deps: G0Deps) {}

  private bin(name: string): string {
    return join(this.deps.root, 'node_modules', '.bin', name);
  }

  private run(
    argv: string[],
    cwd: string,
    extraEnv: Record<string, string> = {},
    onLine?: (line: string) => void,
  ): Promise<ProcessResult> {
    return this.deps.processes.run({
      argv,
      cwd,
      env: { ...this.deps.env, ...extraEnv },
      timeoutMs: STEP_TIMEOUT_MS,
      tailLines: 40,
      ...(onLine === undefined ? {} : { onLine }),
    });
  }

  private report(result: ProcessResult, step: string): void {
    if (failed(result)) {
      this.deps.output.info(
        `    ${step} exited ${String(result.exitCode)}${result.spawnError === undefined ? '' : ` (${result.spawnError})`}`,
      );
      for (const line of result.tail.slice(-15)) {
        this.deps.output.info(`    | ${line}`);
      }
    }
  }

  async checkPackage(directory: string, tmp: string): Promise<PackageReport> {
    const { fs, root } = this.deps;
    const name = relative(root, directory);
    const kind = projectKind(name);

    let typecheckErrors = 0;
    const typecheck = await this.run(
      [this.bin('tsc'), '--noEmit', '--pretty', 'false', '-p', join(directory, 'tsconfig.json')],
      root,
      {},
      (line) => {
        if (/error TS\d+/.test(line)) {
          typecheckErrors += 1;
        }
      },
    );
    this.report(typecheck, 'typecheck');

    const eslintFile = join(tmp, 'eslint.json');
    const lint = await this.run(
      [this.bin('eslint'), '--format', 'json', '--output-file', eslintFile, name],
      root,
    );
    this.report(lint, 'lint');
    const lintCounts = eslintCounts(await readJson(fs, eslintFile));

    const vitestFile = join(tmp, 'vitest.json');
    const coverageDir = join(tmp, 'coverage');
    const guardReport = join(tmp, 'network-guard.txt');
    const vitest = await this.run(
      [
        this.bin('vitest'),
        'run',
        '--coverage.enabled=true',
        '--coverage.reporter=json-summary',
        '--coverage.reporter=text-summary',
        `--coverage.reportsDirectory=${coverageDir}`,
        '--reporter=default',
        '--reporter=json',
        `--outputFile.json=${vitestFile}`,
      ],
      directory,
      { ARGUS_NETWORK_GUARD_REPORT: guardReport },
    );
    this.report(vitest, 'vitest');
    const tests = vitestCounts(await readJson(fs, vitestFile));
    const lines = coverageLines(await readJson(fs, join(coverageDir, 'coverage-summary.json')));
    const guardText = (await fs.readTextIfExists(guardReport)) ?? '';

    let depViolations = 0;
    let depcruiseFailed = false;
    const src = join(directory, 'src');
    if (await fs.isDirectory(src)) {
      const depcruiseFile = join(tmp, 'depcruise.json');
      const depcruise = await this.run(
        [
          this.bin('depcruise'),
          '--config',
          join(root, '.dependency-cruiser.cjs'),
          '--output-type',
          'json',
          '--output-to',
          depcruiseFile,
          relative(root, src),
        ],
        root,
      );
      this.report(depcruise, 'depcruise');
      const errors = depcruiseErrors(await readJson(fs, depcruiseFile));
      depViolations = errors ?? 1;
      depcruiseFailed = failed(depcruise) || errors === undefined;
    }

    const markers: MarkerHit[] = [];
    for (const folder of ['src', 'test']) {
      const path = join(directory, folder);
      if (!(await fs.isDirectory(path))) {
        continue;
      }
      for (const file of await fs.walk(path, SKIPPED_DIRECTORIES)) {
        if (isScannedFile(file)) {
          markers.push(...scanForMarkers(relative(root, file), await fs.readText(file)));
        }
      }
    }

    return {
      package: name,
      kind,
      typecheckErrors,
      typecheckFailed: failed(typecheck),
      lintErrors: lintCounts?.errors ?? 1,
      lintWarnings: lintCounts?.warnings ?? 0,
      lintFailed: failed(lint) || lintCounts === undefined,
      tests: tests?.tests ?? 0,
      testsFailed: tests?.failed ?? 1,
      testsSkipped: tests?.skipped ?? 0,
      vitestFailed: failed(vitest) || tests === undefined,
      coverageLines: lines,
      coverageFloor: G0_COVERAGE_FLOOR[kind],
      depViolations,
      depcruiseFailed,
      markers,
      networkGuardInstalls: guardText.split('\n').filter((line) => line.trim() !== '').length,
    };
  }
}

export function packagePassed(report: PackageReport): boolean {
  return (
    !report.typecheckFailed &&
    !report.lintFailed &&
    report.lintErrors === 0 &&
    report.lintWarnings === 0 &&
    !report.vitestFailed &&
    report.tests > 0 &&
    report.testsFailed === 0 &&
    report.testsSkipped === 0 &&
    report.coverageLines >= report.coverageFloor &&
    !report.depcruiseFailed &&
    report.depViolations === 0 &&
    report.markers.length === 0 &&
    report.networkGuardInstalls > 0
  );
}

export function summarize(reports: readonly PackageReport[]): G0Metrics {
  const sum = (pick: (report: PackageReport) => number): number =>
    reports.reduce((total, report) => total + pick(report), 0);
  return {
    packages: reports.length,
    typecheckErrors: sum((r) => r.typecheckErrors),
    typecheckFailures: sum((r) => (r.typecheckFailed ? 1 : 0)),
    lintErrors: sum((r) => r.lintErrors),
    lintWarnings: sum((r) => r.lintWarnings),
    tests: sum((r) => r.tests),
    testsFailed: sum((r) => r.testsFailed),
    testsSkipped: sum((r) => r.testsSkipped),
    vitestFailures: sum((r) => (r.vitestFailed ? 1 : 0)),
    coverageLines: reports.length === 0 ? 0 : Math.min(...reports.map((r) => r.coverageLines)),
    coverageBelowFloor: sum((r) => (r.coverageLines < r.coverageFloor ? 1 : 0)),
    depViolations: sum((r) => r.depViolations),
    markers: sum((r) => r.markers.length),
    networkGuardMissing: sum((r) => (r.networkGuardInstalls > 0 ? 0 : 1)),
    failedPackages: reports.filter((r) => !packagePassed(r)).map((r) => r.package),
    perPackage: Object.fromEntries(
      reports.map((r) => [
        r.package,
        {
          typecheckErrors: r.typecheckErrors,
          lintErrors: r.lintErrors,
          lintWarnings: r.lintWarnings,
          tests: r.tests,
          testsFailed: r.testsFailed,
          testsSkipped: r.testsSkipped,
          coverageLines: r.coverageLines,
          coverageFloor: r.coverageFloor,
          depViolations: r.depViolations,
          markers: r.markers.length,
          networkGuardInstalls: r.networkGuardInstalls,
        },
      ]),
    ),
  };
}

function describeReport(report: PackageReport): string[] {
  const verdict = packagePassed(report) ? 'PASS' : 'FAIL';
  return [
    `  ${verdict} ${report.package}: typecheck ${report.typecheckFailed ? `failed (${String(report.typecheckErrors)} errors)` : 'ok'}, ` +
      `lint ${String(report.lintErrors)} errors ${String(report.lintWarnings)} warnings, ` +
      `tests ${String(report.tests)} (${String(report.testsFailed)} failed, ${String(report.testsSkipped)} skipped), ` +
      `lines ${String(report.coverageLines)}% (floor ${String(report.coverageFloor)}), ` +
      `dependency violations ${String(report.depViolations)}, markers ${String(report.markers.length)}, ` +
      `network guard ${report.networkGuardInstalls > 0 ? 'on' : 'missing'}`,
    ...report.markers.map(
      (hit) => `    marker ${hit.marker} at ${hit.file}:${String(hit.line)}: ${hit.text}`,
    ),
  ];
}

/** Runs `pnpm g0`; writes metrics to $GATE_METRICS when set and returns the exit code. */
export async function g0Cli(argv: readonly string[], deps: G0Deps): Promise<number> {
  const parsed = parseG0Args(argv);
  if (!parsed.ok) {
    deps.output.error(`g0: ${parsed.error}`);
    deps.output.error(G0_USAGE);
    return 2;
  }
  if (parsed.value === 'help') {
    deps.output.info(G0_USAGE);
    return 0;
  }
  const directories: string[] = [];
  for (const entry of parsed.value.packages) {
    const directory = resolve(deps.cwd, entry);
    const inside = relative(deps.root, directory);
    if (
      inside.startsWith('..') ||
      isAbsolute(inside) ||
      !(await deps.fs.exists(join(directory, 'package.json')))
    ) {
      deps.output.error(`g0: ${entry} is not a package directory of this repository`);
      return 2;
    }
    directories.push(directory);
  }
  const g0 = new G0(deps);
  const reports: PackageReport[] = [];
  for (const directory of directories) {
    deps.output.info(`g0 ${relative(deps.root, directory)}`);
    const tmp = await deps.fs.makeTempDir(`argus-g0-${basename(directory)}-`);
    try {
      const report = await g0.checkPackage(directory, tmp);
      reports.push(report);
      for (const line of describeReport(report)) {
        deps.output.info(line);
      }
    } finally {
      await deps.fs.remove(tmp);
    }
  }
  const metrics = summarize(reports);
  const metricsFile = deps.env.GATE_METRICS;
  if (metricsFile !== undefined && metricsFile !== '') {
    await deps.fs.writeText(metricsFile, `${JSON.stringify(metrics, null, 2)}\n`);
  }
  const passed = metrics.failedPackages.length === 0;
  deps.output.info(
    `g0: ${String(reports.length)} packages, ${passed ? 'pass' : `fail (${metrics.failedPackages.join(', ')})`}`,
  );
  return passed ? 0 : 1;
}
