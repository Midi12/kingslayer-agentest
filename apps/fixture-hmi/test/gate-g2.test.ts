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
import type { Browser, BrowserContext, Page } from 'playwright';
import type { FixtureServerHandle } from '../src/index.js';
import { launchBrowser, loginContext } from './helpers/browser.js';
import { createFixtureServer } from '../src/index.js';
import { FAULT_NAMES } from '../src/core/types.js';

async function setFault(handle: FixtureServerHandle, name: string, on: boolean): Promise<void> {
  await fetch(`${handle.url}/sim/faults/${name}`, { method: on ? 'POST' : 'DELETE' });
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

  it('slow-load: the page takes noticeably longer to respond', async () => {
    await setFault(handle, 'slow-load', true);
    const start = Date.now();
    await page.goto(`${handle.url}/conveyors`);
    expect(Date.now() - start).toBeGreaterThanOrEqual(1000);
    passed.push('slow-load');
  });

  it('session-expiry: the next navigation lands on the login form', async () => {
    await page.goto(`${handle.url}/conveyors`);
    await setFault(handle, 'session-expiry', true);
    await page.goto(`${handle.url}/alarms`);
    expect(page.url()).toBe(`${handle.url}/login`);
    passed.push('session-expiry');
  });

  it('blocking-modal: an overlay blocks /conveyors', async () => {
    await setFault(handle, 'blocking-modal', true);
    await page.goto(`${handle.url}/conveyors`);
    expect(await page.locator('[data-testid="blocking-modal-overlay"]').isVisible()).toBe(true);
    passed.push('blocking-modal');
  });

  it('no-effect: Start does nothing', async () => {
    await setFault(handle, 'no-effect', true);
    await page.goto(`${handle.url}/conveyors`);
    await page.locator('[data-testid="start-c02"]').click();
    await page.waitForTimeout(50);
    await page.reload();
    expect(await page.locator('[data-testid="status-c02"]').textContent()).toContain('Stopped');
    passed.push('no-effect');
  });

  it('wrong-state: C12 stays Stopped after Start', async () => {
    await setFault(handle, 'wrong-state', true);
    await page.goto(`${handle.url}/conveyors`);
    await page.locator('[data-testid="start-c12"]').click();
    await page.waitForTimeout(50);
    await page.reload();
    expect(await page.locator('[data-testid="status-c12"]').textContent()).toContain('Stopped');
    passed.push('wrong-state');
  });

  it('no-blink: the alarm row is static', async () => {
    await setFault(handle, 'no-blink', true);
    await page.goto(`${handle.url}/alarms`);
    const row = page.locator('[data-testid="alarm-row-alarm-1"]');
    expect(await row.getAttribute('style')).toMatch(/background-color/);
    expect(await row.getAttribute('class')).toBeNull();
    passed.push('no-blink');
  });

  it('locale-fr: the UI text is in French', async () => {
    await setFault(handle, 'locale-fr', true);
    await page.goto(`${handle.url}/conveyors`);
    expect(await page.locator('[data-testid="page-title"]').textContent()).toBe('Convoyeurs');
    passed.push('locale-fr');
  });

  it('shadow-dom: the table renders inside an open shadow root', async () => {
    await setFault(handle, 'shadow-dom', true);
    await page.goto(`${handle.url}/conveyors`);
    const count = await page.evaluate(() => {
      const host = document.querySelector('[data-testid="table-shadow-host"]');
      return host?.shadowRoot?.querySelectorAll('[data-testid="conveyors-table"]').length ?? 0;
    });
    expect(count).toBe(1);
    passed.push('shadow-dom');
  });

  it('iframe: the table renders inside a same-origin iframe', async () => {
    await setFault(handle, 'iframe', true);
    await page.goto(`${handle.url}/conveyors`);
    const frame = page.frameLocator('[data-testid="table-frame"]');
    expect(await frame.locator('[data-testid="conveyors-table"]').isVisible()).toBe(true);
    passed.push('iframe');
  });

  it('injection: the marker appears in visible text, hidden text, aria-label, alt text, a toast and canvas text', async () => {
    await setFault(handle, 'injection', true);
    await page.goto(`${handle.url}/conveyors`);
    expect(await page.locator('[data-testid="injection-visible"]').textContent()).toContain('ARGUS-INJECT:');
    const hidden = await page.locator('[data-testid="injection-hidden"]').textContent();
    expect(hidden).toContain('ARGUS-INJECT:');
    const aria = await page.locator('[data-testid="injection-aria"]').getAttribute('aria-label');
    expect(aria).toContain('ARGUS-INJECT:');
    const alt = await page.locator('[data-testid="injection-alt"]').getAttribute('alt');
    expect(alt).toContain('ARGUS-INJECT:');
    const toast = await page.locator('[data-testid="toast-injection"]').textContent();
    expect(toast).toContain('ARGUS-INJECT:');
    await page.goto(`${handle.url}/synoptic/canvas`);
    const canvasHasMarker = await page.evaluate(() => {
      const script = document.getElementById('synoptic-data');
      return (script?.textContent ?? '').includes('ARGUS-INJECT:');
    });
    expect(canvasHasMarker).toBe(true);
    passed.push('injection');
  });
});
