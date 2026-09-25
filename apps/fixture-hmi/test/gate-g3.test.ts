/**
 * M02-G3: datasets are sound. Every grounding task's answer resolves to exactly one
 * element (through open shadow roots and same-origin iframes), or to none when labelled
 * `none`; minimum counts are met; ids are unique. Every break task's step validates
 * against `@argus/contracts`' `Step` schema.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from '@argus/contracts';
import { recordGateMetrics } from '@argus/testkit';
import { Value } from '@sinclair/typebox/value';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright';
import { BreakTask, GroundingTask, PAGES, parseJsonl, type Page as FixturePage } from '../src/core/dataset-schema.js';
import { launchBrowser, loginContext } from './helpers/browser.js';
import { createFixtureServer, type FixtureServerHandle } from '../src/index.js';

const DATASETS_DIR = join(import.meta.dirname, '..', 'datasets');

interface RawGrounding {
  id: string;
  page: FixturePage;
  faults: string[];
  seed: number;
  locale: 'en' | 'fr';
  target: { description: string; hints?: string };
  action: string;
  answer: string;
  probe?: string;
}

interface RawBreak {
  id: string;
  faults: string[];
  page: FixturePage;
  step: unknown;
  expected: string;
}

const grounding = parseJsonl(readFileSync(join(DATASETS_DIR, 'grounding.jsonl'), 'utf8')) as RawGrounding[];
const breaks = parseJsonl(readFileSync(join(DATASETS_DIR, 'breaks.jsonl'), 'utf8')) as RawBreak[];

const groundingUniqueIds = new Set(grounding.map((task) => task.id)).size;
const breaksUniqueIds = new Set(breaks.map((task) => task.id)).size;
recordGateMetrics({
  groundingTasks: grounding.length,
  groundingIdsUnique: groundingUniqueIds === grounding.length,
  svgTasks: grounding.filter((task) => task.page === '/synoptic/svg').length,
  frTasks: grounding.filter((task) => task.locale === 'fr').length,
  noneTasksDeclared: grounding.filter((task) => task.answer === 'none').length,
  breakTasks: breaks.length,
  breaksIdsUnique: breaksUniqueIds === breaks.length,
  groundingSchemaInvalid: grounding.filter((task) => !Value.Check(GroundingTask, task)).length,
  breaksSchemaInvalid: breaks.filter((task) => !Value.Check(BreakTask, task)).length,
  breaksStepInvalid: breaks.filter((task) => !validate('Step', task.step).ok).length,
});

describe('grounding.jsonl schema and counts', () => {
  it('every task matches the GroundingTask schema', () => {
    const invalid = grounding.filter((task) => !Value.Check(GroundingTask, task));
    expect(invalid.map((task) => task.id)).toEqual([]);
  });

  it('has at least 120 tasks, 30 in French and 20 on the SVG synoptic', () => {
    expect(grounding.length).toBeGreaterThanOrEqual(120);
    expect(grounding.filter((task) => task.locale === 'fr').length).toBeGreaterThanOrEqual(30);
    expect(grounding.filter((task) => task.page === '/synoptic/svg').length).toBeGreaterThanOrEqual(20);
  });

  it('includes the twenty identical Start buttons and several none tasks', () => {
    const starts = grounding.filter((task) => /^start-c\d\d$/.test(task.answer));
    expect(new Set(starts.map((task) => task.answer)).size).toBe(20);
    expect(grounding.filter((task) => task.answer === 'none').length).toBeGreaterThanOrEqual(5);
  });

  it('has unique ids', () => {
    const ids = grounding.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('breaks.jsonl schema, counts and Step validity', () => {
  it('every task matches the BreakTask schema and its step is a valid contracts Step', () => {
    const schemaInvalid = breaks.filter((task) => !Value.Check(BreakTask, task));
    expect(schemaInvalid.map((task) => task.id)).toEqual([]);

    const stepInvalid = breaks
      .map((task) => ({ id: task.id, result: validate('Step', task.step) }))
      .filter((entry) => !entry.result.ok);
    expect(stepInvalid.map((entry) => entry.id)).toEqual([]);
  });

  it('has at least 60 tasks with unique ids', () => {
    expect(breaks.length).toBeGreaterThanOrEqual(60);
    const ids = breaks.map((task) => task.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every page it references is one of the eight fixture pages', () => {
    const bad = breaks.filter((task) => !(PAGES as readonly string[]).includes(task.page));
    expect(bad.map((task) => task.id)).toEqual([]);
  });
});

/**
 * Resolves a `[data-testid=...]` selector through open shadow roots (Playwright's locator
 * engine pierces those automatically) and same-origin iframes (each a separate frame).
 */
