import { describe, expect, it } from 'vitest';
import {
  type GateDefinition,
  type GateResult,
  buildEvidence,
  commandResult,
  exitCodeFor,
  notRunResult,
  parseExpression,
  parseMetrics,
  passByTier,
  verifyEvidenceHash,
} from '../src/index.js';

function definition(id: string, tier: 'A' | 'B' | 'C', pass = 'exitCode == 0'): GateDefinition {
  const parsed = parseExpression(pass);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return {
    id,
    tier,
    title: id,
    command: 'true',
    timeoutSec: 5,
    requires: [],
    pass,
    expression: parsed.value,
  };
}

const ok = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  durationMs: 10,
  metrics: parseMetrics(null),
  log: 'x.log',
};

function result(id: string, tier: 'A' | 'B' | 'C', status: GateResult['status']): GateResult {
  if (status === 'not_run') {
    return notRunResult(definition(id, tier), 'missing credentials: KEY');
  }
  return commandResult(definition(id, tier), { ...ok, exitCode: status === 'pass' ? 0 : 1 });
}

const base = {
  module: 'M06',
  title: 'Navigator',
  commit: 'abc1234',
  worktreeClean: true,
  tier: 'all' as const,
  strict: false,
  startedAt: '2026-10-02T09:14:00.000Z',
  finishedAt: '2026-10-02T09:15:00.000Z',
  toolVersions: { node: '22.9.0', pnpm: '10.33.0' },
  logsGitIgnored: true,
};

describe('buildEvidence', () => {
  it('passes only when every gate passes', () => {
    const passing = buildEvidence({
      ...base,
      gates: [result('M06-G1', 'A', 'pass'), result('M06-G2', 'C', 'pass')],
    });
    expect(passing.pass).toBe(true);
    expect(passing.passByTier).toEqual({ A: true, C: true });
    expect(passing.notRun).toEqual([]);
    expect(passing.evidenceVersion).toBe(1);
    expect(passing.logsGitIgnored).toBe(true);

    const mixed = buildEvidence({
      ...base,
      gates: [
        result('M06-G1', 'A', 'pass'),
        result('M06-G2', 'B', 'not_run'),
        result('M06-G3', 'A', 'fail'),
      ],
    });
    expect(mixed.pass).toBe(false);
    expect(mixed.passByTier).toEqual({ A: false, B: false });
    expect(mixed.notRun).toEqual([{ id: 'M06-G2', reason: 'missing credentials: KEY' }]);
    expect(buildEvidence({ ...base, gates: [] }).pass).toBe(false);
  });

  it('hashes the canonical document without its hash, and detects tampering', () => {
    const evidence = buildEvidence({ ...base, gates: [result('M06-G1', 'A', 'pass')] });
    const roundTrip: unknown = JSON.parse(JSON.stringify(evidence, null, 2));
    expect(verifyEvidenceHash(roundTrip)).toEqual({
      valid: true,
      expected: evidence.evidenceHash,
      recorded: evidence.evidenceHash,
    });
    expect(verifyEvidenceHash({ ...evidence, commit: 'fffffff' }).valid).toBe(false);
    const { evidenceHash: _dropped, ...unhashed } = evidence;
    expect(verifyEvidenceHash(unhashed)).toMatchObject({ valid: false, recorded: null });
    expect(verifyEvidenceHash([1])).toEqual({ valid: false, expected: '', recorded: null });
  });

  it('summarises tiers per tier', () => {
    expect(
      passByTier([
        result('M00-G1', 'C', 'pass'),
        result('M00-G2', 'A', 'fail'),
        result('M00-G3', 'A', 'pass'),
      ]),
    ).toEqual({
      A: false,
      C: true,
    });
  });
});

describe('exitCodeFor', () => {
  it('fails on a failed gate, and on a gate that did not run only when strict', () => {
    const notRun = [result('M06-G1', 'A', 'pass'), result('M06-G2', 'B', 'not_run')];
    expect(exitCodeFor(notRun, false)).toBe(0);
    expect(exitCodeFor(notRun, true)).toBe(1);
    expect(exitCodeFor([result('M06-G1', 'A', 'fail')], false)).toBe(1);
    expect(exitCodeFor([], true)).toBe(0);
  });
});

describe('commandResult', () => {
  const gate = definition('M06-G1', 'A', 'exitCode == 0 && metrics.tests >= 3');

  it('passes when the expression holds', () => {
    const passed = commandResult(gate, { ...ok, metrics: parseMetrics('{"tests": 3}') });
    expect(passed).toMatchObject({
      status: 'pass',
      pass: true,
      metrics: { tests: 3 },
      log: 'x.log',
    });
    expect(passed.reason).toBeUndefined();
  });

  it('explains failures', () => {
    expect(
      commandResult(gate, { ...ok, exitCode: 2, metrics: parseMetrics('{"tests": 3}') }).reason,
    ).toBe('pass expression is false (exit code 2)');
    expect(commandResult(gate, ok).reason).toBe('missing metrics: tests');
    expect(commandResult(gate, { ...ok, metrics: parseMetrics('{"tests": "3"}') }).reason).toMatch(
      /needs two numbers/,
    );
    expect(
      commandResult(gate, { ...ok, timedOut: true, exitCode: null, signal: 'SIGTERM' }).reason,
    ).toBe('timed out after 5 s; missing metrics: tests');
    expect(
      commandResult(gate, {
        ...ok,
        exitCode: null,
        signal: 'SIGKILL',
        metrics: parseMetrics('{"tests":3}'),
      }).reason,
    ).toBe('killed by SIGKILL');
    expect(commandResult(gate, { ...ok, metrics: parseMetrics('not json') }).reason).toBe(
      'metrics file is not valid JSON; missing metrics: tests',
    );
  });

  it('never passes a timed-out command or unreadable metrics, whatever the expression says', () => {
    const lenient = definition('M06-G2', 'A', 'true');
    expect(commandResult(lenient, { ...ok, timedOut: true }).status).toBe('fail');
    expect(commandResult(lenient, { ...ok, metrics: parseMetrics('[]') })).toMatchObject({
      status: 'fail',
      reason: 'metrics file does not hold a JSON object',
    });
  });
});

describe('parseMetrics', () => {
  it('reads objects and treats an absent or empty file as no metrics', () => {
    expect(parseMetrics(null)).toEqual({ ok: true, value: {} });
    expect(parseMetrics(' \n')).toEqual({ ok: true, value: {} });
    expect(parseMetrics('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseMetrics('null')).toEqual({
      ok: false,
      error: 'metrics file does not hold a JSON object',
    });
  });
});
