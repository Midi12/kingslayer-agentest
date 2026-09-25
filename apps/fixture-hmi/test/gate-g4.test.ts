/**
 * M02-G4: the blink is a real 1 Hz. In real-time clock mode, the computed background
 * colour of an unacknowledged alarm row, sampled for 5 s, shows a period of
 * 1,000 ± 100 ms, with each half-period itself close to 500ms (not just their mean).
 */
import { recordGateMetrics } from '@argus/testkit';
import { describe, expect, it } from 'vitest';
import { launchBrowser, loginContext } from './helpers/browser.js';
import { createFixtureServer } from '../src/index.js';

interface Sample {
  readonly t: number;
  readonly color: string;
}

async function sampleAlarmRow(handle: Awaited<ReturnType<typeof createFixtureServer>>): Promise<Sample[]> {
  const browser = await launchBrowser();
  // Round-2 review: the browser, server and context used to close only after every
  // `expect` below had already run, so a failing assertion left a Chromium context and
  // a listening socket behind for the rest of the Vitest worker. try/finally closes them
  // regardless of how sampling or the caller's assertions turn out.
  try {
    const { context, page } = await loginContext(browser, handle);
    try {
      await page.goto(`${handle.url}/alarms`);
      return await page.evaluate(async () => {
        const found = document.querySelector('[data-testid^="alarm-row-"]');
        if (found === null) {
          throw new Error('no alarm row found');
        }
        const row: Element = found;
        const out: { t: number; color: string }[] = [];
        const start = performance.now();
        await new Promise<void>((resolve) => {
          function tick(): void {
            const color = getComputedStyle(row).backgroundColor;
            out.push({ t: performance.now() - start, color });
            if (performance.now() - start < 5000) {
              requestAnimationFrame(tick);
            } else {
              resolve();
            }
          }
          requestAnimationFrame(tick);
        });
        return out;
      });
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

describe('M02-G4 the alarm blink is a real 1 Hz square wave', () => {
  it('samples the computed background for 5s and measures a ~1000ms period with a ~500/500 duty cycle', async () => {
    const handle = await createFixtureServer({ seed: 12, clock: 'real', logger: false });
    let samples: Sample[];
    try {
      samples = await sampleAlarmRow(handle);
    } finally {
      await handle.close();
    }

    expect(samples.length).toBeGreaterThan(50);

    // Find transition timestamps: consecutive samples where the colour changes.
    const transitions: number[] = [];
    for (let i = 1; i < samples.length; i += 1) {
      const prev = samples[i - 1];
      const cur = samples[i];
      if (prev === undefined || cur === undefined) {
        continue;
      }
      if (prev.color !== cur.color) {
        transitions.push(cur.t);
      }
    }
    expect(transitions.length).toBeGreaterThanOrEqual(4);

    // A period is two consecutive transitions (on->off->on).
    const periods: number[] = [];
    for (let i = 2; i < transitions.length; i += 1) {
      const cur = transitions[i];
      const prevPrev = transitions[i - 2];
      if (cur === undefined || prevPrev === undefined) {
        continue;
      }
      periods.push(cur - prevPrev);
    }
    const meanPeriod = periods.reduce((sum, p) => sum + p, 0) / periods.length;

    // Half-periods: the gap between one transition and the next. Gate-change M02-3 added
    // a *mean* half-period bound here, but that does not actually catch a wrong duty
    // cycle: for any square wave of period P the half-periods alternate a, b with
    // a + b = P, so their mean is ~P/2 (~500ms) whatever a and b individually are — a
    // 200/800ms wave's nine half-periods over 5s still average ~467ms, inside a
    // 400-600ms mean window (independent review, round 2; M02-3's "a wave whose
    // half-periods are not ~500/~500 ... fails them regardless of what the full-period
    // mean reports" was not true of the mean check it added). Bound every individual
    // half-period instead: a 200/800 wave then has half-periods far outside 400-600ms.
    const halfPeriods: number[] = [];
    for (let i = 1; i < transitions.length; i += 1) {
      const cur = transitions[i];
      const prev = transitions[i - 1];
      if (cur === undefined || prev === undefined) {
        continue;
      }
      halfPeriods.push(cur - prev);
    }
    const meanHalfPeriod = halfPeriods.reduce((sum, p) => sum + p, 0) / halfPeriods.length;
    const halfPeriodsOutOfBand = halfPeriods.filter((p) => p < 400 || p > 600).length;

    // A true square wave alternates between exactly two colours, not a gradient or a
    // flicker through more states.
    const distinctColors = new Set(samples.map((sample) => sample.color)).size;

    recordGateMetrics({
      samples: samples.length,
      transitions: transitions.length,
      meanPeriodMs: meanPeriod,
      meanHalfPeriodMs: meanHalfPeriod,
      halfPeriodsOutOfBand,
      distinctColors,
    });

    expect(meanPeriod).toBeGreaterThanOrEqual(900);
    expect(meanPeriod).toBeLessThanOrEqual(1100);
    // Every half-period individually within 400-600ms, not just their mean.
    for (const halfPeriod of halfPeriods) {
      expect(halfPeriod).toBeGreaterThanOrEqual(400);
      expect(halfPeriod).toBeLessThanOrEqual(600);
    }
    expect(halfPeriodsOutOfBand).toBe(0);
    expect(distinctColors).toBe(2);
  });
});
