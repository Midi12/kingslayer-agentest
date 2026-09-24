import { describe, expect, expectTypeOf, it } from 'vitest';
import * as contracts from '../src/index.js';
import type {
  ActionOf,
  BlinkExpectation,
  ExpectationOf,
  JobSecret,
  RunEventOf,
  ScreenAnswer,
} from '../src/index.js';

/** Building blocks later modules construct or read; each is a schema and a type. */
const BUILDING_BLOCKS = [
  'VerifyExpectation',
  'VerifyHandlerCondition',
  'ScreenAnswer',
  'BreakCheck',
  'BreakFrame',
  'BreakCandidate',
  'JobSecret',
  'CompileEnvironment',
  'ReportAdjudication',
  'ReportHeal',
  'ReportMaintenance',
  'GeneratedBy',
  'ProblemFieldError',
  'CandidateState',
  'CandidateContext',
  'BoundingBox',
  'ObservationFrames',
  'RunEnvironmentInfo',
  'NoulExpectation',
  'DomExpectation',
  'UrlExpectation',
  'ColorExpectation',
  'BlinkExpectation',
  'VisualExpectation',
  'VisionExpectation',
  'ConsoleExpectation',
  'NetworkExpectation',
  'A11yExpectation',
  'MaskRect',
  'ScriptMetadata',
  'CompilerInfo',
  'Variables',
  'Sha256',
  'IsoTimestamp',
  'ArtifactRef',
  'CandidateId',
  'StepId',
  'Slug',
  'Duration',
  'Identifier',
] as const;

describe('public surface', () => {
  it.each(BUILDING_BLOCKS)('exports the %s schema', (name) => {
    const schema = (contracts as Record<string, unknown>)[name];
    expect(typeof schema).toBe('object');
    expect(contracts.validateAgainst(schema as never, null).ok).toBe(false);
  });

  it('exports the static types with the schemas', () => {
    expectTypeOf<ActionOf<'fill'>>().toHaveProperty('value');
    expectTypeOf<ExpectationOf<'blink'>>().toEqualTypeOf<BlinkExpectation>();
    expectTypeOf<JobSecret>().toBeObject();
    expectTypeOf<ScreenAnswer>().not.toBeNever();
  });

  it('types stepId as RUN_EVENT_STEP_SCOPE sets it', () => {
    expectTypeOf<RunEventOf<'step.started'>['stepId']>().toEqualTypeOf<string>();
    expectTypeOf<RunEventOf<'artifact.stored'>['stepId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<RunEventOf<'run.started'>['stepId']>().toEqualTypeOf<undefined>();
    const head = { runId: 'r1', seq: 1, ts: '2026-09-24T10:00:00Z', prev: null };
    // @ts-expect-error a step-scoped event needs its stepId
    const started: RunEventOf<'step.started'> = { ...head, type: 'step.started', data: {} };
    // @ts-expect-error run.started carries no stepId
    const run: RunEventOf<'run.started'> = { ...head, type: 'run.started', stepId: 's1', data: {} };
    expect([started, run]).toHaveLength(2);
  });
});
