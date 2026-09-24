/**
 * A manual clock for the Clock port. Time moves only when a test calls `advance` or
 * `set`; a pending `sleep` resolves once the clock reaches its due time, in due order,
 * with `now()` equal to that due time when its continuation starts.
 */
import type { Clock } from '@argus/contracts';

/** 2026-01-01T00:00:00.000Z, the default start. */
export const FAKE_CLOCK_EPOCH = Date.UTC(2026, 0, 1);

interface Sleeper {
  readonly due: number;
  readonly order: number;
  readonly resolve: () => void;
}

export class FakeClock implements Clock {
  #now: number;
  #order = 0;
  #sleepers: Sleeper[] = [];

  constructor(start: number | string = FAKE_CLOCK_EPOCH) {
    this.#now = typeof start === 'string' ? Date.parse(start) : start;
    if (!Number.isFinite(this.#now)) {
      throw new RangeError(`FakeClock start is not a valid time: ${String(start)}`);
    }
  }

  now(): number {
    return this.#now;
  }

  /** The current time as an ISO 8601 string. */
  iso(): string {
    return new Date(this.#now).toISOString();
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) {
      return Promise.reject(signal.reason as Error);
    }
    if (!(ms > 0)) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const sleeper: Sleeper = {
        due: this.#now + ms,
        order: this.#order++,
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        },
      };
      const onAbort = (): void => {
        this.#sleepers = this.#sleepers.filter((entry) => entry !== sleeper);
        reject(signal?.reason as Error);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#sleepers.push(sleeper);
    });
  }

  /** Number of sleeps not yet resolved. */
  get pendingSleeps(): number {
    return this.#sleepers.length;
  }

  /** Due time of the earliest pending sleep, or undefined. */
  nextDue(): number | undefined {
    return this.#sleepers.reduce<number | undefined>(
      (earliest, sleeper) =>
        earliest === undefined || sleeper.due < earliest ? sleeper.due : earliest,
      undefined,
    );
  }

  /**
   * Moves time forward by `ms`, resolving due sleeps in order. Awaiting the returned
   * promise lets each resolved continuation run at its own due time before the next.
   */
  async advance(ms: number): Promise<void> {
    if (!(ms >= 0)) {
      throw new RangeError('FakeClock can only move forward');
    }
    await this.#runUntil(this.#now + ms);
  }

  /** Sets the time; it may not move backwards. */
  async set(time: number | string): Promise<void> {
    const target = typeof time === 'string' ? Date.parse(time) : time;
    if (!(target >= this.#now)) {
      throw new RangeError('FakeClock can only move forward');
    }
    await this.#runUntil(target);
  }

  /** Advances to each pending sleep in turn until none is left. */
  async runAll(): Promise<void> {
    for (let due = this.nextDue(); due !== undefined; due = this.nextDue()) {
      await this.#runUntil(due);
    }
  }

  async #runUntil(target: number): Promise<void> {
    for (;;) {
      const next = this.#sleepers
        .filter((sleeper) => sleeper.due <= target)
        .sort((a, b) => a.due - b.due || a.order - b.order)[0];
      if (next === undefined) {
        break;
      }
      this.#sleepers = this.#sleepers.filter((sleeper) => sleeper !== next);
      this.#now = Math.max(this.#now, next.due);
      next.resolve();
      // Let the continuation of this sleep run before time moves on.
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
    }
    this.#now = target;
  }
}
