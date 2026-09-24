/**
 * M00-G2: the gate runner tells the truth. Three sample gate files (pass; failing exit
 * code; exit 0 with a failing metric) give evidence pass, fail, fail, every evidence hash
 * verifies, and the runner exits non-zero.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { recordGateMetrics } from '@argus/testkit';
import { afterAll, describe, expect, it } from 'vitest';
import { type Evidence, verifyEvidenceHash } from '../src/index.js';
import { gateMain } from '../src/main.js';

const root = resolve(import.meta.dirname, '../../..');
const fixtures = join(import.meta.dirname, 'fixtures', 'gates');
const expected = JSON.parse(
  readFileSync(join(import.meta.dirname, '__golden__', 'g2-expected.json'), 'utf8'),
) as Record<string, { status: string; exitCode: number }>;
const modules = Object.keys(expected).sort();
const scratch = mkdtempSync(join(tmpdir(), 'argus-g2-'));

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GATE_METRICS;
  delete env.GATE_ID;
  return env;
}

function readEvidence(dir: string, module: string): Evidence {
  return JSON.parse(readFileSync(join(dir, `${module}.json`), 'utf8')) as Evidence;
}

const metrics = { samples: 0, statuses: '', runnerExitCode: -1, hashesVerified: 0 };

afterAll(() => {
  recordGateMetrics(metrics);
  rmSync(scratch, { recursive: true, force: true });
});

describe('M00-G2 the gate runner tells the truth', () => {
  it('reports pass, fail, fail for the three samples and exits non-zero', () => {
    const evidenceDir = join(scratch, 'cli');
    const run = spawnSync(
      'pnpm',
      ['--silent', 'gate', 'all', '--gates-dir', fixtures, '--evidence-dir', evidenceDir],
      { cwd: root, env: childEnv(), encoding: 'utf8' },
    );
    expect(run.status, run.stdout + run.stderr).not.toBe(0);
    expect(run.status).toBe(1);
    metrics.runnerExitCode = run.status ?? -1;

    const statuses: string[] = [];
    for (const module of modules) {
      const evidence = readEvidence(evidenceDir, module);
      const want = expected[module];
      expect(evidence.module).toBe(module);
      expect(evidence.gates).toHaveLength(1);
      const gate = evidence.gates[0];
      expect(gate?.status).toBe(want?.status);
      expect(gate?.exitCode).toBe(want?.exitCode);
      expect(evidence.pass).toBe(want?.status === 'pass');
      expect(evidence.passByTier).toEqual({ A: want?.status === 'pass' });
      statuses.push(gate?.status ?? 'missing');
      const check = verifyEvidenceHash(evidence);
      expect(check.valid).toBe(true);
      if (check.valid) {
        metrics.hashesVerified += 1;
      }
    }
    metrics.samples = statuses.length;
    metrics.statuses = statuses.join(',');
    expect(metrics.statuses).toBe('pass,fail,fail');

    const m93 = readEvidence(evidenceDir, 'M93').gates[0];
    expect(m93?.metrics).toEqual({ tests: 3, coverage: 42 });
    expect(m93?.reason).toMatch(/pass expression is false/);
  });

  it('verifies evidence hashes and rejects a tampered file', () => {
    const evidenceDir = join(scratch, 'verify');
    spawnSync(
      'pnpm',
      ['--silent', 'gate', 'M91', '--gates-dir', fixtures, '--evidence-dir', evidenceDir],
      {
        cwd: root,
        env: childEnv(),
      },
    );
    const file = join(evidenceDir, 'M91.json');
    const ok = spawnSync('pnpm', ['--silent', 'gate', 'verify', file], {
      cwd: root,
      env: childEnv(),
    });
    expect(ok.status).toBe(0);
    const tampered = readEvidence(evidenceDir, 'M91');
    writeFileSync(file, JSON.stringify({ ...tampered, pass: false }));
    const bad = spawnSync('pnpm', ['--silent', 'gate', 'verify', file], {
      cwd: root,
      env: childEnv(),
    });
    expect(bad.status).toBe(1);
  });

  it('gives the same verdicts in process', async () => {
    const evidenceDir = join(scratch, 'in-process');
    const code = await gateMain(['all', '--gates-dir', fixtures, '--evidence-dir', evidenceDir], {
      cwd: root,
      env: childEnv(),
    });
    expect(code).toBe(1);
    expect(modules.map((module) => readEvidence(evidenceDir, module).gates[0]?.status)).toEqual([
      'pass',
      'fail',
      'fail',
    ]);
  });
});
