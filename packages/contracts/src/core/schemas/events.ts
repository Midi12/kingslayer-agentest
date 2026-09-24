/**
 * Run events (Architecture and contracts, "Run events") and usage events.
 *
 * Every event is `{ runId, seq, ts, type, stepId?, data, prev }`. `seq` starts at 1 and is
 * gapless per run; `prev` is `contentHash` of the previous event, null for seq 1
 * (ADR M01-run-ledger). Events of step-scoped types carry `stepId`; run-scoped ones do not.
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import {
  ACTION_TYPES,
  AI_MODES,
  ANALYST_DECISIONS,
  ARTIFACT_KINDS,
  BREAK_REASONS,
  CHECK_OUTCOMES,
  CLASSIFICATIONS,
  ENGINE_DECISIONS,
  ENVIRONMENT_KINDS,
  EXPECTATION_KINDS,
  GROUNDING_SOURCES,
  MODEL_TIERS,
  RUN_TERMINATIONS,
  RUNNER_KINDS,
  STEP_OUTCOMES,
  USAGE_OPERATIONS,
} from '../enums.js';
import {
  ArtifactRef,
  CandidateId,
  Identifier,
  IsoTimestamp,
  NonEmptyText,
  NonNegativeInteger,
  PositiveInteger,
  Probability,
  ProbabilityMap,
  Sha256,
  StepId,
  Version,
  closedObject,
  discriminatedUnion,
  literalUnion,
} from './common.js';
import { ResolvedPolicy } from './script.js';

const breakReasonOrNull = Type.Union([literalUnion(BREAK_REASONS), Type.Null()]);

/** Scalar or small structured measurement recorded by a check. */
const Measured = Type.Record(
  Type.String({ pattern: '^[A-Za-z][A-Za-z0-9_]{0,63}$' }),
  Type.Union([
    Type.String({ maxLength: 2000 }),
    Type.Number(),
    Type.Boolean(),
    Type.Null(),
    Type.Array(Type.Union([Type.String({ maxLength: 2000 }), Type.Number()]), { maxItems: 100 }),
  ]),
  { additionalProperties: false },
);

export const RunCounters = closedObject({
  steps: NonNegativeInteger,
  passed: NonNegativeInteger,
  failed: NonNegativeInteger,
  broken: NonNegativeInteger,
  skipped: NonNegativeInteger,
  escalations: NonNegativeInteger,
  handlerFirings: NonNegativeInteger,
  jevCalls: NonNegativeInteger,
  llmCalls: NonNegativeInteger,
  durationMs: NonNegativeInteger,
});
export type RunCounters = Static<typeof RunCounters>;

export const RunEnvironmentInfo = closedObject({
  id: Type.Optional(Identifier),
  name: NonEmptyText(128),
  kind: literalUnion(ENVIRONMENT_KINDS),
  baseUrl: NonEmptyText(2048),
});

export const RunEventData = {
  'run.started': closedObject({
    runnerId: Identifier,
    scriptHash: Sha256,
    environment: RunEnvironmentInfo,
    policy: ResolvedPolicy,
    versions: closedObject({
      engine: Version,
      questions: Version,
      thresholds: Version,
      models: Type.Record(Type.String({ pattern: '^[a-z][a-z0-9_]{0,31}$' }), NonEmptyText(128), {
        additionalProperties: false,
        description: 'Model id per role, e.g. navigator and analyst',
      }),
    }),
  }),
  'step.started': closedObject({
    attempt: PositiveInteger,
    index: NonNegativeInteger,
  }),
  'step.finished': closedObject({
    attempt: PositiveInteger,
    outcome: literalUnion(STEP_OUTCOMES),
    durationMs: NonNegativeInteger,
    reason: breakReasonOrNull,
    classification: Type.Optional(Type.Union([literalUnion(CLASSIFICATIONS), Type.Null()])),
    adjudicated: Type.Optional(Type.Boolean()),
  }),
  'observation.captured': closedObject({
    obsId: Type.String({ pattern: '^obs_[A-Za-z0-9_-]{1,64}$' }),
    digestHash: Sha256,
    artifacts: Type.Array(ArtifactRef, { maxItems: 16 }),
  }),
  'navigator.ground': closedObject({
    requestHash: Sha256,
    pick: Type.Union([CandidateId, Type.Null()]),
    confidence: Probability,
    top: Type.Array(closedObject({ cid: CandidateId, p: Probability }), { maxItems: 5 }),
    targetPresent: Probability,
    confirm: Type.Optional(ProbabilityMap),
    source: literalUnion(GROUNDING_SOURCES),
    latencyMs: NonNegativeInteger,
    inputTokens: NonNegativeInteger,
  }),
  'navigator.verify': closedObject({
    requestHash: Type.Optional(Sha256),
    answers: Type.Record(Type.String({ pattern: '^[a-z][a-z0-9_-]{0,80}$' }), Probability, {
      additionalProperties: false,
      description: 'Probability per question id (expect_i, probe_*, handler_<id>, screen_kind)',
    }),
    latencyMs: NonNegativeInteger,
    inputTokens: NonNegativeInteger,
  }),
  'action.performed': closedObject({
    type: literalUnion(ACTION_TYPES),
    locator: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    durationMs: NonNegativeInteger,
    error: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
  }),
  'check.evaluated': closedObject({
    kind: literalUnion(EXPECTATION_KINDS),
    index: NonNegativeInteger,
    outcome: literalUnion(CHECK_OUTCOMES),
    measured: Measured,
  }),
  'decision.made': closedObject({
    rule: Type.Integer({ minimum: 1, maximum: 11 }),
    decision: literalUnion(ENGINE_DECISIONS),
    reason: breakReasonOrNull,
    handlerId: Type.Optional(StepId),
  }),
  'handler.fired': closedObject({ handlerId: StepId }),
  'escalation.requested': closedObject({
    packetRef: ArtifactRef,
    reason: literalUnion(BREAK_REASONS),
    attempt: PositiveInteger,
  }),
  'escalation.decided': closedObject({
    decision: Type.Union([literalUnion(ANALYST_DECISIONS), Type.Null()]),
    classification: Type.Union([literalUnion(CLASSIFICATIONS), Type.Null()]),
    valid: Type.Boolean(),
    errors: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 50 }),
    repaired: Type.Boolean(),
    inputTokens: NonNegativeInteger,
    outputTokens: NonNegativeInteger,
  }),
  'artifact.stored': closedObject({
    kind: literalUnion(ARTIFACT_KINDS),
    ref: ArtifactRef,
    bytes: NonNegativeInteger,
    sha256: Sha256,
  }),
  'usage.recorded': closedObject({
    operation: literalUnion(USAGE_OPERATIONS),
    quantity: Type.Number({ exclusiveMinimum: 0 }),
  }),
  'run.finished': closedObject({
    termination: literalUnion(RUN_TERMINATIONS),
    reason: breakReasonOrNull,
    counters: RunCounters,
  }),
} as const;

