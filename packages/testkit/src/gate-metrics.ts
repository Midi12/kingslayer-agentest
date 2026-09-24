/**
 * Gate commands report metrics as a JSON object in the file named by `$GATE_METRICS`
 * (CLAUDE.md section 4). The gate runner evaluates the pass expression against it.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export type MetricValue =
  | string
  | number
  | boolean
  | null
  | readonly MetricValue[]
  | { readonly [key: string]: MetricValue };

export type Metrics = Record<string, MetricValue>;

function readExisting(file: string): Metrics {
  if (!existsSync(file)) {
    return {};
  }
  const text = readFileSync(file, 'utf8');
  if (text.trim() === '') {
    return {};
  }
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`GATE_METRICS file ${file} does not hold a JSON object`);
  }
  return parsed as Metrics;
}

/**
 * Merges `metrics` into the `$GATE_METRICS` file and returns the merged object, or
 * returns undefined when the variable is not set (a plain test run).
 */
export function recordGateMetrics(
  metrics: Metrics,
  env: NodeJS.ProcessEnv = process.env,
): Metrics | undefined {
  const file = env.GATE_METRICS;
  if (file === undefined || file === '') {
    return undefined;
  }
  const merged: Metrics = { ...readExisting(file), ...metrics };
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  return merged;
}
