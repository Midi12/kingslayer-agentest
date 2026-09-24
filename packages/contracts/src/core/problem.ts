/**
 * RFC 9457 problem documents with the stable ARGUS `code` (Architecture and contracts,
 * "REST API").
 */
import { PROBLEM_STATUS, PROBLEM_TYPE_BASE, type ProblemCode } from './enums.js';
import type { Problem } from './schemas/api.js';

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
