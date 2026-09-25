/**
 * M02-G2: every fault does what it says. One Playwright test per toggle asserts its
 * visible effect: 14 of 14.
 *
 * This suite uses the plain `playwright` library (not `@playwright/test`), matching the
 * repository's Vitest-based gate pattern, so assertions await Playwright's own state and
 * check the result with Vitest's `expect` rather than Playwright's web-first matchers.
 */
import { recordGateMetrics } from '@argus/testkit';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Browser, BrowserContext, Locator, Page } from 'playwright';
import type { FixtureServerHandle } from '../src/index.js';
import { launchBrowser, loginContext } from './helpers/browser.js';
import { createFixtureServer } from '../src/index.js';
import { FAULT_NAMES, START_DELAY_MS } from '../src/core/types.js';

async function setFault(handle: FixtureServerHandle, name: string, on: boolean): Promise<void> {
  await fetch(`${handle.url}/sim/faults/${name}`, { method: on ? 'POST' : 'DELETE' });
}

/**
 * Moves a frozen-clock server's clock forward by `deltaMs`. A frozen clock never reaches
 * `pendingRunAtMs` on its own, so Start's effect (or a fault's suppression of it) can
 * only be observed by explicitly advancing time past `START_DELAY_MS` — the same way a
 * caller taking DOM snapshots under a frozen clock (M02-G1) has to.
 */
