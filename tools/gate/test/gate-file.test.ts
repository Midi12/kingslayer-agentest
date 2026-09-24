import { describe, expect, it } from 'vitest';
import { validateGateFile } from '../src/index.js';

const gate = {
  id: 'M06-G1',
  tier: 'A',
  title: 'Requests conform',
  command: 'pnpm --filter @argus/navigator test:gate-g1',
  timeoutSec: 900,
  requires: [],
  pass: 'exitCode == 0 && metrics.tasks >= 120 && metrics.invalid == 0',
};

function file(gates: unknown[], extra: Record<string, unknown> = {}) {
  return { module: 'M06', title: 'Navigator', gates, ...extra };
}

function errors(document: unknown): string[] {
  const result = validateGateFile(document);
  return result.ok ? [] : result.error;
}

describe('validateGateFile', () => {
  it('accepts the CLAUDE.md example and parses its pass expression', () => {
    const result = validateGateFile(
      file([
        gate,
        { ...gate, id: 'M06-G2', tier: 'B', requires: ['TYPESAFE_API_KEY', 'tool:docker'] },
      ]),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.module).toBe('M06');
      expect(result.value.gates.map((g) => g.id)).toEqual(['M06-G1', 'M06-G2']);
      expect(result.value.gates[0]?.expression.kind).toBe('and');
    }
  });

  it('defaults requires to an empty list', () => {
    const { requires: _unused, ...withoutRequires } = gate;
    const result = validateGateFile(file([withoutRequires]));
    expect(result.ok && result.value.gates[0]?.requires).toEqual([]);
  });

  it('accepts scenario files', () => {
    expect(
      validateGateFile({ module: 'S03', title: 'Self-heal', gates: [{ ...gate, id: 'S03-G1' }] })
        .ok,
    ).toBe(true);
  });

  it.each([
    ['a missing module', { title: 'x', gates: [gate] }, /module/],
    ['an invalid module id', file([gate], { module: 'M6' }), /\/module/],
    ['an unknown top-level key', file([gate], { owner: 'me' }), /owner|additional/i],
    ['no gates', file([]), /\/gates/],
    ['a bad gate id', file([{ ...gate, id: 'M06-1' }]), /\/gates\/0\/id/],
    ['tier D', file([{ ...gate, tier: 'D' }]), /\/gates\/0\/tier/],
    ['a zero timeout', file([{ ...gate, timeoutSec: 0 }]), /\/gates\/0\/timeoutSec/],
    ['a fractional timeout', file([{ ...gate, timeoutSec: 1.5 }]), /\/gates\/0\/timeoutSec/],
    ['a missing timeout', file([{ ...gate, timeoutSec: undefined }]), /\/gates\/0\/timeoutSec/],
    ['an empty command', file([{ ...gate, command: '' }]), /\/gates\/0\/command/],
    [
      'an invalid requirement',
      file([{ ...gate, requires: ['has space'] }]),
      /\/gates\/0\/requires\/0/,
    ],
    ['an unknown gate key', file([{ ...gate, flaky: true }]), /\/gates\/0/],
  ])('rejects %s', (_name, document, message) => {
    expect(errors(document).join('\n')).toMatch(message);
  });

  it('rejects gates of another module, duplicate ids and bad pass expressions', () => {
    const problems = errors(
      file([
        { ...gate, id: 'M07-G1' },
        { ...gate, id: 'M06-G2' },
        { ...gate, id: 'M06-G2' },
        { ...gate, id: 'M06-G3', pass: 'exitCode === 0' },
      ]),
    );
    expect(problems).toEqual([
      '/gates/0/id: M07-G1 does not belong to module M06',
      '/gates/2/id: duplicate gate id M06-G2',
      "/gates/3/pass: unexpected character '=' at column 12",
    ]);
  });

  it('rejects non-objects', () => {
    expect(errors(null).length).toBeGreaterThan(0);
    expect(errors('module: M06').length).toBeGreaterThan(0);
  });
});
