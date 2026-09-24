/**
 * `pnpm gate`: loads gate files, checks requirements, runs each command with a timeout
 * and `$GATE_METRICS`, evaluates the pass expressions and writes one evidence file per
 * module.
 */
import { isAbsolute, join, relative, resolve } from 'node:path';
import { GATE_USAGE, type GateCommand, parseGateArgs } from '../core/cli-args.js';
import {
  type Evidence,
  type GateResult,
  buildEvidence,
  exitCodeFor,
  verifyEvidenceHash,
} from '../core/evidence.js';
import {
  GATE_FILE_NAME,
  type GateFile,
  type GateDefinition,
  validateGateFile,
} from '../core/gate-file.js';
import { commandResult, notRunResult, parseMetrics } from '../core/gate-outcome.js';
import { type RequirementCheck, notRunReason, parseRequirement } from '../core/requirements.js';
import type {
  Clock,
  DocumentLoader,
  FileSystem,
  Output,
  ProcessRunner,
  RequirementProbe,
  SourceControl,
  ToolVersions,
} from '../ports/index.js';

export const LOG_TAIL_LINES = 200;
const FAILURE_EXCERPT_LINES = 20;

export interface GateRunnerDeps {
  readonly fs: FileSystem;
  readonly documents: DocumentLoader;
  readonly processes: ProcessRunner;
  readonly probe: RequirementProbe;
  readonly clock: Clock;
  readonly sourceControl: SourceControl;
  readonly toolVersions: ToolVersions;
  readonly output: Output;
  /** Environment passed to gate commands, before the GATE_* variables are added. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Repository root: the working directory of every command. */
  readonly root: string;
  /** Directory relative options are resolved against. */
  readonly cwd: string;
}

type RunCommand = Extract<GateCommand, { kind: 'run' }>;

class ConfigurationError extends Error {}

function displayPath(root: string, path: string): string {
  const relativePath = relative(root, path);
  return relativePath.startsWith('..') || isAbsolute(relativePath) ? path : relativePath;
}

async function loadGateFile(
  path: string,
  expectedModule: string,
  deps: GateRunnerDeps,
): Promise<GateFile> {
  const loaded = await deps.documents.loadYaml(path);
  if (!loaded.ok) {
    throw new ConfigurationError(`${displayPath(deps.root, path)}: ${loaded.error}`);
  }
  const validated = validateGateFile(loaded.value);
  if (!validated.ok) {
    throw new ConfigurationError(
      [
        `${displayPath(deps.root, path)} is not a valid gate file:`,
        ...validated.error.map((line) => `  ${line}`),
      ].join('\n'),
    );
  }
  if (validated.value.module !== expectedModule) {
    throw new ConfigurationError(
      `${displayPath(deps.root, path)} declares module ${validated.value.module}, expected ${expectedModule}`,
    );
  }
  return validated.value;
}

async function selectGateFiles(
  command: RunCommand,
  gatesDir: string,
  deps: GateRunnerDeps,
): Promise<GateFile[]> {
  if (command.target !== 'all') {
    const candidate = join(gatesDir, `${command.target}.yaml`);
    if (await deps.fs.exists(candidate)) {
      return [await loadGateFile(candidate, command.target, deps)];
    }
    throw new ConfigurationError(
      `no gate file for ${command.target} in ${displayPath(deps.root, gatesDir)}`,
    );
  }
  if (!(await deps.fs.isDirectory(gatesDir))) {
    throw new ConfigurationError(
      `gate directory ${displayPath(deps.root, gatesDir)} does not exist`,
    );
  }
  const names = (await deps.fs.list(gatesDir))
    .map((name) => GATE_FILE_NAME.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => (a[1] ?? '').localeCompare(b[1] ?? ''));
  const files: GateFile[] = [];
  for (const match of names) {
    files.push(await loadGateFile(join(gatesDir, match[0]), match[1] ?? '', deps));
  }
  return files;
}

