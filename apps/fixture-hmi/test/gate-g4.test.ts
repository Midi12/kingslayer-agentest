/**
 * M02-G4: the blink is a real 1 Hz. In real-time clock mode, the computed background
 * colour of an unacknowledged alarm row, sampled for 5 s, shows a period of
 * 1,000 ± 100 ms.
 */
import { recordGateMetrics } from '@argus/testkit';
import { describe, expect, it } from 'vitest';
import { launchBrowser, loginContext } from './helpers/browser.js';
import { createFixtureServer } from '../src/index.js';

describe('M02-G4 the alarm blink is a real 1 Hz square wave', () => {
  it('samples the computed background for 5s and measures a ~1000ms period', async () => {
    const browser = await launchBrowser();
    const handle = await createFixtureServer({ seed: 12, clock: 'real', logger: false });
    const { context, page } = await loginContext(browser, handle);
    await page.goto(`${handle.url}/alarms`);

    const samples = await page.evaluate(async () => {
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

    await context.close();
    await browser.close();
    await handle.close();

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

    // Half-periods: the gap between one transition and the next should itself be ~500ms
    // (the spec's "500 ms on, 500 ms off"), not just the full on-off-on period averaging
    // to 1000ms — a wave with a 200/800 duty cycle can still average a ~1000ms period.
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

    // A true square wave alternates between exactly two colours, not a gradient or a
    // flicker through more states.
    const distinctColors = new Set(samples.map((sample) => sample.color)).size;

    recordGateMetrics({
      samples: samples.length,
      transitions: transitions.length,
      meanPeriodMs: meanPeriod,
      meanHalfPeriodMs: meanHalfPeriod,
      distinctColors,
    });

    expect(meanPeriod).toBeGreaterThanOrEqual(900);
    expect(meanPeriod).toBeLessThanOrEqual(1100);
    expect(meanHalfPeriod).toBeGreaterThanOrEqual(400);
    expect(meanHalfPeriod).toBeLessThanOrEqual(600);
    expect(distinctColors).toBe(2);
  });
});
