import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordGateMetrics } from '../src/index.js';

const dirs: string[] = [];

function metricsFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'argus-metrics-'));
  dirs.push(dir);
  return join(dir, 'metrics.json');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('recordGateMetrics', () => {
  it('does nothing without GATE_METRICS', () => {
    expect(recordGateMetrics({ a: 1 }, {})).toBeUndefined();
    expect(recordGateMetrics({ a: 1 }, { GATE_METRICS: '' })).toBeUndefined();
  });

  it('creates the file and merges later calls', () => {
    const file = metricsFile();
    const env = { GATE_METRICS: file };
    expect(recordGateMetrics({ a: 1, b: 'x' }, env)).toEqual({ a: 1, b: 'x' });
    expect(recordGateMetrics({ b: 'y', c: [true, null] }, env)).toEqual({
      a: 1,
      b: 'y',
      c: [true, null],
    });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 1, b: 'y', c: [true, null] });
  });

  it('treats an empty file as an empty object', () => {
    const file = metricsFile();
    writeFileSync(file, '  \n');
    expect(recordGateMetrics({ n: 2 }, { GATE_METRICS: file })).toEqual({ n: 2 });
  });

  it('refuses a file that does not hold an object', () => {
    const file = metricsFile();
    writeFileSync(file, '[1,2]');
    expect(() => recordGateMetrics({ n: 2 }, { GATE_METRICS: file })).toThrow(/JSON object/);
  });
});