/** How each event type relates to steps. */
export const RUN_EVENT_STEP_SCOPE = {
  'run.started': 'none',
  'step.started': 'required',
  'step.finished': 'required',
  'observation.captured': 'required',
  'navigator.ground': 'required',
  'navigator.verify': 'required',
  'action.performed': 'required',
  'check.evaluated': 'required',
  'decision.made': 'required',
  'handler.fired': 'required',
  'escalation.requested': 'required',
  'escalation.decided': 'required',
  'artifact.stored': 'optional',
  'usage.recorded': 'optional',
  'run.finished': 'none',
} as const satisfies Record<keyof typeof RunEventData, 'none' | 'required' | 'optional'>;

type EventDataSchemas = typeof RunEventData;
type EventType = keyof EventDataSchemas;

function eventVariant<K extends EventType>(type: K) {
  const scope = RUN_EVENT_STEP_SCOPE[type];
  const stepId: Record<string, TSchema> =
    scope === 'none' ? {} : { stepId: scope === 'required' ? StepId : Type.Optional(StepId) };
  return closedObject({
    runId: Identifier,
    seq: PositiveInteger,
    ts: IsoTimestamp,
    type: Type.Literal(type),
    ...stepId,
    data: RunEventData[type],
    prev: Type.Union([Sha256, Type.Null()]),
  });
}

export const RunEvent = discriminatedUnion(
  'type',
  (Object.keys(RunEventData) as EventType[]).map((type) => eventVariant(type)),
);

type EventOf<K extends EventType> = {
  runId: string;
  seq: number;
  ts: string;
  type: K;
  stepId?: string;
  data: Static<EventDataSchemas[K]>;
  prev: string | null;
};
export type RunEventOf<K extends EventType> = EventOf<K>;
export type RunEvent = { [K in EventType]: EventOf<K> }[EventType];
export type RunEventDataOf<K extends EventType> = Static<EventDataSchemas[K]>;

/** Body of `POST /runner/v1/runs/{id}/events` once its NDJSON lines are parsed. */
export const RunEventBatch = Type.Array(RunEvent, { minItems: 1, maxItems: 1000 });

export const UsageEvent = closedObject({
  id: Identifier,
  orgId: Identifier,
  projectId: Type.Union([Identifier, Type.Null()]),
  runId: Type.Union([Identifier, Type.Null()]),
  operation: literalUnion(USAGE_OPERATIONS),
  quantity: Type.Number({ exclusiveMinimum: 0 }),
  aiMode: literalUnion(AI_MODES),
  modelTier: literalUnion(MODEL_TIERS),
  runnerKind: Type.Optional(literalUnion(RUNNER_KINDS)),
  rate: Type.Number({ minimum: 0, description: 'Credits per unit, as applied' }),
  credits: Type.Number({ minimum: 0 }),
  ts: IsoTimestamp,
});
export type UsageEvent = Static<typeof UsageEvent>;

// Static types of the building blocks above, for consumers that build or read them.
export type RunEnvironmentInfo = Static<typeof RunEnvironmentInfo>;
export type RunEventBatch = Static<typeof RunEventBatch>;
