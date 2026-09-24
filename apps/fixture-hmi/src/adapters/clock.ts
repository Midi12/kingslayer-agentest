/**
 * The one clock adapter behind the `Clock` port (`@argus/contracts`). Real mode reads
 * the wall clock; frozen mode returns a fixed value until `/sim/clock` moves it. This is
 * the only place in the package that calls `Date.now()`.
 */
import type { Clock } from '@argus/contracts';

export type ClockMode = 'real' | 'frozen';

export class SimClock implements Clock {
  private mode: ClockMode;
  private frozenAtMs: number;

  constructor(mode: ClockMode, initialFrozenAtMs: number) {
    this.mode = mode;
    this.frozenAtMs = initialFrozenAtMs;
  }

  now(): number {
    return this.mode === 'frozen' ? this.frozenAtMs : Date.now();
  }

  async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (this.mode === 'frozen') {
      this.frozenAtMs += ms;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      });
    });
  }

  getMode(): ClockMode {
    return this.mode;
  }

  isFrozen(): boolean {
    return this.mode === 'frozen';
  }

  /** `/sim/clock`: switch mode and, for `frozen`, optionally set the value. */
  setMode(mode: ClockMode, atMs?: number): void {
    this.mode = mode;
    if (mode === 'frozen') {
      this.frozenAtMs = atMs ?? this.frozenAtMs;
    }
  }

  /** Sets the frozen value directly, staying in frozen mode. */
  setFrozenAt(atMs: number): void {
    this.mode = 'frozen';
    this.frozenAtMs = atMs;
  }
}
