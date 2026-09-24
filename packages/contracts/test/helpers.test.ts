import { describe, expect, it } from 'vitest';
import {
  PROBLEM_STATUS,
  actionTargets,
  allSteps,
  effectiveRisk,
  err,
  isErr,
  isOk,
  isReadOnlyAction,
  mapResult,
  maxRisk,
  ok,
  problem,
  problemType,
  resolvePolicy,
  resolveTemplates,
  riskForAction,
  stripForNavigator,
  templateReferences,
  unwrapOr,
  validate,
  type Action,
  type ActionStep,
  type Observation,
  type TestScript,
} from '../src/index.js';
import { readJson } from './support/goldens.js';
import { GOLDEN_DIR } from './support/goldens.js';

const c12 = readJson(`${GOLDEN_DIR}/valid/TestScript/conveyor-start-and-jam.json`) as TestScript;
const observation = readJson(`${GOLDEN_DIR}/valid/Observation/busy-page.json`) as Observation;

describe('Result', () => {
  it('builds and inspects results', () => {
    const good = ok(2);
    const bad = err('nope');
    expect(ok()).toEqual({ ok: true, value: undefined });
    expect(isOk(good)).toBe(true);
    expect(isErr(good)).toBe(false);
    expect(isErr(bad)).toBe(true);
    expect(mapResult(good, (value) => value * 2)).toEqual({ ok: true, value: 4 });
    expect(mapResult(bad, (value: number) => value * 2)).toBe(bad);
    expect(unwrapOr(good, 0)).toBe(2);
    expect(unwrapOr(bad, 0)).toBe(0);
  });
});

describe('problem documents', () => {
  it('fills type, title and status from the code', () => {
    const doc = problem('insufficient_credits', { detail: 'Balance 3, reservation 48' });
    expect(doc).toEqual({
      type: 'https://argus.dev/problems/insufficient_credits',
      title: 'Balance below the reservation and no overage allowed',
      status: 402,
      code: 'insufficient_credits',
      detail: 'Balance 3, reservation 48',
    });
    expect(validate('Problem', doc).ok).toBe(true);
    expect(problem('gap_detected', { title: 'Gap at 17', expectedSeq: 17 }).title).toBe(
      'Gap at 17',
    );
    expect(problemType('not_found')).toBe('https://argus.dev/problems/not_found');
  });

  it('maps every code to the status of the spec table', () => {
    expect(PROBLEM_STATUS).toMatchObject({
      insufficient_credits: 402,
      quota_exceeded: 429,
      lint_failed: 422,
      not_approved: 409,
      environment_read_only: 409,
      origin_not_allowed: 422,
    });
    for (const code of Object.keys(PROBLEM_STATUS) as (keyof typeof PROBLEM_STATUS)[]) {
      expect(validate('Problem', problem(code)).ok).toBe(true);
    }
  });
});

describe('stripForNavigator', () => {
  it('removes bbox, attrs and fingerprint and keeps the rest', () => {
    const stripped = stripForNavigator(observation);
    expect(validate('NavigatorObservation', stripped).ok).toBe(true);
    for (const candidate of stripped.candidates) {
      expect(Object.keys(candidate)).not.toContain('bbox');
      expect(Object.keys(candidate)).not.toContain('attrs');
      expect(Object.keys(candidate)).not.toContain('fingerprint');
    }
    expect(stripped.candidates[0]?.context).toEqual(observation.candidates[0]?.context);
    expect(observation.candidates[0]?.bbox).toBeDefined();
  });
});

describe('script helpers', () => {
  it('resolves policy defaults', () => {
    expect(resolvePolicy(c12.policy)).toEqual({
      ...c12.policy,
      pii: 'standard',
      degrade: 'analyst',
      healApproval: 'manual',
    });
    const explicit = {
      ...c12.policy,
      pii: 'strict',
      degrade: 'fail',
      healApproval: 'auto',
    } as const;
    expect(resolvePolicy(explicit)).toEqual(explicit);
  });

  it('assigns risk classes in code', () => {
    const target = { description: 'Start button of conveyor C12' };
    const cases: [Action, string][] = [
      [{ type: 'navigate', url: '/x' }, 'read'],
      [{ type: 'hover', target }, 'read'],
      [{ type: 'click', target }, 'write'],
      [{ type: 'fill', target, value: 'x' }, 'write'],
      [
        { type: 'http', request: { method: 'GET', url: 'https://sim.test' }, expectStatus: 200 },
        'read',
      ],
      [
        { type: 'http', request: { method: 'HEAD', url: 'https://sim.test' }, expectStatus: 200 },
        'read',
      ],
      [
        {
          type: 'http',
          request: { method: 'POST', url: 'https://sim.test', json: {} },
          expectStatus: 202,
        },
        'write',
      ],
    ];
    for (const [action, risk] of cases) expect(riskForAction(action)).toBe(risk);
    expect(isReadOnlyAction('extract')).toBe(true);
    expect(isReadOnlyAction('drag')).toBe(false);
    expect(maxRisk('read', 'critical')).toBe('critical');
    expect(maxRisk('write', 'read')).toBe('write');
    const step: ActionStep = { id: 's1', intent: 'Start', action: { type: 'click', target } };
    expect(effectiveRisk(step)).toBe('write');
    expect(effectiveRisk({ ...step, risk: 'read' })).toBe('write');
    expect(effectiveRisk({ ...step, risk: 'critical' })).toBe('critical');
  });

  it('lists targets of every action shape', () => {
    const target = { description: 'Tote marker on lane 1' };
    expect(
      actionTargets({ type: 'drag', source: target, destination: target }).map((t) => t.path),
    ).toEqual(['/source', '/destination']);
    expect(actionTargets({ type: 'press', keys: 'Enter' })).toEqual([]);
    expect(actionTargets({ type: 'scroll', direction: 'down', amount: 1, target })).toHaveLength(1);
    expect(actionTargets({ type: 'wait' })).toEqual([]);
    expect(actionTargets({ type: 'extract', target, into: 'x', parse: 'text' })).toHaveLength(1);
  });

  it('visits main steps then handler steps', () => {
    const visits = allSteps(c12);
    expect(visits.map((visit) => visit.path)).toEqual([
      '/steps/0',
      '/steps/1',
      '/steps/2',
      '/steps/3',
      '/steps/4',
      '/steps/5',
      '/steps/6',
      '/handlers/0/steps/0',
    ]);
    expect(visits.at(-1)?.handlerId).toBe('h-relogin');
  });

  it('finds and resolves template references', () => {
    const text = '${env.SIM_URL}/c/${var.conveyor}?k=${secret.KEY}&x=${other.Y}';
    expect(templateReferences(text).map((ref) => [ref.scope, ref.name, ref.index])).toEqual([
      ['env', 'SIM_URL', 0],
      ['var', 'conveyor', 17],
      ['secret', 'KEY', 35],
    ]);
    const resolved = resolveTemplates(text, (scope, name) =>
      scope === 'secret' ? undefined : `<${name}>`,
    );
    expect(resolved).toBe('<SIM_URL>/c/<conveyor>?k=${secret.KEY}&x=${other.Y}');
  });
});
