/**
 * Allowed decisions by break reason (Architecture and contracts, "Allowed decisions by
 * break reason"), as a pure function. ADR M07-decision-matrix records the rows for the
 * reasons the table does not list.
 */
import { ANALYST_DECISIONS, type AnalystDecisionType, type BreakReason } from '@argus/contracts';

/** One row of the table: which columns say yes. `MARK_PASSED` may be "unless strict". */
interface MatrixRow {
  readonly retry: boolean;
  readonly patch: boolean;
  readonly resolveTarget: boolean;
  readonly markPassed: 'no' | 'unless-strict';
  readonly markFailed: boolean;
  readonly abortEnv: boolean;
}

const GROUNDING_AMBIGUOUS_ROW: MatrixRow = {
  retry: true,
  patch: true,
  resolveTarget: true,
  markPassed: 'no',
  markFailed: true,
  abortEnv: true,
};

const NOT_FOUND_ROW: MatrixRow = {
  retry: true,
  patch: true,
  resolveTarget: false,
  markPassed: 'no',
  markFailed: true,
  abortEnv: true,
};

const UNCERTAIN_ROW: MatrixRow = {
  retry: true,
  patch: true,
  resolveTarget: false,
  markPassed: 'unless-strict',
  markFailed: true,
  abortEnv: true,
};

const FAILED_CHECK_ROW: MatrixRow = {
  retry: true,
  patch: false,
  resolveTarget: false,
  markPassed: 'no',
  markFailed: true,
  abortEnv: true,
};

/**
 * The table, row by row, plus the extension rows of ADR M07-decision-matrix
 * (`CONSOLE_OR_NETWORK_ERROR`, `OBSERVE_FAILED`, `NAVIGATOR_UNAVAILABLE`). Reasons that
 * are absent end the step or the run without an escalation.
 */
const ROWS: Readonly<Partial<Record<BreakReason, MatrixRow>>> = {
  GROUNDING_AMBIGUOUS: GROUNDING_AMBIGUOUS_ROW,
  TARGET_NOT_FOUND: NOT_FOUND_ROW,
  AUTH_LOST: NOT_FOUND_ROW,
  ACTION_ERROR: NOT_FOUND_ROW,
  TIMEOUT: NOT_FOUND_ROW,
  EXPECTATION_UNCERTAIN: UNCERTAIN_ROW,
  UNEXPECTED_ERROR_UI: UNCERTAIN_ROW,
  BLOCKING_MODAL: UNCERTAIN_ROW,
  OFF_PATH: UNCERTAIN_ROW,
  NO_EFFECT: UNCERTAIN_ROW,
  EXPECTATION_FAILED: FAILED_CHECK_ROW,
  ASSERTION_FAILED: FAILED_CHECK_ROW,
  VISUAL_DIFF: FAILED_CHECK_ROW,
  // Extension rows (ADR M07-decision-matrix).
  CONSOLE_OR_NETWORK_ERROR: FAILED_CHECK_ROW,
  OBSERVE_FAILED: NOT_FOUND_ROW,
  NAVIGATOR_UNAVAILABLE: NOT_FOUND_ROW,
};

/** The break reasons of the spec table itself, in its row order. */
export const MATRIX_TABLE_REASONS = [
  'GROUNDING_AMBIGUOUS',
  'TARGET_NOT_FOUND',
  'AUTH_LOST',
  'ACTION_ERROR',
  'TIMEOUT',
  'EXPECTATION_UNCERTAIN',
  'UNEXPECTED_ERROR_UI',
  'BLOCKING_MODAL',
  'OFF_PATH',
  'NO_EFFECT',
  'EXPECTATION_FAILED',
  'ASSERTION_FAILED',
  'VISUAL_DIFF',
] as const satisfies readonly BreakReason[];

/** Reasons outside the table that still escalate (ADR M07-decision-matrix). */
export const MATRIX_EXTENSION_REASONS = [
  'CONSOLE_OR_NETWORK_ERROR',
  'OBSERVE_FAILED',
  'NAVIGATOR_UNAVAILABLE',
] as const satisfies readonly BreakReason[];

export interface MatrixPolicy {
  /** `--strict` or the project's strict policy: `MARK_PASSED` is never offered. */
  readonly strict: boolean;
}

export interface MatrixStep {
  /** The step's risk class is `critical`: `MARK_FAILED_CONTINUE` is never offered. */
  readonly critical: boolean;
}

/** True when a break with this reason goes to the Analyst at all. */
export function isEscalable(reason: BreakReason): boolean {
  return ROWS[reason] !== undefined;
}

/**
 * The decisions the Analyst may choose for a break, in the canonical order of
 * `ANALYST_DECISIONS`; empty for a reason that does not escalate.
 */
export function allowedDecisions(
  reason: BreakReason,
  policy: MatrixPolicy,
  step: MatrixStep,
): AnalystDecisionType[] {
  const row = ROWS[reason];
  if (row === undefined) {
    return [];
  }
  const offered: Record<AnalystDecisionType, boolean> = {
    RETRY_STEP: row.retry,
    PATCH: row.patch,
    RESOLVE_TARGET: row.resolveTarget,
    MARK_PASSED: row.markPassed === 'unless-strict' && !policy.strict,
    MARK_FAILED_CONTINUE: row.markFailed && !step.critical,
    MARK_FAILED_ABORT: row.markFailed,
    ABORT_ENV: row.abortEnv,
  };
  return ANALYST_DECISIONS.filter((decision) => offered[decision]);
}
