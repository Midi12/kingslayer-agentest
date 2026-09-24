import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CRITICAL_VERBS,
  defaultLintContext,
  lintScript,
  normalizeIntent,
  noulStatementProblems,
  ownerIdAt,
  verbForms,
  type ActionStep,
  type TestScript,
} from '../src/index.js';
import { GOLDEN_DIR, readJson } from './support/goldens.js';

const c12 = readJson(`${GOLDEN_DIR}/valid/TestScript/conveyor-start-and-jam.json`) as TestScript;
const context = defaultLintContext({
  allowedOrigins: ['https://hmi.test'],
  allowedHttpHosts: ['sim.test:8443'],
});

function withSteps(steps: ActionStep[], extra: Partial<TestScript> = {}): TestScript {
  return { ...c12, handlers: [], secrets: [], variables: {}, steps, ...extra };
}

const click = (id: string, intent: string, description: string): ActionStep => ({
  id,
  intent,
  action: { type: 'click', target: { description } },
});

describe('lintScript', () => {
  it('passes the spec example', () => {
    expect(lintScript(c12, context)).toEqual([]);
    expect(defaultLintContext().criticalVerbs).toEqual(DEFAULT_CRITICAL_VERBS);
  });

  it('L2 recognises questions, instructions, counts, comparisons and dates', () => {
    expect(noulStatementProblems('The alarm list is empty.')).toEqual([]);
    expect(noulStatementProblems('Does the list show an alarm')).toContain(
      'is a question, not a declarative statement',
    );
    expect(noulStatementProblems('Verify the pump runs.')).toContain(
      'is an instruction, not a declarative statement',
    );
    expect(noulStatementProblems('The pump runs. The valve is open.')).toContain(
      'makes more than one claim',
    );
    expect(noulStatementProblems('The tank level is above 80 percent.')).toContain(
      'contains a numeric comparison',
    );
    expect(noulStatementProblems('The level is higher than the setpoint.')).toContain(
      'contains a numeric comparison',
    );
    expect(noulStatementProblems('Three alarms are listed.')).toContain(
      'contains a count or quantity',
    );
    expect(noulStatementProblems('The gauge shows 45 %.')).toContain(
      'contains a count or quantity',
    );
    expect(noulStatementProblems('The table lists 12 conveyors.')).toContain(
      'contains a count or quantity',
    );
    expect(noulStatementProblems('The status of line 2 is stopped.')).toEqual([]);
    expect(noulStatementProblems('The shift started on Monday.')).toContain(
      'contains a date or time',
    );
    expect(noulStatementProblems('The clock reads 10:15.')).toContain('contains a date or time');
    expect(noulStatementProblems('The log is dated 21/09/2026.')).toContain(
      'contains a date or time',
    );
  });

  it('L3 flags credentials in URLs, tokens and literal JSON secrets', () => {
    const script = withSteps(
      [
        {
          id: 's1',
          intent: 'Open the admin page',
          action: { type: 'navigate', url: 'https://admin:hunter2@hmi.test/' },
        },
        {
          id: 's2',
          intent: 'Call the API',
          action: {
            type: 'http',
            request: {
              method: 'POST',
              url: 'https://sim.test:8443/x',
              headers: { 'X-Api-Key': 'plain-text-key' },
              json: { client_secret: 'abc' },
            },
            expectStatus: 200,
          },
        },
        {
          id: 's3',
          intent: 'Paste the key',
          action: {
            type: 'fill',
            target: { description: 'Key field of the form' },
            value: 'sk-abcdefghijklmnopqrstuv',
          },
        },
      ],
      { target: { ...c12.target, baseUrl: 'https://hmi.test' } },
    );
    const findings = lintScript(script, context).filter((finding) => finding.code === 'L3');
    expect(findings.map((finding) => [finding.stepId, finding.path])).toEqual([
      ['s1', '/steps/0/action/url'],
      ['s2', '/steps/1/action/request/headers/X-Api-Key'],
      ['s2', '/steps/1/action/request/json/client_secret'],
      ['s3', '/steps/2/action/value'],
    ]);
  });

  it('L3 allows secrets only in fill values and http headers or bodies', () => {
    const script = withSteps([click('s1', 'Start conveyor C12', 'Start button of ${secret.KEY}')], {
      secrets: ['KEY'],
    });
    const findings = lintScript(script, context);
    expect(findings.map((finding) => [finding.code, finding.path])).toEqual([
      ['L3', '/steps/0/action/target/description'],
    ]);
  });

  it('L4 rejects relative base URLs and malformed absolute URLs', () => {
    const script = withSteps(
      [{ id: 's1', intent: 'Open the page', action: { type: 'navigate', url: 'http://[bad' } }],
      {
        target: { ...c12.target, baseUrl: '/relative' },
      },
    );
    const findings = lintScript(script, context);
    expect(findings.map((finding) => [finding.code, finding.stepId])).toEqual([
      ['L4', null],
      ['L4', 's1'],
    ]);
    const odd = withSteps([
      {
        id: 's1',
        intent: 'Call a malformed URL',
        action: { type: 'http', request: { method: 'GET', url: 'http://[bad' }, expectStatus: 200 },
      },
      {
        id: 's2',
        intent: 'Open a protocol-relative URL',
        action: { type: 'navigate', url: '//hmi.test/x' },
      },
    ]);
    expect(lintScript(odd, context).map((finding) => [finding.code, finding.stepId])).toEqual([
      ['L4', 's1'],
    ]);
    expect(
      lintScript(withSteps([], { target: { ...c12.target, baseUrl: 'not a url:x' } }), context),
    ).toHaveLength(1);
  });

  it('L5 knows the inflections of a verb', () => {
    expect([...verbForms('stop')]).toEqual(
      expect.arrayContaining(['stop', 'stops', 'stopped', 'stopping']),
    );
    expect([...verbForms('purge')]).toEqual(
      expect.arrayContaining(['purges', 'purged', 'purging']),
    );
    expect([...verbForms('empty')]).toEqual(
      expect.arrayContaining(['empties', 'emptied', 'emptying']),
    );
  });

  it('L6 reports an unparsable within', () => {
    const step: ActionStep = {
      ...click('s1', 'Start conveyor C12', 'Start button of conveyor C12'),
      within: '10 seconds',
    };
    const findings = lintScript(withSteps([step]), context);
    expect(findings.map((finding) => [finding.code, finding.stepId])).toEqual([['L6', 's1']]);
  });

  it('L8 matches repeated intents by occurrence', () => {
    const previous = withSteps([
      click('a', 'Press start', 'Start button of conveyor C12'),
      click('b', 'Press start', 'Start button of conveyor C11'),
    ]);
    const current = withSteps([
      click('a', 'Press start', 'Start button of conveyor C12'),
      click('c', 'Press start', 'Start button of conveyor C11'),
    ]);
    const findings = lintScript(current, { ...context, previous });
    expect(findings.map((finding) => [finding.code, finding.stepId])).toEqual([['L8', 'c']]);
    expect(normalizeIntent('  Open   THE overview!! ')).toBe('open the overview');
  });

  it('locates the owner of a path', () => {
    expect(ownerIdAt(c12, '/handlers/0/steps/0/use')).toBe('h-relogin-1');
    expect(ownerIdAt(c12, '/handlers/0/when')).toBe('h-relogin');
    expect(ownerIdAt(c12, '/steps/3/action')).toBe('s4');
    expect(ownerIdAt(c12, '/variables/conveyor')).toBeNull();
    expect(ownerIdAt(c12, '/steps/99')).toBeNull();
    expect(ownerIdAt(c12, '/handlers/9')).toBeNull();
    expect(ownerIdAt(c12, '/handlers/9/steps/0')).toBeNull();
  });
});
