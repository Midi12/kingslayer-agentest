import { describe, expect, it } from 'vitest';
import {
  renderAction,
  renderExpectation,
  renderSteps,
  renderTarget,
  type TestScript,
} from '../src/index.js';
import { GOLDEN_DIR, readJson } from './support/goldens.js';

const target = { description: 'Start button of conveyor C12' };

describe('renderSteps', () => {
  it('renders targets with every hint, frame and locator', () => {
    expect(
      renderTarget({
        description: 'Start button',
        hints: { role: 'button', text: 'Start', label: 'L', testId: 't', near: 'C12', region: 'R' },
        frame: 'main',
        locator: '#start',
      }),
    ).toBe(
      '"Start button" (role button, text "Start", label "L", test id "t", near "C12", region "R") in frame "main" [locator "#start"]',
    );
  });

  it('renders every action type', () => {
    expect(renderAction({ type: 'press', keys: 'Enter' })).toBe('Press Enter');
    expect(
      renderAction({
        type: 'http',
        request: { method: 'POST', url: 'https://sim.test/x', body: 'a=1' },
        expectStatus: 201,
      }),
    ).toBe('Send POST https://sim.test/x with body "a=1", expect status 201');
    expect(
      renderAction({
        type: 'http',
        request: { method: 'POST', url: 'u', headers: { B: '1', A: '2' }, json: [1] },
        expectStatus: 200,
      }),
    ).toBe('Send POST u with headers A, B and JSON [1], expect status 200');
    expect(
      renderAction({ type: 'http', request: { method: 'DELETE', url: 'u' }, expectStatus: 204 }),
    ).toBe('Send DELETE u, expect status 204');
    expect(renderAction({ type: 'dblclick', target })).toBe(
      'Double-click "Start button of conveyor C12"',
    );
  });

  it('renders every expectation kind', () => {
    expect(renderExpectation({ kind: 'dom', target, op: 'textEquals', value: 'Running' })).toBe(
      'Text of "Start button of conveyor C12" equals "Running"',
    );
    expect(
      renderExpectation({ kind: 'dom', target, op: 'numberCompare', cmp: 'eq', value: 3 }),
    ).toBe('Number in "Start button of conveyor C12" equals 3');
    expect(
      renderExpectation({ kind: 'dom', target, op: 'numberCompare', cmp: 'ne', value: 3 }),
    ).toBe('Number in "Start button of conveyor C12" differs from 3');
    expect(
      renderExpectation({ kind: 'dom', target, op: 'numberCompare', cmp: 'gt', value: -1.5 }),
    ).toBe('Number in "Start button of conveyor C12" is above -1.5');
  });

  it('prints optional script parts', () => {
    const script = readJson(
      `${GOLDEN_DIR}/valid/TestScript/tank-level-setpoints.json`,
    ) as TestScript;
    const noTags: TestScript = {
      ...script,
      metadata: { name: 'x', title: 'X', tags: [] },
      secrets: [],
      handlers: [],
      variables: {},
    };
    const text = renderSteps(noTags);
    expect(text).not.toContain('Tags:');
    expect(text).not.toContain('Secrets:');
    expect(text).not.toContain('Handlers');
    expect(text).not.toContain('Variables:');
    expect(text.endsWith('\n')).toBe(true);
    const allowed: TestScript = {
      ...script,
      steps: [
        {
          id: 's1',
          intent: 'Open the page',
          allowInProduction: true,
          action: { type: 'navigate', url: '/' },
        },
      ],
    };
    expect(renderSteps(allowed)).toContain('1. [s1] Open the page (allowed in production)');
  });
});
