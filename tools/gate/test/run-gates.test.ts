import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type Evidence,
  type GateRunnerDeps,
  NodeFileSystem,
  NodeProcessRunner,
  type ProcessRunner,
  type RequirementProbe,
  type SourceControl,
  YamlDocumentLoader,
  gateCli,
} from '../src/index.js';
import {
  FakeProbe,
  FakeSourceControl,
  FakeToolVersions,
  FixedClock,
  MemoryOutput,
  ScriptedProcessRunner,
} from './support.js';

let root = '';
let output = new MemoryOutput();

function deps(
  overrides: {
    processes?: ProcessRunner;
    probe?: RequirementProbe;
    sourceControl?: SourceControl;
  } = {},
): GateRunnerDeps {
  return {
    fs: new NodeFileSystem(),
    documents: new YamlDocumentLoader(),
    processes: overrides.processes ?? new NodeProcessRunner(),
    probe: overrides.probe ?? new FakeProbe({}, { bash: undefined }),
    clock: new FixedClock(),
    sourceControl: overrides.sourceControl ?? new FakeSourceControl(),
    toolVersions: new FakeToolVersions(),
    output,
    env: { PATH: process.env.PATH },
    root,
    cwd: root,
  };
}

function writeGates(module: string, body: string): void {
  mkdirSync(join(root, 'gates'), { recursive: true });
  writeFileSync(
    join(root, 'gates', `${module}.yaml`),
    `module: ${module}\ntitle: Test ${module}\ngates:\n${body}`,
  );
}

function gateYaml(id: string, command: string, pass: string, extra = ''): string {
  return `  - id: ${id}\n    tier: A\n    title: ${id}\n    command: ${JSON.stringify(command)}\n    timeoutSec: 20\n    pass: ${JSON.stringify(pass)}\n${extra}`;
}

