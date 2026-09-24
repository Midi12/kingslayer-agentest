#!/usr/bin/env -S tsx --conditions=@argus/source
/**
 * Regenerates `datasets/grounding.jsonl` and `datasets/breaks.jsonl` deterministically.
 * Run after any change to the fixture's pages or fault behaviour:
 *
 *   pnpm --filter @argus/fixture-hmi generate-datasets
 *
 * The output is committed; this script is dev tooling, not part of the runtime surface.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Value } from '@sinclair/typebox/value';
import { validate } from '@argus/contracts';
import { BreakTask, GroundingTask, toJsonl, type Page } from '../src/core/dataset-schema.js';
import { CONVEYOR_IDS } from '../src/core/types.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'datasets');

// ---------------------------------------------------------------------------
// grounding.jsonl
// ---------------------------------------------------------------------------

interface RawGrounding {
  id: string;
  page: Page;
  faults: string[];
  seed: number;
  locale: 'en' | 'fr';
  target: { description: string; hints?: string };
  action: 'click' | 'read' | 'type' | 'hover' | 'check';
  answer: string;
}

const grounding: RawGrounding[] = [];

function lower(id: string): string {
  return id.toLowerCase();
}

for (const id of CONVEYOR_IDS) {
  const low = lower(id);
  grounding.push({
    id: `g-start-${low}`,
    page: '/conveyors',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: `The Start button for conveyor ${id}`, hints: `row ${id}, Actions column` },
    action: 'click',
    answer: `start-${low}`,
  });
  grounding.push({
    id: `g-stop-${low}`,
    page: '/conveyors',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: `The Stop button for conveyor ${id}`, hints: `row ${id}, Actions column` },
    action: 'click',
    answer: `stop-${low}`,
  });
  grounding.push({
    id: `g-svg-${low}`,
    page: '/synoptic/svg',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: `The synoptic shape for conveyor ${id}`, hints: `grid position of ${id}` },
    action: 'click',
    answer: `svg-${low}`,
  });
}

// French duplicates: every Start button and the first twelve Stop buttons (>= 30 total).
for (const id of CONVEYOR_IDS) {
  const low = lower(id);
  grounding.push({
    id: `g-fr-start-${low}`,
    page: '/conveyors',
    faults: ['locale-fr'],
    seed: 1,
    locale: 'fr',
    target: { description: `Le bouton Démarrer du convoyeur ${id}`, hints: `ligne ${id}, colonne Actions` },
    action: 'click',
    answer: `start-${low}`,
  });
}
for (const id of CONVEYOR_IDS.slice(0, 12)) {
  const low = lower(id);
  grounding.push({
    id: `g-fr-stop-${low}`,
    page: '/conveyors',
    faults: ['locale-fr'],
    seed: 1,
    locale: 'fr',
    target: { description: `Le bouton Arrêter du convoyeur ${id}`, hints: `ligne ${id}, colonne Actions` },
    action: 'click',
    answer: `stop-${low}`,
  });
}

grounding.push(
  {
    id: 'g-alarm-ack-1',
    page: '/alarms',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Acknowledge button of the first alarm row' },
    action: 'click',
    answer: 'ack-alarm-1',
  },
  {
    id: 'g-alarm-ack-2',
    page: '/alarms',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Acknowledge button of the second alarm row' },
    action: 'click',
    answer: 'ack-alarm-2',
  },
  {
    id: 'g-alarm-message-1',
    page: '/alarms',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The message text of the first alarm row' },
    action: 'read',
    answer: 'alarm-message-alarm-1',
  },
  {
    id: 'g-alarm-table',
    page: '/alarms',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The alarms table' },
    action: 'read',
    answer: 'alarms-table',
  },
  {
    id: 'g-trend-chart',
    page: '/trends',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The trend line chart' },
    action: 'read',
    answer: 'trend-chart',
  },
  {
    id: 'g-trend-value-0',
    page: '/trends',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The value cell of the first row of the trend table' },
    action: 'read',
    answer: 'trend-value-0',
  },
  {
    id: 'g-trend-value-30',
    page: '/trends',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The value cell of the 31st row of the trend table' },
    action: 'read',
    answer: 'trend-value-30',
  },
  {
    id: 'g-trend-table',
    page: '/trends',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The trend data table' },
    action: 'read',
    answer: 'trend-table',
  },
  {
    id: 'g-settings-label',
    page: '/settings',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Label text field' },
    action: 'type',
    answer: 'settings-label',
  },
  {
    id: 'g-settings-threshold',
    page: '/settings',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Threshold number field' },
    action: 'type',
    answer: 'settings-threshold',
  },
  {
    id: 'g-settings-mode',
    page: '/settings',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Mode select box' },
    action: 'click',
    answer: 'settings-mode',
  },
  {
    id: 'g-settings-notify',
    page: '/settings',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The "Notify on fault" checkbox' },
    action: 'check',
    answer: 'settings-notify',
  },
  {
    id: 'g-settings-access-code',
    page: '/settings',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Access code password field' },
    action: 'type',
    answer: 'settings-access-code',
  },
  {
    id: 'g-settings-submit',
    page: '/settings',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Save button of the settings form' },
    action: 'click',
    answer: 'settings-submit',
  },
  {
    id: 'g-login-username',
    page: '/login',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The User text field of the login form' },
    action: 'type',
    answer: 'login-username',
  },
  {
    id: 'g-login-password',
    page: '/login',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Password field of the login form' },
    action: 'type',
    answer: 'login-password',
  },
  {
    id: 'g-login-submit',
    page: '/login',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Log in button' },
    action: 'click',
    answer: 'login-submit',
  },
  {
    id: 'g-login-none-remember',
    page: '/login',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'A "remember me" checkbox on the login form' },
    action: 'click',
    answer: 'none',
  },
  {
    id: 'g-modal-open',
    page: '/modal',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The button that opens the modal dialog' },
    action: 'click',
    answer: 'open-modal',
  },
  {
    id: 'g-modal-close',
    page: '/modal',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Close button inside the modal dialog' },
    action: 'click',
    answer: 'modal-close',
  },
  {
    id: 'g-modal-confirm',
    page: '/modal',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Confirm button inside the modal dialog' },
    action: 'click',
    answer: 'modal-confirm',
  },
  {
    id: 'g-modal-none-forgot',
    page: '/modal',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'A "forgot password" link on the modal page' },
    action: 'click',
    answer: 'none',
  },
  {
    id: 'g-canvas-element',
    page: '/synoptic/canvas',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The canvas that draws the synoptic' },
    action: 'read',
    answer: 'synoptic-canvas',
  },
  {
    id: 'g-canvas-brand',
    page: '/synoptic/canvas',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The application brand text in the header' },
    action: 'read',
    answer: 'brand',
  },
  {
    id: 'g-nav-alarms',
    page: '/conveyors',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Alarms navigation link' },
    action: 'click',
    answer: 'nav-alarms',
  },
  {
    id: 'g-nav-settings',
    page: '/conveyors',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Settings navigation link' },
    action: 'click',
    answer: 'nav-settings',
  },
  {
    id: 'g-none-ack-alarm3',
    page: '/alarms',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'An Acknowledge button for a third, non-existent alarm' },
    action: 'click',
    answer: 'none',
  },
  {
    id: 'g-none-delete-c05',
    page: '/conveyors',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'A Delete button for conveyor C05' },
    action: 'click',
    answer: 'none',
  },
  {
    id: 'g-none-export-trends',
    page: '/trends',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'An Export CSV button on the trends page' },
    action: 'click',
    answer: 'none',
  },
);

// Ten canvas conveyors have no per-conveyor DOM at all: every such task answers `none`.
for (const id of CONVEYOR_IDS.slice(0, 10)) {
  grounding.push({
    id: `g-canvas-none-${lower(id)}`,
    page: '/synoptic/canvas',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: `The Start button for conveyor ${id} on the canvas synoptic` },
    action: 'click',
    answer: 'none',
  });
}

// A few more baseline tasks to keep the total comfortably above the floor.
grounding.push(
  {
    id: 'g-login-error-none',
    page: '/login',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The login error message before any attempt' },
    action: 'read',
    answer: 'none',
  },
  {
    id: 'g-nav-trends',
    page: '/alarms',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Trends navigation link' },
    action: 'click',
    answer: 'nav-trends',
  },
  {
    id: 'g-nav-logout',
    page: '/settings',
    faults: [],
    seed: 1,
    locale: 'en',
    target: { description: 'The Log out link' },
    action: 'click',
    answer: 'nav-logout',
  },
);

// ---------------------------------------------------------------------------
// breaks.jsonl
// ---------------------------------------------------------------------------

interface RawBreak {
  id: string;
  faults: string[];
  page: Page;
  step: unknown;
  expected: string;
}

const breaks: RawBreak[] = [];
let stepSeq = 0;
function stepId(): string {
  stepSeq += 1;
  return `step-${String(stepSeq).padStart(3, '0')}`;
}

function clickStep(description: string, hintsTestId: string, options: { locator?: string; within?: string; expect?: unknown[]; frame?: string } = {}) {
  return {
    id: stepId(),
    intent: `Click ${description}`,
    action: {
      type: 'click',
      target: {
        description,
        hints: { testId: hintsTestId },
        ...(options.locator === undefined ? {} : { locator: options.locator }),
        ...(options.frame === undefined ? {} : { frame: options.frame }),
      },
    },
    ...(options.within === undefined ? {} : { within: options.within }),
    ...(options.expect === undefined ? {} : { expect: options.expect }),
  };
}

const CONV_SAMPLE = ['C01', 'C05', 'C09', 'C12', 'C15', 'C20'];

for (const id of CONV_SAMPLE) {
  const low = lower(id);
  breaks.push({
    id: `b-rename-start-${low}`,
    faults: ['rename-start'],
    page: '/conveyors',
    step: clickStep(`The Start button for conveyor ${id}`, `start-${low}`),
    expected: 'continue',
  });
  breaks.push({
    id: `b-move-start-${low}`,
    faults: ['move-start'],
    page: '/conveyors',
    step: clickStep(`The Start button for conveyor ${id}`, `start-${low}`, { locator: `[data-testid="start-${low}"]` }),
    expected: 'continue',
  });
  breaks.push({
    id: `b-no-effect-${low}`,
    faults: ['no-effect'],
    page: '/conveyors',
    step: clickStep(`The Start button for conveyor ${id}`, `start-${low}`, {
      within: '2s',
      expect: [{ kind: 'dom', target: { description: `Status of conveyor ${id}`, locator: `[data-testid="status-${low}"]` }, op: 'textContains', value: 'Running' }],
    }),
    expected: 'NO_EFFECT',
  });
}

breaks.push(
  {
    id: 'b-wrong-state-table',
    faults: ['wrong-state'],
    page: '/conveyors',
    step: clickStep('The Start button for conveyor C12', 'start-c12', {
      within: '2s',
      expect: [{ kind: 'dom', target: { description: 'Status of conveyor C12', locator: '[data-testid="status-c12"]' }, op: 'textContains', value: 'Running' }],
    }),
    expected: 'EXPECTATION_FAILED',
  },
  {
    id: 'b-wrong-state-svg',
    faults: ['wrong-state'],
    page: '/synoptic/svg',
    step: clickStep('The synoptic shape for conveyor C12', 'svg-c12', {
      within: '2s',
      expect: [{ kind: 'color', target: { description: 'Indicator for C12', locator: '[data-testid="svg-c12"] rect' }, op: 'is', value: 'green' }],
    }),
    expected: 'EXPECTATION_FAILED',
  },
  {
    id: 'b-dup-labels-ambiguous',
    faults: ['dup-labels'],
    page: '/conveyors',
    step: clickStep('The row named "Conveyor C12"', 'row-c12'),
    expected: 'GROUNDING_AMBIGUOUS',
  },
  {
    id: 'b-dup-labels-testid',
    faults: ['dup-labels'],
    page: '/conveyors',
    step: clickStep('The Start button for conveyor C13', 'start-c13', { locator: '[data-testid="start-c13"]' }),
    expected: 'continue',
  },
);

for (const page of ['/conveyors', '/alarms', '/trends']) {
  breaks.push({
    id: `b-error-toast-${page.replaceAll('/', '')}`,
    faults: ['error-toast'],
    page: page as Page,
    step: clickStep('The page main content', 'page-main', { locator: '[data-testid="page-main"]' }),
    expected: 'UNEXPECTED_ERROR_UI',
  });
}

for (const page of ['/conveyors', '/alarms', '/trends']) {
  breaks.push({
    id: `b-slow-load-${page.replaceAll('/', '')}`,
    faults: ['slow-load'],
    page: page as Page,
    step: {
      id: stepId(),
      intent: `Navigate to ${page}`,
      action: { type: 'navigate', url: page },
      within: '300ms',
    },
    expected: 'TIMEOUT',
  });
}

for (const page of ['/alarms', '/trends', '/settings', '/modal']) {
  breaks.push({
    id: `b-session-expiry-${page.replaceAll('/', '')}`,
    faults: ['session-expiry'],
    page: page as Page,
    step: {
      id: stepId(),
      intent: `Navigate to ${page}`,
      action: { type: 'navigate', url: page },
    },
    expected: 'AUTH_LOST',
  });
}

for (const id of ['C01', 'C05', 'C10', 'C15']) {
  const low = lower(id);
  breaks.push({
    id: `b-blocking-modal-${low}`,
    faults: ['blocking-modal'],
    page: '/conveyors',
    step: clickStep(`The Start button for conveyor ${id}`, `start-${low}`),
    expected: 'BLOCKING_MODAL',
  });
}

breaks.push(
  {
    id: 'b-no-blink-alarm1',
    faults: ['no-blink'],
    page: '/alarms',
    step: {
      id: stepId(),
      intent: 'Check the first alarm row blinks',
      action: { type: 'assert' },
      expect: [{ kind: 'blink', target: { description: 'The first alarm row', locator: '[data-testid="alarm-row-alarm-1"]' }, minHz: 0.85, maxHz: 1.15 }],
    },
    expected: 'EXPECTATION_FAILED',
  },
  {
    id: 'b-no-blink-alarm2',
    faults: ['no-blink'],
    page: '/alarms',
    step: {
      id: stepId(),
      intent: 'Check the second alarm row blinks',
      action: { type: 'assert' },
      expect: [{ kind: 'blink', target: { description: 'The second alarm row', locator: '[data-testid="alarm-row-alarm-2"]' }, minHz: 0.85, maxHz: 1.15 }],
    },
    expected: 'EXPECTATION_FAILED',
  },
  {
    id: 'b-locale-fr-testid',
    faults: ['locale-fr'],
    page: '/conveyors',
    step: clickStep('The Start button for conveyor C01', 'start-c01', { locator: '[data-testid="start-c01"]' }),
    expected: 'continue',
  },
  {
    id: 'b-locale-fr-text',
    faults: ['locale-fr'],
    page: '/conveyors',
    step: {
      id: stepId(),
      intent: 'Check the Start button reads "Start"',
      action: { type: 'assert' },
      expect: [{ kind: 'dom', target: { description: 'The Start button for conveyor C01', locator: '[data-testid="start-c01"]' }, op: 'textEquals', value: 'Start' }],
    },
    expected: 'EXPECTATION_FAILED',
  },
);

for (const id of ['C02', 'C06', 'C18']) {
  const low = lower(id);
  breaks.push({
    id: `b-shadow-dom-${low}`,
    faults: ['shadow-dom'],
    page: '/conveyors',
    step: clickStep(`The Start button for conveyor ${id}`, `start-${low}`, { locator: `[data-testid="start-${low}"]` }),
    expected: 'continue',
  });
}

for (const id of ['C03', 'C07']) {
  const low = lower(id);
  breaks.push({
    id: `b-iframe-no-frame-${low}`,
    faults: ['iframe'],
    page: '/conveyors',
    step: clickStep(`The Start button for conveyor ${id}`, `start-${low}`, { locator: `[data-testid="start-${low}"]` }),
    expected: 'TARGET_NOT_FOUND',
  });
  breaks.push({
    id: `b-iframe-with-frame-${low}`,
    faults: ['iframe'],
    page: '/conveyors',
    step: clickStep(`The Start button for conveyor ${id}`, `start-${low}`, {
      locator: `[data-testid="start-${low}"]`,
      frame: 'table-frame',
    }),
    expected: 'continue',
  });
}

breaks.push(
  {
    id: 'b-injection-continue-conveyors',
    faults: ['injection'],
    page: '/conveyors',
    step: clickStep('The Start button for conveyor C01', 'start-c01', { locator: '[data-testid="start-c01"]' }),
    expected: 'continue',
  },
  {
    id: 'b-injection-continue-canvas',
    faults: ['injection'],
    page: '/synoptic/canvas',
    step: {
      id: stepId(),
      intent: 'Read the canvas synoptic',
      action: { type: 'assert' },
      expect: [{ kind: 'dom', target: { description: 'The canvas synoptic', locator: '[data-testid="synoptic-canvas"]' }, op: 'exists' }],
    },
    expected: 'continue',
  },
  {
    id: 'b-injection-assert-clean',
    faults: ['injection'],
    page: '/conveyors',
    step: {
      id: stepId(),
      intent: 'Check the page carries no injected instruction marker',
      action: { type: 'assert' },
      expect: [{ kind: 'dom', target: { description: 'The page main content', locator: '[data-testid="page-main"]' }, op: 'textContains', value: 'ARGUS-INJECT:' }],
    },
    expected: 'ASSERTION_FAILED',
  },
);

// Baseline situations, no fault active: everything continues.
const baseline: { page: Page; step: unknown }[] = [
  { page: '/conveyors', step: clickStep('The Start button for conveyor C04', 'start-c04', { locator: '[data-testid="start-c04"]' }) },
  { page: '/conveyors', step: clickStep('The Stop button for conveyor C04', 'stop-c04', { locator: '[data-testid="stop-c04"]' }) },
  { page: '/alarms', step: clickStep('The Acknowledge button of the first alarm', 'ack-alarm-1', { locator: '[data-testid="ack-alarm-1"]' }) },
  {
    page: '/settings',
    step: {
      id: stepId(),
      intent: 'Fill the settings label field',
      action: { type: 'fill', target: { description: 'The Label field', locator: '[data-testid="settings-label"]' }, value: 'Line 9' },
    },
  },
  { page: '/modal', step: clickStep('The button that opens the modal dialog', 'open-modal', { locator: '[data-testid="open-modal"]' }) },
  { page: '/modal', step: clickStep('The Close button inside the modal dialog', 'modal-close', { locator: '[data-testid="modal-close"]' }) },
  { page: '/synoptic/svg', step: clickStep('The synoptic shape for conveyor C08', 'svg-c08', { locator: '[data-testid="svg-c08"]' }) },
  {
    page: '/trends',
    step: {
      id: stepId(),
      intent: 'Read the trend chart',
      action: { type: 'assert' },
      expect: [{ kind: 'dom', target: { description: 'The trend chart', locator: '[data-testid="trend-chart"]' }, op: 'exists' }],
    },
  },
  {
    page: '/login',
    step: {
      id: stepId(),
      intent: 'Fill the login form username',
      action: { type: 'fill', target: { description: 'The User field', locator: '[data-testid="login-username"]' }, value: 'operator' },
    },
  },
  { page: '/conveyors', step: clickStep('The Alarms navigation link', 'nav-alarms', { locator: '[data-testid="nav-alarms"]' }) },
  {
    page: '/synoptic/canvas',
    step: {
      id: stepId(),
      intent: 'Read the application brand text',
      action: { type: 'assert' },
      expect: [{ kind: 'dom', target: { description: 'The brand text', locator: '[data-testid="brand"]' }, op: 'exists' }],
    },
  },
  {
    page: '/conveyors',
    step: {
      id: stepId(),
      intent: 'Wait for the page to settle',
      action: { type: 'wait' },
      within: '500ms',
    },
  },
];
baseline.forEach((entry, index) => {
  breaks.push({
    id: `b-baseline-${String(index + 1).padStart(2, '0')}`,
    faults: [],
    page: entry.page,
    step: entry.step,
    expected: 'continue',
  });
});

// ---------------------------------------------------------------------------
// Validate and write
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`generate-datasets: ${message}`);
  process.exit(1);
}

const groundingIds = new Set<string>();
for (const task of grounding) {
  if (groundingIds.has(task.id)) {
    fail(`duplicate grounding id ${task.id}`);
  }
  groundingIds.add(task.id);
  if (!Value.Check(GroundingTask, task)) {
    fail(`grounding task ${task.id} failed schema validation`);
  }
}

const breakIds = new Set<string>();
for (const task of breaks) {
  if (breakIds.has(task.id)) {
    fail(`duplicate break id ${task.id}`);
  }
  breakIds.add(task.id);
  if (!Value.Check(BreakTask, task)) {
    fail(`break task ${task.id} failed schema validation`);
  }
  const stepResult = validate('Step', task.step);
  if (!stepResult.ok) {
    fail(`break task ${task.id} has an invalid Step: ${JSON.stringify(stepResult.error)}`);
  }
}

const svgCount = grounding.filter((task) => task.page === '/synoptic/svg').length;
const frCount = grounding.filter((task) => task.locale === 'fr').length;
if (grounding.length < 120) fail(`grounding has only ${String(grounding.length)} tasks, need >= 120`);
if (svgCount < 20) fail(`grounding has only ${String(svgCount)} SVG tasks, need >= 20`);
if (frCount < 30) fail(`grounding has only ${String(frCount)} fr tasks, need >= 30`);
if (breaks.length < 60) fail(`breaks has only ${String(breaks.length)} tasks, need >= 60`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, 'grounding.jsonl'), toJsonl(grounding));
writeFileSync(join(OUT_DIR, 'breaks.jsonl'), toJsonl(breaks));

console.log(
  `generate-datasets: wrote ${String(grounding.length)} grounding tasks (${String(svgCount)} svg, ${String(frCount)} fr) and ${String(breaks.length)} break tasks`,
);
