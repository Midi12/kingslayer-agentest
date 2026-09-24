/**
 * Durations such as `within: 10s`: an optional minutes part, an optional seconds part and
 * an optional milliseconds part, in that order (`1m30s`, `10s`, `500ms`, `2m`).
 */
import { err, ok, type Result } from './result.js';

const DURATION = /^(?=[0-9])(?:([0-9]+)m(?!s))?(?:([0-9]+)s)?(?:([0-9]+)ms)?$/;

/** Parses a duration into milliseconds. */
export function parseDuration(text: string): Result<number, string> {
  const match = DURATION.exec(text);
  if (match === null) {
    return err(`invalid duration ${JSON.stringify(text)}: expected e.g. 10s, 1m30s or 500ms`);
  }
  const [, minutes, seconds, millis] = match;
  const total = Number(minutes ?? 0) * 60_000 + Number(seconds ?? 0) * 1000 + Number(millis ?? 0);
  if (!Number.isSafeInteger(total)) {
    return err(`duration ${JSON.stringify(text)} is too large`);
  }
  return ok(total);
}

/** Formats milliseconds canonically: `90000` is `1m30s`, `0` is `0s`, `1500` is `1s500ms`. */
export function formatDuration(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) {
    throw new RangeError(`duration must be a non-negative integer of milliseconds, got ${ms}`);
  }
  if (ms === 0) return '0s';
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${minutes > 0 ? `${minutes}m` : ''}${seconds > 0 ? `${seconds}s` : ''}${millis > 0 ? `${millis}ms` : ''}`;
}
