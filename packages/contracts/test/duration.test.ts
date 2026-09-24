import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from '../src/index.js';

describe('durations', () => {
  it('parses the within syntax', () => {
    expect(parseDuration('10s')).toEqual({ ok: true, value: 10_000 });
    expect(parseDuration('1m30s')).toEqual({ ok: true, value: 90_000 });
    expect(parseDuration('500ms')).toEqual({ ok: true, value: 500 });
    expect(parseDuration('2m')).toEqual({ ok: true, value: 120_000 });
    expect(parseDuration('1m1s1ms')).toEqual({ ok: true, value: 61_001 });
    expect(parseDuration('0s')).toEqual({ ok: true, value: 0 });
  });

  it('rejects anything else', () => {
    for (const text of ['', '10', '10 s', 's', '1.5s', '30s1m', '10sec', '-1s', 'ms', '1h']) {
      const result = parseDuration(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain('invalid duration');
    }
    expect(parseDuration(`${'9'.repeat(30)}m`)).toEqual({
      ok: false,
      error: expect.stringContaining('too large') as unknown,
    });
  });

  it('formats canonically', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(10_000)).toBe('10s');
    expect(formatDuration(90_000)).toBe('1m30s');
    expect(formatDuration(1_500)).toBe('1s500ms');
    expect(formatDuration(120_000)).toBe('2m');
    expect(() => formatDuration(-1)).toThrow(RangeError);
    expect(() => formatDuration(1.5)).toThrow(RangeError);
  });

  it('round-trips every duration', () => {
    fc.assert(
      fc.property(fc.nat(10_000_000), (ms) => {
        expect(parseDuration(formatDuration(ms))).toEqual({ ok: true, value: ms });
      }),
      { numRuns: 500, seed: 3 },
    );
  });
});