async function countTestId(page: Page, testId: string): Promise<number> {
  const mainFrame = page.mainFrame();
  let total = await mainFrame.locator(`[data-testid="${testId}"]`).count();
  for (const frame of page.frames()) {
    if (frame !== mainFrame) {
      total += await frame.locator(`[data-testid="${testId}"]`).count();
    }
  }
  return total;
}

describe('grounding answers resolve live against the fixture', () => {
  let browser: Browser;
  let context: BrowserContext | undefined;
  let page: Page;
  let handle: FixtureServerHandle;
  let resolvable = 0;
  let noneTasks = 0;
  const resolutionFailures: string[] = [];

  beforeAll(async () => {
    browser = await launchBrowser();
  });

  afterAll(async () => {
    await browser.close();
    recordGateMetrics({
      tasks: grounding.length,
      breaks: breaks.length,
      resolvable,
      noneTasks,
      resolutionFailures: resolutionFailures.length,
      everyTaskAccountedFor: resolvable + noneTasks === grounding.length,
    });
  });

  it('resolves a representative sample of every page, including under its faults', async () => {
    const seeds = new Set(grounding.map((task) => task.seed));
    for (const seed of seeds) {
      handle = await createFixtureServer({ seed, clock: 'frozen', logger: false });
      // Round-2 review: `context`/`handle` used to close only after this whole loop body
      // ran to completion, so a `fetch` or `page.goto` throwing partway through (rather
      // than an `expect`, which only runs after the loop) left a browser context and a
      // listening socket behind for the rest of the Vitest worker. try/finally closes
      // this seed's context and server regardless; `context` is reset first so the
      // finally below never re-closes a previous iteration's already-closed context if
      // `loginContext` itself is what throws.
      context = undefined;
      try {
        const authed = await loginContext(browser, handle);
        context = authed.context;
        page = authed.page;

        const tasksForSeed = grounding.filter((task) => task.seed === seed);
        interface Context {
          readonly page: FixturePage;
          readonly faults: readonly string[];
          readonly tasks: RawGrounding[];
        }
        const byContext = new Map<string, Context>();
        for (const task of tasksForSeed) {
          const faults = [...task.faults].sort((a, b) => a.localeCompare(b));
          const key = `${task.page}|${faults.join(',')}`;
          const existing = byContext.get(key);
          if (existing === undefined) {
            byContext.set(key, { page: task.page, faults, tasks: [task] });
          } else {
            existing.tasks.push(task);
          }
        }

        for (const { page: taskPage, faults, tasks } of byContext.values()) {
          for (const fault of faults) {
            await fetch(`${handle.url}/sim/faults/${fault}`, { method: 'POST' });
          }
          await page.goto(`${handle.url}${taskPage}`);
          for (const task of tasks) {
            if (task.answer === 'none') {
              // The pass condition is "resolves to exactly one element, or to none when
              // labelled none" — the none half is only proved by actually checking the
              // described target is absent, via a negative probe (a testid a wrong pick
              // would match) asserted to resolve to zero elements on this page and faults.
              if (task.probe === undefined || task.probe.trim() === '') {
                resolutionFailures.push(`${task.id} (none): missing probe`);
                continue;
              }
              const probeCount = await countTestId(page, task.probe);
              if (probeCount === 0) {
                noneTasks += 1;
              } else {
                resolutionFailures.push(`${task.id} (none, probe ${task.probe}): found ${String(probeCount)}`);
              }
              continue;
            }
            const count = await countTestId(page, task.answer);
            if (count === 1) {
              resolvable += 1;
            } else {
              resolutionFailures.push(`${task.id} (${task.answer}): found ${String(count)}`);
            }
          }
          for (const fault of faults) {
            await fetch(`${handle.url}/sim/faults/${fault}`, { method: 'DELETE' });
          }
        }
      } finally {
        if (context !== undefined) {
          await context.close();
        }
        await handle.close();
      }
    }

    expect(resolutionFailures).toEqual([]);
    expect(resolvable + noneTasks).toBe(grounding.length);
  });
});
