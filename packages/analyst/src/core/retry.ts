/**
 * Bounded retries of a provider call (ADR M07-llm-port): 429, 5xx and dropped
 * connections are retried with exponential backoff, honouring `retry-after`, while both
 * the attempt count and the time budget allow; everything else returns at once. A
 * timed-out attempt is not retried: its time is already spent.
 */
import { err, ok, type Clock, type Result } from '@argus/contracts';
import type { LlmError } from '../ports/llm.js';

export interface RetryPolicy {
  /** Attempts in total, the first included. */
  readonly maxAttempts: number;
  /** No retry starts after this many milliseconds since the first attempt began. */
  readonly budgetMs: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  budgetMs: 30_000,
  baseDelayMs: 500,
  maxDelayMs: 8000,
};

export type AttemptOutcome<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | {
      readonly kind: 'retryable';
      readonly message: string;
      readonly status?: number;
      readonly retryAfterMs?: number;
    }
  | {
      readonly kind: 'fatal';
      readonly code: LlmError['code'];
      readonly message: string;
      readonly status?: number;
    };

/** True for the statuses a provider call retries: 429 and every 5xx (529 included). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Milliseconds from a `retry-after` header (seconds or an HTTP date), if it parses. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  if (value === null || value === undefined || value.trim() === '') return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Backoff before attempt `attempt + 1` (attempt counts from 1). */
export function retryDelay(
  attempt: number,
  retryAfterMs: number | undefined,
  policy: RetryPolicy,
): number {
  const backoff = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return retryAfterMs === undefined
    ? backoff
    : Math.min(policy.maxDelayMs, Math.max(backoff, retryAfterMs));
}

export interface Attempted<T> {
  readonly value: T;
  readonly attempts: number;
}

/** Runs `attempt` until it succeeds, fails for good, or the policy is spent. */
export async function withRetries<T>(
  attempt: (index: number) => Promise<AttemptOutcome<T>>,
  policy: RetryPolicy,
  clock: Clock,
): Promise<Result<Attempted<T>, LlmError>> {
  const started = clock.now();
  for (let index = 1; ; index++) {
    const outcome = await attempt(index);
    if (outcome.kind === 'ok') {
      return ok({ value: outcome.value, attempts: index });
    }
    if (outcome.kind === 'fatal') {
      return err({
        code: outcome.code,
        message: outcome.message,
        ...(outcome.status === undefined ? {} : { status: outcome.status }),
        attempts: index,
      });
    }
    const delay = retryDelay(index, outcome.retryAfterMs, policy);
    const elapsed = clock.now() - started;
    if (index >= policy.maxAttempts || elapsed + delay > policy.budgetMs) {
      return err({
        code: 'unavailable',
        message: `${outcome.message}; gave up after ${String(index)} attempt${index === 1 ? '' : 's'} in ${String(elapsed)} ms`,
        ...(outcome.status === undefined ? {} : { status: outcome.status }),
        attempts: index,
      });
    }
    await clock.sleep(delay);
  }
}