function evidence(name: string): Evidence {
  return JSON.parse(readFileSync(join(root, 'gates', 'evidence', name), 'utf8')) as Evidence;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'argus-run-gates-'));
  output = new MemoryOutput();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('gateCli', () => {
  it('runs a module, sets the GATE_* variables and writes evidence and logs', async () => {
    writeGates(
      'M90',
      gateYaml(
        'M90-G1',
        'printf "{\\"id\\":\\"%s\\",\\"module\\":\\"%s\\",\\"tier\\":\\"%s\\",\\"cwd\\":\\"%s\\"}" "$GATE_ID" "$GATE_MODULE" "$GATE_TIER" "$PWD" > "$GATE_METRICS"; seq 1 250',
        'exitCode == 0 && metrics.id == "M90-G1" && metrics.module == "M90" && metrics.tier == "A"',
      ),
    );
    expect(await gateCli(['M90'], deps())).toBe(0);
    const written = evidence('M90.json');
    expect(written).toMatchObject({
      module: 'M90',
      commit: 'abc1234',
      worktreeClean: true,
      tier: 'all',
      pass: true,
    });
    expect(written.gates[0]?.metrics).toMatchObject({ cwd: root });
    expect(written.toolVersions).toEqual({ node: '22.0.0', pnpm: '10.33.0' });
    expect(written.startedAt < written.finishedAt).toBe(true);
    const log = readFileSync(
      join(root, 'gates', 'evidence', 'logs', 'M90', 'M90-G1.log'),
      'utf8',
    ).split('\n');
    expect(log[0]).toMatch(/^\$ printf/);
    expect(log).toContain('# last 200 of 250 lines');
    expect(log).toContain('51');
    expect(log).not.toContain('50');
    expect(written.gates[0]?.log).toBe('gates/evidence/logs/M90/M90-G1.log');
    expect(output.text()).toMatch(/PASS {4}M90-G1/);
  });

  it('reports not_run with the missing requirements and fails it only with --strict', async () => {
    writeGates(
      'M90',
      gateYaml('M90-G1', 'true', 'exitCode == 0') +
        gateYaml(
          'M90-G2',
          'echo never',
          'exitCode == 0',
          '    requires: [TYPESAFE_API_KEY, docker]\n',
        ),
    );
    const probe = new FakeProbe({}, { docker: 'docker daemon unreachable' });
    expect(await gateCli(['M90'], deps({ probe }))).toBe(0);
    expect(evidence('M90.json').notRun).toEqual([
      {
        id: 'M90-G2',
        reason:
          'missing credentials: TYPESAFE_API_KEY; missing tools: docker (docker daemon unreachable)',
      },
    ]);
    expect(await gateCli(['M90', '--strict'], deps({ probe }))).toBe(1);
    const satisfied = new FakeProbe({ TYPESAFE_API_KEY: 'k' }, { docker: undefined });
    expect(await gateCli(['M90', '--strict'], deps({ probe: satisfied }))).toBe(0);
  });

  it('filters by tier and writes tier-filtered evidence separately', async () => {
    writeGates(
      'M90',
      gateYaml('M90-G1', 'true', 'exitCode == 0') +
        `  - id: M90-G2\n    tier: C\n    title: c\n    command: "exit 1"\n    timeoutSec: 5\n    pass: exitCode == 0\n`,
    );
    writeGates(
      'M91',
      `  - id: M91-G1\n    tier: B\n    title: b\n    command: "true"\n    timeoutSec: 5\n    pass: exitCode == 0\n`,
    );
    expect(await gateCli(['all', '--tier', 'A'], deps())).toBe(0);
    expect(evidence('M90.tier-A.json')).toMatchObject({
      tier: 'A',
      pass: true,
      passByTier: { A: true },
    });
    expect(output.text()).toMatch(/M91: no gates of tier A/);
    expect(await gateCli(['all', '--tier', 'C'], deps())).toBe(1);
    expect(await gateCli(['M91', '--tier', 'A'], deps())).toBe(0);
    expect(output.text()).toMatch(/gate M91 --tier A: 0 modules/);
  });

  it('streams output with --verbose and prints the tail of a failing gate otherwise', async () => {
    writeGates('M90', gateYaml('M90-G1', 'echo visible-line; exit 4', 'exitCode == 0'));
    expect(await gateCli(['M90', '--verbose'], deps())).toBe(1);
    expect(output.lines).toContain('  | visible-line');
    output = new MemoryOutput();
    expect(await gateCli(['M90'], deps())).toBe(1);
    expect(output.lines).toContain('  | visible-line');
    expect(evidence('M90.json').gates[0]).toMatchObject({ status: 'fail', exitCode: 4 });
  });

  it('fails a gate whose metrics file is not JSON, and records a timeout', async () => {
    writeGates(
      'M90',
      gateYaml('M90-G1', 'echo nope > "$GATE_METRICS"', 'exitCode == 0') +
        `  - id: M90-G2\n    tier: A\n    title: slow\n    command: "sleep 30"\n    timeoutSec: 1\n    pass: exitCode == 0\n`,
    );
    expect(await gateCli(['M90'], deps())).toBe(1);
    const [bad, slow] = evidence('M90.json').gates;
    expect(bad?.reason).toBe('metrics file is not valid JSON');
    expect(slow).toMatchObject({
      status: 'fail',
      timedOut: true,
      exitCode: null,
      reason: 'timed out after 1 s',
    });
  }, 30_000);

  it('records a command that cannot start and a repository without git', async () => {
    writeGates('M90', gateYaml('M90-G1', 'true', 'exitCode == 0'));
    const processes = new ScriptedProcessRunner(() => ({
      exitCode: null,
      spawnError: 'spawn bash ENOENT',
    }));
    const code = await gateCli(
      ['M90'],
      deps({ processes, sourceControl: new FakeSourceControl(null, null) }),
    );
    expect(code).toBe(1);
    const written = evidence('M90.json');
    expect(written).toMatchObject({ commit: 'unknown', worktreeClean: null });
    expect(
      readFileSync(join(root, 'gates', 'evidence', 'logs', 'M90', 'M90-G1.log'), 'utf8'),
    ).toMatch(/could not start: spawn bash ENOENT/);
    expect(processes.requests[0]?.argv).toEqual(['bash', '-c', 'true']);
    expect(processes.requests[0]?.timeoutMs).toBe(20_000);
  });

  it('honours --gates-dir and --evidence-dir relative to the working directory', async () => {
    mkdirSync(join(root, 'custom'), { recursive: true });
    writeFileSync(
      join(root, 'custom', 'S03.yaml'),
      `module: S03\ntitle: scenario\ngates:\n${gateYaml('S03-G1', 'true', 'exitCode == 0')}`,
    );
    expect(await gateCli(['S03', '--gates-dir', 'custom', '--evidence-dir', 'out'], deps())).toBe(
      0,
    );
    const written = JSON.parse(readFileSync(join(root, 'out', 'S03.json'), 'utf8')) as Evidence;
    expect(written.gates[0]?.log).toBe('out/logs/S03/S03-G1.log');
  });

  it.each([
    [['M90'], 'no gate file for M90'],
    [['all'], 'gate directory gates does not exist'],
    [['M90', '--tier', 'X'], '--tier needs one of A, B, C'],
  ])('exits 2 for %j', async (argv, message) => {
    expect(await gateCli(argv, deps())).toBe(2);
    expect(output.text()).toContain(message);
  });

  it('exits 2 for an invalid gate file, invalid YAML or a module mismatch', async () => {
    writeGates('M90', '  - id: M90-G1\n    tier: Z\n');
    expect(await gateCli(['M90'], deps())).toBe(2);
    expect(output.text()).toMatch(/gates\/M90.yaml is not a valid gate file/);
    writeFileSync(join(root, 'gates', 'M90.yaml'), 'module: [unclosed\n');
    expect(await gateCli(['M90'], deps())).toBe(2);
    expect(output.text()).toMatch(/invalid YAML/);
    writeFileSync(
      join(root, 'gates', 'M90.yaml'),
      `module: M91\ntitle: t\ngates:\n${gateYaml('M91-G1', 'true', 'exitCode == 0')}`,
    );
    expect(await gateCli(['all'], deps())).toBe(2);
    expect(output.text()).toMatch(/declares module M91, expected M90/);
  });

  it('prints usage for --help', async () => {
    expect(await gateCli(['--help'], deps())).toBe(0);
    expect(output.text()).toMatch(/Usage:/);
  });

  it('verifies evidence files', async () => {
    writeGates('M90', gateYaml('M90-G1', 'true', 'exitCode == 0'));
    await gateCli(['M90'], deps());
    const file = join('gates', 'evidence', 'M90.json');
    expect(await gateCli(['verify', file], deps())).toBe(0);
    writeFileSync(join(root, 'broken.json'), '{');
    expect(await gateCli(['verify', file, 'broken.json', 'absent.json'], deps())).toBe(1);
    expect(output.text()).toMatch(/broken.json: cannot read evidence/);
    const tampered = { ...evidence('M90.json'), pass: false };
    writeFileSync(join(root, 'tampered.json'), JSON.stringify(tampered));
    expect(await gateCli(['verify', 'tampered.json'], deps())).toBe(1);
    expect(output.text()).toMatch(/evidenceHash mismatch/);
  });

  it('rethrows unexpected errors', async () => {
    writeGates('M90', gateYaml('M90-G1', 'true', 'exitCode == 0'));
    const processes = new ScriptedProcessRunner(() => {
      throw new Error('runner bug');
    });
    await expect(gateCli(['M90'], deps({ processes }))).rejects.toThrow('runner bug');
  });
});
