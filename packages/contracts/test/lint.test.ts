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
    const odd = withSteps(
      [
        {
          id: 's1',
          intent: 'Call a malformed URL',
          action: {
            type: 'http',
            request: { method: 'GET', url: 'http://[bad' },
            expectStatus: 200,
          },
        },
        {
          id: 's2',
          intent: 'Open a protocol-relative URL',
          action: { type: 'navigate', url: '//hmi.test/x' },
        },
      ],
      { target: { ...c12.target, baseUrl: 'https://hmi.test' } },
    );
    expect(lintScript(odd, context).map((finding) => [finding.code, finding.stepId])).toEqual([
      ['L4', 's1'],
    ]);
    expect(
      lintScript(withSteps([], { target: { ...c12.target, baseUrl: 'not a url:x' } }), context),
    ).toHaveLength(1);
  });

  it('L4 judges URLs by where a browser resolves them', () => {
    const navigate = (url: string): TestScript =>
      withSteps([{ id: 's1', intent: 'Open the page', action: { type: 'navigate', url } }]);
    const escaping = [
      '\\\\evil.com/x',
      '/\\evil.com/x',
      ' //evil.com/x',
      '\t//evil.com',
      '\n//evil.com',
      '\u0000//evil.com',
      'https:evil.com',
      'http:evil.com',
      '//evil.com',
      'https://relative-a.invalid/x',
      'http://relative-b.invalid/x',
    ];
    for (const url of escaping) {
      const findings = lintScript(navigate(url), context);
      expect(
        findings.map((finding) => [finding.code, finding.path]),
        url,
      ).toEqual([['L4', '/steps/0/action/url']]);
    }
    for (const url of ['/ok', 'ok/deeper', '?q=1', '#frag', 'https://hmi.test/x', ' /ok ']) {
      expect(lintScript(navigate(url), context), url).toEqual([]);
    }
    for (const url of ['javascript:alert(1)', '/\\${env.HOST}/x', 'https://${var.HOST}/']) {
      expect(lintScript(navigate(url), context)[0]?.message, url).toMatch(/is rejected/);
    }
    expect(lintScript(navigate(' ${env.HMI_URL}/x'), context)).toEqual([]);
    // With a base URL from the environment the page scheme is unknown: both are checked.
    const envBase = { target: { ...c12.target, baseUrl: '${env.HMI_URL}' } };
    const fromEnv = (url: string) =>
      lintScript(
        withSteps(
          [{ id: 's1', intent: 'Open the page', action: { type: 'navigate', url } }],
          envBase,
        ),
        context,
      );
    expect(fromEnv('/ok')).toEqual([]);
    expect(fromEnv('//hmi.test/x')[0]?.message).toMatch(/http:\/\/hmi\.test/);
    const base = (baseUrl: string) =>
      lintScript(withSteps([], { target: { ...c12.target, baseUrl } }), context);
    expect(base('\\\\evil.com')).toHaveLength(1);
    expect(base(' //evil.com')).toHaveLength(1);
    expect(base('https://hmi.test')).toEqual([]);
    const call = (url: string): TestScript =>
      withSteps([
        {
          id: 's1',
          intent: 'Call the simulator',
          action: { type: 'http', request: { method: 'GET', url }, expectStatus: 200 },
        },
      ]);
    expect(lintScript(call('https://sim.test:8443/api'), context)).toEqual([]);
    expect(lintScript(call('/\\sim.test:8443/api'), context)).toEqual([]);
    expect(lintScript(call('/\\evil.test/api'), context)[0]?.message).toMatch(/evil\.test/);
    expect(lintScript(call('https:evil.test/api'), context)[0]?.message).toMatch(/evil\.test/);
  });

  it('L7 rejects a blink range whose minimum exceeds its maximum', () => {
    const blink = (minHz: number, maxHz: number): ActionStep => ({
      ...click('s1', 'Acknowledge the jam alarm', 'Acknowledge button of the jam alarm'),
      expect: [
        {
          kind: 'blink',
          target: { description: 'Jam lamp of conveyor C12' },
          minHz,
          maxHz,
        },
      ],
    });
    expect(lintScript(withSteps([blink(1, 5)]), context)).toEqual([]);
    expect(lintScript(withSteps([blink(2, 2)]), context)).toEqual([]);
    expect(
      lintScript(withSteps([blink(5, 1)]), context).map((finding) => [finding.code, finding.path]),
    ).toEqual([['L7', '/steps/0/expect/0/minHz']]);
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

describe('lintScript, review round 2', () => {
  it('L2 flags numeric values that are not identifiers', () => {
    const value = 'states a numeric value, which is checked in code';
    for (const statement of [
      'The speed of conveyor C12 is 0.5 m/s.',
      'The temperature is 21.5 °C.',
      'The tank level reads 80 percent.',
      'The counter shows 5.',
      'The display shows a value of 42.',
      'The motor runs at 1500rpm.',
      'The fan runs at 50Hz.',
      'The offset is -3.',
      '7 is the active recipe.',
    ]) {
      expect(noulStatementProblems(statement), statement).toContain(value);
    }
    expect(noulStatementProblems('The level is 80%.')).toEqual(['contains a count or quantity']);
    expect(noulStatementProblems('The batch completed on 2026-09-21.')).toEqual([
      'contains a date or time',
    ]);
    for (const statement of [
      'Conveyor 12 is running.',
      'The status of line 2 is stopped.',
      'The line 2 status banner reports an emergency stop.',
      'Alarm 7 is acknowledged.',
      'Pump 3B is running.',
      'Tank T-101 is full.',
      'The speed of conveyor C12 is nominal.',
    ]) {
      expect(noulStatementProblems(statement), statement).toEqual([]);
    }
  });

  it('L4 keeps the host of ${env.NAME} URLs with the environment', () => {
    const script = (url: string, baseUrl = '${env.BASE_URL}'): TestScript =>
      withSteps(
        [
          { id: 's1', intent: 'Open the page', action: { type: 'navigate', url } },
          {
            id: 's2',
            intent: 'Call the simulator',
            action: { type: 'http', request: { method: 'GET', url }, expectStatus: 200 },
          },
        ],
        { target: { ...c12.target, baseUrl } },
      );
    for (const url of [
      '${env.BASE_URL}@evil.com/x',
      '${env.BASE_URL}.evil.com/x',
      '${env.BASE_URL}:1@evil.com',
      '${env.BASE_URL}\n@evil.com',
      '${env.BASE_URL}${var.suffix}',
      '${env.BASE_URL}\\@evil.com',
    ]) {
      const findings = lintScript(script(url), context).map((f) => [f.code, f.path]);
      expect(findings, url).toEqual([
        ['L4', '/steps/0/action/url'],
        ['L4', '/steps/1/action/request/url'],
      ]);
    }
    for (const url of ['${env.BASE_URL}', '${env.BASE_URL}/x/${var.id}', '${env.BASE_URL}?q=1']) {
      expect(lintScript(script(url), context), url).toEqual([]);
    }
    const base = lintScript(script('/ok', '${env.BASE_URL}@evil.com'), context);
    expect(base.map((f) => [f.code, f.path])).toEqual([
      ['L4', '/target/baseUrl'],
      ['L4', '/steps/1/action/request/url'],
    ]);
  });

  it('L4 rejects templates that decide the origin', () => {
    const navigate = (url: string): TestScript =>
      withSteps(
        [
          { id: 's1', intent: 'Open the page', action: { type: 'navigate', url } },
          {
            id: 's2',
            intent: 'Read the next address',
            action: {
              type: 'extract',
              target: { description: 'Link text in the footer' },
              into: 'next',
              parse: 'text',
            },
          },
        ],
        { variables: { dest: 'https://evil.com/steal' } },
      );
    for (const url of [
      '${var.dest}',
      '${var.next}',
      '/${var.next}',
      'https://hmi.test${var.next}',
      'https://hmi.test@${var.next}',
      'https:///${var.next}',
      'https:${var.next}',
      'x${var.next}',
    ]) {
      const findings = lintScript(navigate(url), context);
      expect(
        findings.map((f) => [f.code, f.path]),
        url,
      ).toEqual([['L4', '/steps/0/action/url']]);
      expect(findings[0]?.message, url).toMatch(/a template decides where it leads/);
    }
    for (const url of [
      '/alarms/${var.next}',
      'alarms/${var.next}',
      '?q=${var.next}',
      '#${var.next}',
      'https://hmi.test/${var.next}',
    ]) {
      expect(lintScript(navigate(url), context), url).toEqual([]);
    }
    const http = withSteps([
      {
        id: 's1',
        intent: 'Call the simulator',
        action: {
          type: 'http',
          request: { method: 'GET', url: 'https://sim.test:8443/${var.dest}' },
          expectStatus: 200,
        },
      },
    ]);
    expect(lintScript(http, context)).toEqual([]);
  });
});
