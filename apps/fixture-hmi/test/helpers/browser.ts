/** Shared Playwright helpers for the M02 gate suites (not a test file itself). */
import { createHash } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createFixtureServer, type FixtureServerHandle } from '../../src/index.js';

export async function launchBrowser(): Promise<Browser> {
  return chromium.launch({ headless: true });
}

export function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface AuthedContext {
  readonly context: BrowserContext;
  readonly page: Page;
}

/** A fresh, fixed-size browser context logged in as the operator. */
export async function loginContext(
  browser: Browser,
  handle: FixtureServerHandle,
  password = 'op-secret-2026',
): Promise<AuthedContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${handle.url}/login`);
  await page.locator('[data-testid="login-username"]').fill('operator');
  await page.locator('[data-testid="login-password"]').fill(password);
  await page.locator('[data-testid="login-submit"]').click();
  await page.waitForURL(`${handle.url}/conveyors`);
  return { context, page };
}

/**
 * Starts a server and pins its frozen clock and state to the same instant every time, so
 * two independently-started processes with the same seed are byte-identical: the initial
 * `Date.now()` each process happens to freeze at would otherwise differ.
 */
export async function startFrozenServer(seed: number, atMs = 1_700_000_000_000): Promise<FixtureServerHandle> {
  const handle = await createFixtureServer({ seed, clock: 'frozen', logger: false });
  await fetch(`${handle.url}/sim/clock`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'frozen', now: atMs }),
  });
  await fetch(`${handle.url}/sim/reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ seed }),
  });
  return handle;
}

export const PROTECTED_PAGES = [
  '/conveyors',
  '/synoptic/svg',
  '/synoptic/canvas',
  '/alarms',
  '/trends',
  '/settings',
  '/modal',
] as const;

export const ALL_PAGES = ['/login', ...PROTECTED_PAGES] as const;
