import { describe, expect, it } from 'vitest';
import { SimClock } from '../src/adapters/clock.js';

describe('SimClock', () => {
  it('frozen mode always returns the same value until moved', () => {
    const clock = new SimClock('frozen', 1000);
    expect(clock.now()).toBe(1000);
    expect(clock.now()).toBe(1000);
    clock.setFrozenAt(2000);
    expect(clock.now()).toBe(2000);
    expect(clock.getMode()).toBe('frozen');
    expect(clock.isFrozen()).toBe(true);
  });

  it('real mode tracks the wall clock', () => {
    const clock = new SimClock('real', 0);
    const before = Date.now();
    const now = clock.now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(clock.isFrozen()).toBe(false);
  });

  it('setMode switches between real and frozen, keeping a value across the switch', () => {
    const clock = new SimClock('real', 0);
    clock.setMode('frozen', 555);
    expect(clock.now()).toBe(555);
    clock.setMode('frozen');
    expect(clock.now()).toBe(555);
    clock.setMode('real');
    expect(clock.isFrozen()).toBe(false);
  });

  it('sleep in frozen mode advances the frozen value without waiting', async () => {
    const clock = new SimClock('frozen', 0);
    const start = Date.now();
    await clock.sleep(10_000);
    expect(Date.now() - start).toBeLessThan(500);
    expect(clock.now()).toBe(10_000);
  });

  it('sleep in real mode waits, and rejects when aborted', async () => {
    const clock = new SimClock('real', 0);
    const start = Date.now();
    await clock.sleep(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);

    const controller = new AbortController();
    const pending = clock.sleep(5000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
