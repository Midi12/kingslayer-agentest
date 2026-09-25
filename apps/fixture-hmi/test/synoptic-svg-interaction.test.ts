/**
 * Browser-driven regression test for the SVG synoptic's click path (round 3 review): the
 * click handler used to call `location.reload()` immediately after posting Start, so a
 * healthy click (no fault active) left the reloaded page showing the pending, amber
 * "Stopped" state until a manual reload, forever indistinguishable from `wrong-state`.
 * `pollThenReload` (shared with the conveyors table, `src/core/render/html.ts`) fixes
 * that; this test drives a real browser against a real clock so the fix is checked
 * end to end, not just by reading the rendered HTML.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { FixtureServerHandle } from '../src/index.js';
import { createFixtureServer } from '../src/index.js';
import { launchBrowser, loginContext } from './helpers/browser.js';

let browser: Browser;
let handle: FixtureServerHandle;
let context: BrowserContext;
let page: Page;

beforeEach(async () => {
  browser = await launchBrowser();
  // Real clock: the pending delay must actually elapse while the page polls, the same
  // way a live fixture behaves (a frozen clock would need an explicit clock-advance
  // call the page's own script never makes).
  handle = await createFixtureServer({ seed: 41, clock: 'real', logger: false });
  const authed = await loginContext(browser, handle);
  context = authed.context;
  page = authed.page;
});

afterEach(async () => {
  await context.close();
  await handle.close();
  await browser.close();
});

describe('SVG synoptic click path', () => {
  it('shows the conveyor green, not stuck amber/Stopped, once Start has actually resolved', async () => {
    await page.goto(`${handle.url}/synoptic/svg`);
    await page.locator('[data-testid="svg-c05"]').click();

    // The fixed page polls /sim/state until C05 is no longer pending before it reloads,
    // so by the time the click's own navigation settles the indicator must already be
    // green and the title must already say Running — never the amber "Stopped" the bug
    // left behind (START_DELAY_MS is 800ms; this waits well past it).
    await page.waitForFunction(
      () => {
        const rect = document.querySelector('[data-testid="svg-c05"] rect');
        return rect?.getAttribute('fill') === '#16a34a';
      },
      { timeout: 5000 },
    );
    const title = await page.locator('[data-testid="svg-c05"] title').textContent();
    expect(title).toBe('C05 - Running');

    const state = (await fetch(`${handle.url}/sim/state`).then((res) => res.json())) as {
      conveyors: { id: string; status: string }[];
    };
    expect(state.conveyors.find((c) => c.id === 'C05')?.status).toBe('Running');
  });
});
