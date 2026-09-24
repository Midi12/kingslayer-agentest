/**
 * Time and identity ports. `core` code never reads the wall clock or generates random
 * ids: it takes these, so a run against fakes replays byte for byte.
 */

export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  /** Resolves after `ms` milliseconds of this clock's time; rejects when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export interface IdGenerator {
  /** A new id starting with `prefix`, e.g. `next('run')` gives `run_…`. */
  next(prefix: string): string;
}