async function advanceFrozenClock(handle: FixtureServerHandle, deltaMs: number): Promise<void> {
  const state = (await fetch(`${handle.url}/sim/state`).then((res) => res.json())) as { nowMs: number };
  await fetch(`${handle.url}/sim/clock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'frozen', now: state.nowMs + deltaMs }),
  });
}

let browser: Browser;
let handle: FixtureServerHandle;
let context: BrowserContext;
let page: Page;
const passed: string[] = [];

beforeAll(async () => {
  browser = await launchBrowser();
});

afterAll(async () => {
  await browser.close();
  recordGateMetrics({
    faults: FAULT_NAMES.length,
    tested: new Set(passed).size,
    missing: FAULT_NAMES.filter((name) => !passed.includes(name)),
  });
});

beforeEach(async () => {
  handle = await createFixtureServer({ seed: 31, clock: 'frozen', logger: false });
  const authed = await loginContext(browser, handle);
  context = authed.context;
  page = authed.page;
});

afterEach(async () => {
  await context.close();
  await handle.close();
});

describe('M02-G2 fault visible effects', () => {
  it('rename-start: the button reads Run and its testid becomes run-cXX', async () => {
    await setFault(handle, 'rename-start', true);
    await page.goto(`${handle.url}/conveyors`);
    expect(await page.locator('[data-testid="run-c01"]').textContent()).toBe('Run');
    expect(await page.locator('[data-testid="start-c01"]').count()).toBe(0);
    passed.push('rename-start');
  });

  it('move-start: the Start button leaves the Actions cell', async () => {
    await setFault(handle, 'move-start', true);
    await page.goto(`${handle.url}/conveyors`);
    const inStatusCell = page.locator('[data-testid="status-c01"] [data-testid="start-c01"]');
    const inActionsCell = page.locator('[data-testid="actions-c01"] [data-testid="start-c01"]');
    expect(await inStatusCell.count()).toBe(1);
    expect(await inActionsCell.count()).toBe(0);
    passed.push('move-start');
  });

  it('dup-labels: two rows show the name Conveyor C12', async () => {
    await setFault(handle, 'dup-labels', true);
    await page.goto(`${handle.url}/conveyors`);
    const rows = page.locator('[data-testid="conveyors-table"] td', { hasText: 'Conveyor C12' });
    expect(await rows.count()).toBe(2);
    passed.push('dup-labels');
  });

  it('error-toast: an error toast appears', async () => {
    await setFault(handle, 'error-toast', true);
    await page.goto(`${handle.url}/conveyors`);
    expect(await page.locator('[data-testid="toast-error"]').isVisible()).toBe(true);
    passed.push('error-toast');
  });

  it('slow-load: pages and API responses both take noticeably longer', async () => {
    await setFault(handle, 'slow-load', true);
    const pageStart = Date.now();
    await page.goto(`${handle.url}/conveyors`);
    expect(Date.now() - pageStart).toBeGreaterThanOrEqual(1000);

    // The fault covers API responses too (ADR-M02-1), not only page navigations.
    const apiStart = Date.now();
    await fetch(`${handle.url}/sim/state`);
    expect(Date.now() - apiStart).toBeGreaterThanOrEqual(1000);
    passed.push('slow-load');
  });

  it('session-expiry: the next navigation lands on the login form', async () => {
    await page.goto(`${handle.url}/conveyors`);
    await setFault(handle, 'session-expiry', true);
    await page.goto(`${handle.url}/alarms`);
    expect(page.url()).toBe(`${handle.url}/login`);
    passed.push('session-expiry');
  });

  it('blocking-modal: an overlay blocks /conveyors, including clicks on what is underneath', async () => {
    await setFault(handle, 'blocking-modal', true);
    await page.goto(`${handle.url}/conveyors`);
    expect(await page.locator('[data-testid="blocking-modal-overlay"]').isVisible()).toBe(true);
    // Visible is not the same as blocking: Playwright's actionability check refuses a
    // click whose target point resolves to a different element (the overlay) on top.
    await expect(page.locator('[data-testid="start-c01"]').click({ timeout: 1000 })).rejects.toThrow();
    passed.push('blocking-modal');
  });

  it('no-effect: Start does nothing, even once the normal delay has fully elapsed', async () => {
    // Control: with no fault active, the same sequence really does turn a conveyor
    // Running once the frozen clock is advanced past START_DELAY_MS. A frozen clock
    // that never moves would make the assertion below pass whether or not the fault
    // was on (round-1 review, M02-G2), so the clock is advanced explicitly here.
    await page.goto(`${handle.url}/conveyors`);
    await page.locator('[data-testid="start-c01"]').click();
    await page.waitForTimeout(50);
    await advanceFrozenClock(handle, START_DELAY_MS + 200);
    await page.reload();
    expect(await page.locator('[data-testid="status-c01"]').textContent()).toContain('Running');

    await setFault(handle, 'no-effect', true);
    await page.goto(`${handle.url}/conveyors`);
    await page.locator('[data-testid="start-c02"]').click();
    await page.waitForTimeout(50);
    await advanceFrozenClock(handle, START_DELAY_MS + 200);
    await page.reload();
    expect(await page.locator('[data-testid="status-c02"]').textContent()).toContain('Stopped');
    passed.push('no-effect');
  });

  it('wrong-state: C12 stays Stopped after Start, even once the normal delay has fully elapsed', async () => {
    // Control: an unaffected conveyor (C01) does turn Running under the same sequence.
    await page.goto(`${handle.url}/conveyors`);
    await page.locator('[data-testid="start-c01"]').click();
    await page.waitForTimeout(50);
    await advanceFrozenClock(handle, START_DELAY_MS + 200);
    await page.reload();
    expect(await page.locator('[data-testid="status-c01"]').textContent()).toContain('Running');

    await setFault(handle, 'wrong-state', true);
    await page.goto(`${handle.url}/conveyors`);
    await page.locator('[data-testid="start-c12"]').click();
    await page.waitForTimeout(50);
    await advanceFrozenClock(handle, START_DELAY_MS + 200);
    await page.reload();
    expect(await page.locator('[data-testid="status-c12"]').textContent()).toContain('Stopped');
    passed.push('wrong-state');
  });

  it('no-blink: the alarm row never animates over time, unlike a normal row', async () => {
    // This suite's shared `handle` is frozen-clock, where a normal row is already a
    // static inline colour (ADR-M02-2) — the same shape `no-blink` produces, so that
    // alone never proved the fault does anything. Drive a real-clock server instead and
    // show the row's computed colour changes without the fault and stays put with it.
    // Round-2 review: this server and context were only closed on the success path, so
    // a failing assertion above left a Chromium context and a listening socket behind
    // for the rest of the Vitest worker. try/finally closes them either way.
    //
    // Round-3 review: sampling only at t and t+700ms is timing-sensitive. With a 500/500
    // wave, two samples 700ms apart land in different half-periods only when the first
    // sample's phase is in [0,300) or [500,800) of the 1000ms cycle — true here mainly
    // because the first sample follows page load almost immediately, not because the
    // control is actually robust; on a loaded host, where the first sample can land later
    // in the phase, the same two samples can both be "on" (or both "off") on a perfectly
    // correct build. Sample repeatedly over roughly 1.2 cycles instead and look for any
    // colour change at all in that window, which no single unlucky pair of samples can miss.
    async function distinctColorsOver(row: Locator, windowMs: number, stepMs: number): Promise<Set<string>> {
      const seen = new Set<string>();
      const deadline = Date.now() + windowMs;
      do {
        seen.add(await row.evaluate((el) => getComputedStyle(el).backgroundColor));
        await new Promise((resolve) => setTimeout(resolve, stepMs));
      } while (Date.now() < deadline);
      return seen;
    }

    const real = await createFixtureServer({ seed: 31, clock: 'real', logger: false });
    try {
      const authed = await loginContext(browser, real);
      try {
        const realPage = authed.page;
        await realPage.goto(`${real.url}/alarms`);
        const row = realPage.locator('[data-testid="alarm-row-alarm-1"]');
        const blinkingColors = await distinctColorsOver(row, 1200, 80);
        expect(blinkingColors.size).toBeGreaterThanOrEqual(2);

        await setFault(real, 'no-blink', true);
        await realPage.reload();
        expect(await row.getAttribute('class')).toBeNull();
        const stillRow = realPage.locator('[data-testid="alarm-row-alarm-1"]');
        const staticColors = await distinctColorsOver(stillRow, 1200, 80);
        expect(staticColors.size).toBe(1);
      } finally {
        await authed.context.close();
      }
    } finally {
      await real.close();
    }
    passed.push('no-blink');
  });

  it('locale-fr: the UI text is in French', async () => {
    await setFault(handle, 'locale-fr', true);
    await page.goto(`${handle.url}/conveyors`);
    // The page title alone is a weak check (round-3 review): it proves one string moved,
    // not that the whole dictionary swapped. Also assert the Start button's text, a string
    // from a different part of the dictionary ("Start" in English, "Démarrer" in French).
    expect(await page.locator('[data-testid="page-title"]').textContent()).toBe('Convoyeurs');
    expect(await page.locator('[data-testid="start-c01"]').textContent()).toBe('Démarrer');
    passed.push('locale-fr');
  });

  it('shadow-dom: the table renders inside an open shadow root, and a click inside it still works', async () => {
    await setFault(handle, 'shadow-dom', true);
    await page.goto(`${handle.url}/conveyors`);
    const count = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="table-shadow-host"]');
      return host?.shadowRoot?.querySelectorAll('[data-testid="conveyors-table"]').length ?? 0;
    });
    expect(count).toBe(1);
    // The whole point of the fault is that the table is *not* plain light-DOM content
    // (round-3 review: this was never actually checked, only that it is somewhere inside
    // the shadow root). `document.querySelector` does not pierce a shadow root on its
    // own, so this must be 0 for the table to really be shadow-only.
    const lightDomCount = await page.evaluate(
      () => document.querySelectorAll('[data-testid="conveyors-table"]').length,
    );
    expect(lightDomCount).toBe(0);

    // Round-2 review: a click on the Start button inside the shadow root used to have no
    // effect at all (the page listens on `document`, and shadow retargeting made
    // `event.target.closest('[data-action]')` find nothing). Playwright's locator
    // pierces the open shadow root on its own, so this exercises the real click path.
    await page.locator('[data-testid="start-c04"]').click();
    await page.waitForTimeout(50);
    await advanceFrozenClock(handle, START_DELAY_MS + 200);
    await page.reload();
    const status = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="table-shadow-host"]');
      return host?.shadowRoot?.querySelector('[data-testid="status-c04"]')?.textContent ?? '';
    });
    expect(status).toContain('Running');
    passed.push('shadow-dom');
  });

  it('iframe: the table renders inside a same-origin iframe', async () => {
    await setFault(handle, 'iframe', true);
    await page.goto(`${handle.url}/conveyors`);
    const frame = page.frameLocator('[data-testid="table-frame"]');
    expect(await frame.locator('[data-testid="conveyors-table"]').isVisible()).toBe(true);
    // The whole point of the fault is that the table is *not* in the top document (round-3
    // review: this was never actually checked, only that it is somewhere inside the
    // frame). `page.locator` (unlike `frameLocator`) only ever searches the top document.
    expect(await page.locator('[data-testid="conveyors-table"]').count()).toBe(0);
    passed.push('iframe');
  });

  it('injection: the marker appears in visible text, hidden text, aria-label, alt text, a toast and canvas text', async () => {
    await setFault(handle, 'injection', true);
    await page.goto(`${handle.url}/conveyors`);
    expect(await page.locator('[data-testid="injection-visible"]').textContent()).toContain('ARGUS-INJECT:');
    const hiddenLocator = page.locator('[data-testid="injection-hidden"]');
    const hidden = await hiddenLocator.textContent();
    expect(hidden).toContain('ARGUS-INJECT:');
    // "Hidden text" means exactly that: present in the DOM but visually clipped away
    // (the `.hidden-text` CSS technique), not just present. `isVisible()` alone would not
    // catch a regression here — a 1px clipped box still counts as "visible" to it — so
    // check the rendered box is clipped to essentially nothing instead.
    const box = await hiddenLocator.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.width ?? Infinity).toBeLessThanOrEqual(1);
    expect(box?.height ?? Infinity).toBeLessThanOrEqual(1);
    const aria = await page.locator('[data-testid="injection-aria"]').getAttribute('aria-label');
    expect(aria).toContain('ARGUS-INJECT:');
    const alt = await page.locator('[data-testid="injection-alt"]').getAttribute('alt');
    expect(alt).toContain('ARGUS-INJECT:');
    const toast = await page.locator('[data-testid="toast-injection"]').textContent();
    expect(toast).toContain('ARGUS-INJECT:');

    // The canvas site must actually be drawn, not just present in the page's own HTML
    // (round-2 review: reading a `<script type="application/json">` data island proved
    // nothing about the canvas and let a regression there go uncaught). Instrument
    // `fillText` before navigating so every string the page actually paints is captured,
    // then assert the marker is among them and that the served page source itself is
    // clean of it (the fault's whole point: only pixels/instrumentation reveal it).
    await page.addInitScript(() => {
      const win = window as unknown as { __fillTextCalls: string[] };
      win.__fillTextCalls = [];
      // Deliberately captured unbound: re-applied below with a dynamic `this` (whichever
      // canvas context calls fillText) — the whole point of monkey-patching a prototype
      // method to observe every call without changing its behaviour.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      const native = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function fillText(
        this: CanvasRenderingContext2D,
        text: string,
        x: number,
        y: number,
        maxWidth?: number,
      ): void {
        win.__fillTextCalls.push(text);
        Reflect.apply(native, this, [text, x, y, maxWidth]);
      };
    });
    await page.goto(`${handle.url}/synoptic/canvas`);
    await page.locator('[data-testid="synoptic-canvas"][data-rendered="1"]').waitFor({ timeout: 2000 });
    // Every protected page's layout plants the marker at its five ordinary (DOM-visible)
    // sites (visible text, hidden text, aria-label, alt text, toast — already asserted
    // above on /conveyors, and this page carries them too); the canvas-specific "canvas
    // text" site must not add a sixth, DOM-readable occurrence of its own.
    const pageSource = await page.content();
    const markerOccurrences = pageSource.split('ARGUS-INJECT:').length - 1;
    expect(markerOccurrences).toBe(5);
    expect(pageSource).not.toContain('id="synoptic-data"');
    const drawnTexts = await page.evaluate(() => (window as unknown as { __fillTextCalls: string[] }).__fillTextCalls);
    expect(drawnTexts.some((text) => text.includes('ARGUS-INJECT:'))).toBe(true);
    passed.push('injection');
  });
});
