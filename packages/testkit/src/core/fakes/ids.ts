/**
 * Deterministic ids for the IdGenerator port: `next('run')` gives `run_0001`, then
 * `run_0002`. Each prefix counts on its own unless the generator is created shared.
 */
import type { IdGenerator } from '@argus/contracts';

export interface SeqIdOptions {
  /** Minimum number of digits; 4 by default (`_0001`). */
  readonly width?: number;
  /** One counter for every prefix instead of one per prefix. */
  readonly shared?: boolean;
  /** First value of each counter; 1 by default. */
  readonly start?: number;
}

export class SeqIdGenerator implements IdGenerator {
  readonly #width: number;
  readonly #shared: boolean;
  readonly #start: number;
  readonly #counters = new Map<string, number>();

  constructor(options: SeqIdOptions = {}) {
    this.#width = options.width ?? 4;
    this.#shared = options.shared ?? false;
    this.#start = options.start ?? 1;
    if (!Number.isInteger(this.#width) || this.#width < 1) {
      throw new RangeError('SeqIdGenerator width must be a positive integer');
    }
    if (!Number.isInteger(this.#start) || this.#start < 0) {
      throw new RangeError('SeqIdGenerator start must be a non-negative integer');
    }
  }

  next(prefix: string): string {
    const counter = this.#shared ? '' : prefix;
    const value = this.#counters.get(counter) ?? this.#start;
    this.#counters.set(counter, value + 1);
    return `${prefix}_${String(value).padStart(this.#width, '0')}`;
  }

  /** Values issued so far for `prefix` (or in total when shared). */
  issued(prefix = ''): number {
    const counter = this.#shared ? '' : prefix;
    return (this.#counters.get(counter) ?? this.#start) - this.#start;
  }

  reset(): void {
    this.#counters.clear();
  }
}
