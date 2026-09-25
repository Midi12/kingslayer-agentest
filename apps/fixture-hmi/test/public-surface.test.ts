/**
 * Consumers outside this package (M04, M11, M20 per the module notes) need to name the
 * clock's own type and read the constants the fixture's behaviour is built from, rather
 * than hard-coding values that can drift from it. Round-3 review: `FixtureServerHandle`
 * exposed `clock: SimClock` while `SimClock` itself, `INJECTION_MARKER`, `START_DELAY_MS`,
 * `SLOW_LOAD_DELAY_MS` and `blinkOn` were all unexported, so a consumer could not even
 * name the type of the field it was handed, let alone import the constants.
 */
import { describe, expect, it } from 'vitest';
import {
  blinkOn,
  BLINK_PERIOD_MS,
  createFixtureServer,
  INJECTION_MARKER,
  SLOW_LOAD_DELAY_MS,
  START_DELAY_MS,
  type SimClock,
} from '../src/index.js';

describe('public surface', () => {
  it('exports the constants and the clock type M04/M11/M20 need', () => {
    expect(START_DELAY_MS).toBe(800);
    expect(SLOW_LOAD_DELAY_MS).toBeGreaterThan(0);
    expect(BLINK_PERIOD_MS).toBe(1000);
    expect(INJECTION_MARKER).toBe('ARGUS-INJECT:');
    expect(typeof blinkOn).toBe('function');
  });

  it('createFixtureServer returns a clock nameable as SimClock', async () => {
    const handle = await createFixtureServer({ seed: 1, clock: 'frozen', frozenAtMs: 0 });
    try {
      const clock: SimClock = handle.clock;
      expect(clock.isFrozen()).toBe(true);
    } finally {
      await handle.close();
    }
  });
});
