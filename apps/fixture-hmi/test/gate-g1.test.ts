/**
 * M02-G1: determinism. The same seed and the same call sequence, played twice against
 * two independently constructed `FixtureSimulator`/server instances (both started in
 * this Node process, not two OS processes — the spec's determinism claim is about the
 * simulator's state, not process isolation), render byte-identical DOM and
 * pixel-identical screenshots on all eight pages.
 */
import { recordGateMetrics } from '@argus/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import type { FixtureServerHandle } from '../src/index.js';
import { ALL_PAGES, launchBrowser, loginContext, sha256, startFrozenServer } from './helpers/browser.js';

const SEED = 21;

async function playSequence(handle: FixtureServerHandle): Promise<void> {
  const calls: [string, unknown][] = [
    ['/sim/conveyors/C01/start', {}],
    ['/sim/conveyors/C05/faults', { type: 'jam' }],
    ['/sim/alarms/alarm-1/ack', undefined],
  ];
  for (const [path, body] of calls) {
    await fetch(`${handle.url}${path}`, {
      method: 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
}

interface Capture {
  readonly dom: string;
  readonly screenshot: string;
}

async function captureAll(browser: Browser, handle: FixtureServerHandle): Promise<Record<string, Capture>> {
  const { context, page } = await loginContext(browser, handle);
  const out: Record<string, Capture> = {};
  for (const path of ALL_PAGES) {
    await page.goto(`${handle.url}${path}`);
    await page.waitForLoadState('networkidle');
    const dom = await page.content();
    const screenshot = await page.screenshot({ fullPage: true });
    out[path] = { dom: sha256(dom), screenshot: sha256(screenshot) };
  }
  await context.close();
  return out;
}

describe('M02-G1 determinism', () => {
  let browser: Browser;
  let a: FixtureServerHandle;
  let b: FixtureServerHandle;

  beforeAll(async () => {
    browser = await launchBrowser();
    a = await startFrozenServer(SEED);
    b = await startFrozenServer(SEED);
    await playSequence(a);
    await playSequence(b);
  });

  afterAll(async () => {
    await browser.close();
    await a.close();
    await b.close();
  });

  it('renders identical DOM and screenshots on all eight pages', async () => {
    const capturesA = await captureAll(browser, a);
    const capturesB = await captureAll(browser, b);

    let domMismatches = 0;
    let screenshotMismatches = 0;
    for (const path of ALL_PAGES) {
      const capA = capturesA[path];
      const capB = capturesB[path];
      expect(capA, path).toBeDefined();
      expect(capB, path).toBeDefined();
      if (capA === undefined || capB === undefined) {
        continue;
      }
      if (capA.dom !== capB.dom) {
        domMismatches += 1;
      }
      if (capA.screenshot !== capB.screenshot) {
        screenshotMismatches += 1;
      }
    }

    recordGateMetrics({ pages: ALL_PAGES.length, domMismatches, screenshotMismatches });
    expect(domMismatches).toBe(0);
    expect(screenshotMismatches).toBe(0);
  });
});
