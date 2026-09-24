import { describe, expect, expectTypeOf, it } from 'vitest';
import * as contracts from '../src/index.js';
import type {
  ActionOf,
  BlinkExpectation,
  ExpectationOf,
  JobSecret,
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
});
