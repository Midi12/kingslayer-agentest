/** Turns a finished command into a gate status, reason and evaluated pass expression. */
import type { GateDefinition } from './gate-file.js';
import type { GateResult } from './evidence.js';
import { evaluateExpression } from './expression.js';

export interface CommandOutcome {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** Parsed metrics, or an error when the metrics file was unreadable or not an object. */
  readonly metrics:
    { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: string };
  readonly log: string | null;
}

function baseResult(
  gate: GateDefinition,
): Pick<GateResult, 'id' | 'tier' | 'title' | 'command' | 'requires' | 'passExpression'> {
  return {
    id: gate.id,
    tier: gate.tier,
    title: gate.title,
    command: gate.command,
    requires: gate.requires,
    passExpression: gate.pass,
  };
}

/** The result of a gate whose requirements were not met. */
export function notRunResult(gate: GateDefinition, reason: string): GateResult {
  return {
    ...baseResult(gate),
    status: 'not_run',
    reason,
    exitCode: null,
    signal: null,
    timedOut: false,
    durationMs: 0,
    metrics: {},
    missingMetrics: [],
    expressionErrors: [],
    pass: false,
    log: null,
  };
}

/** The result of a gate whose command ran. */
export function commandResult(gate: GateDefinition, outcome: CommandOutcome): GateResult {
  const metrics = outcome.metrics.ok ? outcome.metrics.value : {};
  const evaluation = evaluateExpression(gate.expression, {
    exitCode: outcome.exitCode,
    durationMs: outcome.durationMs,
    metrics,
  });
  const reasons: string[] = [];
  if (outcome.timedOut) {
    reasons.push(`timed out after ${gate.timeoutSec} s`);
  } else if (outcome.signal !== null) {
    reasons.push(`killed by ${outcome.signal}`);
  }
  if (!outcome.metrics.ok) {
    reasons.push(outcome.metrics.error);
  }
  if (evaluation.missingMetrics.length > 0) {
    reasons.push(`missing metrics: ${evaluation.missingMetrics.join(', ')}`);
  }
  reasons.push(...evaluation.errors);
  const pass = evaluation.pass && !outcome.timedOut && outcome.metrics.ok;
  if (!pass && reasons.length === 0) {
    reasons.push(`pass expression is false (exit code ${String(outcome.exitCode)})`);
  }
  return {
    ...baseResult(gate),
    status: pass ? 'pass' : 'fail',
    ...(pass ? {} : { reason: reasons.join('; ') }),
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    durationMs: outcome.durationMs,
    metrics,
    missingMetrics: evaluation.missingMetrics,
    expressionErrors: evaluation.errors,
    pass,
    log: outcome.log,
  };
}

/** Parses the text of a metrics file; an absent file means no metrics. */
export function parseMetrics(text: string | null): CommandOutcome['metrics'] {
  if (text === null || text.trim() === '') {
    return { ok: true, value: {} };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'metrics file is not valid JSON' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'metrics file does not hold a JSON object' };
  }
  return { ok: true, value };
}
