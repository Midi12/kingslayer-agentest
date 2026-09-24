/**
 * RFC 9457 problem documents with the stable ARGUS `code` (Architecture and contracts,
 * "REST API").
 */
import { PROBLEM_STATUS, PROBLEM_TYPE_BASE, type ProblemCode } from './enums.js';
import { err, ok, type Result } from './result.js';
import type { Problem } from './schemas/api.js';
import { validate, type ValidationError } from './validate.js';

const TITLES: Record<ProblemCode, string> = {
  validation_failed: 'The request does not match its schema',
  unauthorized: 'Authentication is required',
  insufficient_credits: 'Balance below the reservation and no overage allowed',
  forbidden: 'The credential does not allow this operation',
  target_not_verified: 'The target has not been verified for this organisation',
  not_found: 'The resource does not exist',
  conflict: 'The request conflicts with the current state',
  not_approved: 'The test version is still a draft',
  environment_read_only: 'The script contains write steps and the environment forbids them',
  gap_detected: 'The event batch leaves a gap in the run sequence',
  lint_failed: 'The script violates lint rules L1 to L8',
  origin_not_allowed: 'A URL or HTTP host is outside the allow-list',
  quota_exceeded: 'Parallel-run or seat limit of the plan reached',
  rate_limited: 'Too many requests',
  internal: 'Internal error',
};

/** The `type` URI of a problem code. */
export function problemType(code: ProblemCode): string {
  return `${PROBLEM_TYPE_BASE}${code}`;
}

/** A problem document for `code` with its status, type and standard title. */
export function problem(
  code: ProblemCode,
  extras: Omit<Problem, 'type' | 'title' | 'status' | 'code'> & { title?: string } = {},
): Problem {
  const { title, ...rest } = extras;
  return {
    type: problemType(code),
    title: title ?? TITLES[code],
    status: PROBLEM_STATUS[code],
    code,
    ...rest,
  };
}

/**
 * Validates a problem document and checks that `status` and `type` are the ones its
 * `code` fixes. The published schema cannot express the pairing: tightening it inside
 * v1 would reject documents it accepted before (ADR M01-wire-contracts), so consumers
 * that read problem documents (M12, M14) use this check.
 */
export function validateProblem(value: unknown): Result<Problem, ValidationError[]> {
  const checked = validate('Problem', value);
  if (!checked.ok) return checked;
  const doc = checked.value;
  const errors: ValidationError[] = [];
  if (doc.status !== PROBLEM_STATUS[doc.code]) {
    errors.push({
      path: '/status',
      message: `Expected status ${PROBLEM_STATUS[doc.code]} for code ${doc.code}`,
    });
  }
  if (doc.type !== problemType(doc.code)) {
    errors.push({
      path: '/type',
      message: `Expected type ${problemType(doc.code)} for code ${doc.code}`,
    });
  }
  return errors.length === 0 ? ok(doc) : err(errors);
}
