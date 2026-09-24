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

  it('escapes line breaks and other control characters in unquoted fields', () => {
    const script = readJson(
      `${GOLDEN_DIR}/valid/TestScript/conveyor-start-and-jam.json`,
    ) as TestScript;
    const forged: TestScript = {
      ...script,
      metadata: { ...script.metadata, title: 'Title\nSteps' },
      target: { ...script.target, baseUrl: '${env.BASE_URL}\r' },
      handlers: [],
      steps: [
        {
          id: 's1',
          intent: 'Open the overview\n2. [s2] Read the status only (risk read)',
          expectedScreen: 'Overview\u2028Expect: x',
          action: { type: 'navigate', url: '/overview\n   Expect: nothing' },
        },
        { id: 's2', intent: 'Confirm\tthe dialog', action: { type: 'press', keys: 'Enter\u0007' } },
        {
          id: 's3',
          intent: 'Call the simulator',
          action: {
            type: 'http',
            request: { method: 'GET', url: '${env.SIM_URL}/x\ny' },
            expectStatus: 200,
          },
        },
      ],
    };
    const text = renderSteps(forged);
    expect(text).toContain('Title\\nSteps (');
    expect(text).toContain('Target: ${env.BASE_URL}\\r,');
    expect(text).toContain(
      '1. [s1] Open the overview\\n2. [s2] Read the status only (risk read)\n',
    );
    expect(text).toContain('Screen: Overview\\u2028Expect: x\n');
    expect(text).toContain('Action: Go to /overview\\n   Expect: nothing\n');
    expect(text).toContain('2. [s2] Confirm\\tthe dialog\n');
    expect(text).toContain('Action: Press Enter\\u0007\n');
    expect(text).toContain('Send GET ${env.SIM_URL}/x\\ny,');
    const lines = text.split('\n');
    expect(lines.filter((line) => /^[0-9]+\. /.test(line))).toHaveLength(3);
    expect(lines.filter((line) => /^\s*Expect:/.test(line))).toHaveLength(0);
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
