/**
 * Navigator requests and results (Architecture and contracts, "Navigator port").
 *
 * Requests carry navigator-facing observations only: bbox, attrs and fingerprint never
 * leave the runner.
 */
import { Type, type Static } from '@sinclair/typebox';
import { ACTION_TYPES, PROBE_NAMES, RISK_CLASSES, SCREEN_KINDS } from '../enums.js';
import {
  CandidateId,
  Identifier,
  NonEmptyText,
  NonNegativeInteger,
  Probability,
  ProbabilityMap,
  STEP_ID_PATTERN,
  StepId,
  TokenUsage,
  closedObject,
  literalUnion,
} from './common.js';
import { NavigatorObservation } from './observation.js';
import { Target } from './script.js';

export const GroundRequest = closedObject({
  runId: Identifier,
  stepId: StepId,
  risk: literalUnion(RISK_CLASSES),
  step: closedObject({
    intent: NonEmptyText(300),
    action: literalUnion(ACTION_TYPES),
    target: Target,
  }),
  observation: NavigatorObservation,
  exclude: Type.Optional(
    Type.Array(CandidateId, {
      maxItems: 100,
      description: 'Candidate ids already tried and rejected in this attempt',
    }),
  ),
});
export type GroundRequest = Static<typeof GroundRequest>;

export const GroundResult = closedObject({
  pick: Type.Union([CandidateId, Type.Null()], { description: 'Candidate id, or null' }),
  confidence: Probability,
  probabilities: ProbabilityMap,
  targetPresent: Probability,
  confirm: Type.Optional(ProbabilityMap),
  model: NonEmptyText(128),
  usage: TokenUsage,
  latencyMs: NonNegativeInteger,
  cacheHit: Type.Boolean(),
});
export type GroundResult = Static<typeof GroundResult>;

export const VerifyExpectation = closedObject({
  key: Type.String({ pattern: '^expect_[0-9]{1,2}$' }),
  statement: NonEmptyText(500),
  criteria: Type.Optional(closedObject({ true: NonEmptyText(500), false: NonEmptyText(500) })),
});

export const VerifyHandlerCondition = closedObject({
  id: StepId,
  statement: NonEmptyText(500),
});

export const VerifyRequest = closedObject({
  runId: Identifier,
  stepId: StepId,
  risk: literalUnion(RISK_CLASSES),
  step: closedObject({
    intent: NonEmptyText(300),
    action: literalUnion(ACTION_TYPES),
    expectedScreen: Type.Optional(NonEmptyText(300)),
  }),
  before: Type.Optional(NavigatorObservation),
  after: NavigatorObservation,
  expectations: Type.Array(VerifyExpectation, { maxItems: 32 }),
  probes: Type.Array(literalUnion(PROBE_NAMES), { uniqueItems: true, maxItems: 4 }),
  handlers: Type.Array(VerifyHandlerCondition, { maxItems: 20 }),
});
export type VerifyRequest = Static<typeof VerifyRequest>;

export const ScreenAnswer = closedObject({
  pick: literalUnion(SCREEN_KINDS),
  confidence: Probability,
  probabilities: ProbabilityMap,
});

export const VerifyResult = closedObject({
  answers: Type.Record(Type.String({ pattern: '^expect_[0-9]{1,2}$' }), Probability, {
    additionalProperties: false,
    description: 'Noul probability per expectation key',
  }),
  probes: closedObject(
    {
      error_ui: Type.Optional(Probability),
      auth_lost: Type.Optional(Probability),
      blocking_modal: Type.Optional(Probability),
      loading: Type.Optional(Probability),
    },
    { description: 'Noul probability per standard probe that was asked' },
  ),
  handlers: Type.Record(Type.String({ pattern: STEP_ID_PATTERN }), Probability, {
    additionalProperties: false,
    description: 'Noul probability per handler id',
  }),
  screen: Type.Optional(ScreenAnswer),
  model: NonEmptyText(128),
  usage: TokenUsage,
  latencyMs: NonNegativeInteger,
  cacheHit: Type.Boolean(),
});
export type VerifyResult = Static<typeof VerifyResult>;

// Static types of the building blocks above, for consumers that build or read them.
export type VerifyExpectation = Static<typeof VerifyExpectation>;
export type VerifyHandlerCondition = Static<typeof VerifyHandlerCondition>;
export type ScreenAnswer = Static<typeof ScreenAnswer>;
