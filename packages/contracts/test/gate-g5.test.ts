/**
 * M01-G5: step rendering needs no model. The rendered step lists of the golden scripts
 * are byte-equal to `__golden__/render/*.txt`, and rendering does not depend on key order.
 */
import { recordGateMetrics } from '@argus/testkit';
import { afterAll, describe, expect, it } from 'vitest';
import { renderSteps, validate } from '../src/index.js';
import { renderGoldens } from './support/goldens.js';

const goldens = renderGoldens();
const mismatches: string[] = [];
let deterministic = true;

function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reversedKeys(child)]),
    );
  }
  return value;
}

describe('M01-G5 rendered step lists', () => {
  it.each(goldens.map((golden) => [golden.name, golden] as const))('%s', (name, golden) => {
    const script = validate('TestScript', golden.script);
    expect(script.ok ? [] : script.error).toEqual([]);
    if (!script.ok) return;
    const rendered = renderSteps(script.value);
    if (rendered !== golden.expected) mismatches.push(name);
    expect(rendered).toBe(golden.expected);
    const again = validate('TestScript', reversedKeys(golden.script));
    const stable =
      again.ok && renderSteps(again.value) === rendered && renderSteps(script.value) === rendered;
    if (!stable) deterministic = false;
    expect(stable).toBe(true);
  });

  it('covers at least ten golden scripts', () => {
    expect(goldens.length).toBeGreaterThanOrEqual(10);
  });
});

afterAll(() => {
  recordGateMetrics({
    scripts: goldens.length,
    mismatches: mismatches.length,
    mismatchList: mismatches,
    deterministic,
  });
});