async function checkRequirements(
  gate: GateDefinition,
  deps: GateRunnerDeps,
): Promise<RequirementCheck[]> {
  const checks: RequirementCheck[] = [];
  for (const text of gate.requires) {
    const requirement = parseRequirement(text);
    if (requirement.kind === 'env') {
      checks.push({ requirement, satisfied: deps.probe.hasEnv(requirement.name) });
    } else {
      const problem = await deps.probe.toolProblem(requirement.name);
      checks.push(
        problem === undefined
          ? { requirement, satisfied: true }
          : { requirement, satisfied: false, detail: problem },
      );
    }
  }
  return checks;
}

async function runGate(
  gate: GateDefinition,
  module: string,
  evidenceDir: string,
  metricsDir: string,
  command: RunCommand,
  deps: GateRunnerDeps,
): Promise<GateResult> {
  const reason = notRunReason(await checkRequirements(gate, deps));
  if (reason !== undefined) {
    return notRunResult(gate, reason);
  }
  const metricsFile = join(metricsDir, `${gate.id}.json`);
  await deps.fs.remove(metricsFile);
  const result = await deps.processes.run({
    argv: ['bash', '-c', gate.command],
    cwd: deps.root,
    env: {
      ...deps.env,
      GATE_METRICS: metricsFile,
      GATE_ID: gate.id,
      GATE_MODULE: module,
      GATE_TIER: gate.tier,
    },
    timeoutMs: gate.timeoutSec * 1000,
    tailLines: LOG_TAIL_LINES,
    ...(command.verbose
      ? {
          onLine: (line: string) => {
            deps.output.info(`  | ${line}`);
          },
        }
      : {}),
  });
  const logDir = join(evidenceDir, 'logs', module);
  const logFile = join(logDir, `${gate.id}.log`);
  await deps.fs.mkdirp(logDir);
  const header = [
    `$ ${gate.command}`,
    `# exit ${String(result.exitCode)}${result.signal === null ? '' : ` signal ${result.signal}`}${result.timedOut ? ' timed out' : ''} after ${String(result.durationMs)} ms`,
    ...(result.spawnError === undefined ? [] : [`# could not start: ${result.spawnError}`]),
    `# last ${String(result.tail.length)} of ${String(result.totalLines)} lines`,
  ];
  await deps.fs.writeText(logFile, `${[...header, ...result.tail].join('\n')}\n`);
  const metrics = parseMetrics(await deps.fs.readTextIfExists(metricsFile));
  const gateResult = commandResult(gate, {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    metrics,
    log: displayPath(deps.root, logFile),
  });
  if (gateResult.status === 'fail' && !command.verbose) {
    for (const line of result.tail.slice(-FAILURE_EXCERPT_LINES)) {
      deps.output.info(`  | ${line}`);
    }
  }
  return gateResult;
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${String(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function statusLine(result: GateResult): string {
  switch (result.status) {
    case 'pass':
      return `  PASS    ${result.id} (${formatDuration(result.durationMs)})`;
    case 'fail':
      return `  FAIL    ${result.id} (${formatDuration(result.durationMs)}): ${result.reason ?? ''}`;
    case 'not_run':
      return `  NOT RUN ${result.id}: ${result.reason ?? ''}`;
  }
}

async function runModule(
  file: GateFile,
  gates: readonly GateDefinition[],
  command: RunCommand,
  evidenceDir: string,
  deps: GateRunnerDeps,
): Promise<Evidence> {
  const commit = (await deps.sourceControl.shortCommit(deps.root)) ?? 'unknown';
  const worktreeClean = await deps.sourceControl.isClean(deps.root);
  const startedAt = deps.clock.now().toISOString();
  deps.output.info(
    `${file.module} ${file.title} (${String(gates.length)} gates${command.tier === undefined ? '' : `, tier ${command.tier}`})`,
  );
  const metricsDir = await deps.fs.makeTempDir('argus-gate-');
  const results: GateResult[] = [];
  try {
    for (const gate of gates) {
      deps.output.info(`  RUN     ${gate.id} [${gate.tier}] ${gate.title}`);
      const result = await runGate(gate, file.module, evidenceDir, metricsDir, command, deps);
      deps.output.info(statusLine(result));
      results.push(result);
    }
  } finally {
    await deps.fs.remove(metricsDir);
  }
  const evidence = buildEvidence({
    module: file.module,
    title: file.title,
    commit,
    worktreeClean,
    tier: command.tier ?? 'all',
    strict: command.strict,
    startedAt,
    finishedAt: deps.clock.now().toISOString(),
    gates: results,
    toolVersions: await deps.toolVersions.collect(),
  });
  const name =
    command.tier === undefined ? `${file.module}.json` : `${file.module}.tier-${command.tier}.json`;
  const evidenceFile = join(evidenceDir, name);
  await deps.fs.mkdirp(evidenceDir);
  await deps.fs.writeText(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);
  const tiers = Object.entries(evidence.passByTier)
    .map(([tier, pass]) => `${tier} ${pass ? 'pass' : 'no'}`)
    .join(', ');
  deps.output.info(
    `  evidence ${displayPath(deps.root, evidenceFile)}: ${evidence.pass ? 'pass' : 'no pass'} (${tiers})`,
  );
  return evidence;
}

async function runGates(command: RunCommand, deps: GateRunnerDeps): Promise<number> {
  const gatesDir = resolve(deps.cwd, command.gatesDir ?? join(deps.root, 'gates'));
  const evidenceDir = resolve(
    deps.cwd,
    command.evidenceDir ?? join(deps.root, 'gates', 'evidence'),
  );
  const files = await selectGateFiles(command, gatesDir, deps);
  const selectTier = (gate: GateDefinition): boolean =>
    command.tier === undefined || gate.tier === command.tier;
  const all: GateResult[] = [];
  let modules = 0;
  for (const file of files) {
    const gates = file.gates.filter(selectTier);
    if (gates.length === 0) {
      deps.output.info(`${file.module}: no gates of tier ${command.tier ?? ''}`);
      continue;
    }
    modules += 1;
    const evidence = await runModule(file, gates, command, evidenceDir, deps);
    all.push(...evidence.gates);
  }
  const count = (status: GateResult['status']): number =>
    all.filter((gate) => gate.status === status).length;
  deps.output.info(
    `gate ${command.target}${command.tier === undefined ? '' : ` --tier ${command.tier}`}: ${String(modules)} modules, ${String(count('pass'))} pass, ${String(count('fail'))} fail, ${String(count('not_run'))} not run`,
  );
  return exitCodeFor(all, command.strict);
}

async function verify(files: readonly string[], deps: GateRunnerDeps): Promise<number> {
  let failures = 0;
  for (const file of files) {
    const path = resolve(deps.cwd, file);
    let document: unknown;
    try {
      document = JSON.parse(await deps.fs.readText(path));
    } catch (error) {
      deps.output.error(
        `${file}: cannot read evidence (${error instanceof Error ? error.message : String(error)})`,
      );
      failures += 1;
      continue;
    }
    const check = verifyEvidenceHash(document);
    if (check.valid) {
      deps.output.info(`${file}: evidenceHash ok (${check.expected})`);
    } else {
      failures += 1;
      deps.output.error(
        `${file}: evidenceHash mismatch: recorded ${String(check.recorded)}, computed ${check.expected}`,
      );
    }
  }
  return failures === 0 ? 0 : 1;
}

/** Runs `pnpm gate` with the given arguments and returns the process exit code. */
export async function gateCli(argv: readonly string[], deps: GateRunnerDeps): Promise<number> {
  const parsed = parseGateArgs(argv);
  if (!parsed.ok) {
    deps.output.error(`gate: ${parsed.error}`);
    deps.output.error(GATE_USAGE);
    return 2;
  }
  const command = parsed.value;
  if (command.kind === 'help') {
    deps.output.info(GATE_USAGE);
    return 0;
  }
  if (command.kind === 'verify') {
    return verify(command.files, deps);
  }
  try {
    return await runGates(command, deps);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      deps.output.error(`gate: ${error.message}`);
      return 2;
    }
    throw error;
  }
}
