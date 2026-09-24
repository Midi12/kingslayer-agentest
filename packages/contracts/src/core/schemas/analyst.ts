/**
 * Contracts: break packet, analyst decision, visual grounding, vision assertions and the
 * run report (Architecture and contracts, "Contracts: break packet, analyst decision,
 * report, events").
 */
import { Type, type Static } from '@sinclair/typebox';
import {
  ACTION_TYPES,
  ANALYST_DECISIONS,
  BREAK_REASONS,
  CERTAINTIES,
  CHECK_OUTCOMES,
  CLASSIFICATIONS,
  DEFECT_SEVERITIES,
  EXPECTATION_KINDS,
  HEAL_STATUSES,
  RISK_CLASSES,
  VERDICTS,
} from '../enums.js';
import {
  ArtifactRef,
  CandidateId,
  Identifier,
  InlineImage,
  NonEmptyText,
  NonNegativeInteger,
  ORIGIN_PATTERN,
  PositiveInteger,
  Probability,
  Sha256,
  Slug,
  StepId,
  closedObject,
  literalUnion,
} from './common.js';
import { RunEvent } from './events.js';
import { ConsoleEntry, NetworkEntry, ObservationSummary } from './observation.js';
import { PatchAction, Target } from './script.js';

// ---------------------------------------------------------------------------
// BreakPacket
// ---------------------------------------------------------------------------

export const BreakCheck = closedObject({
  kind: Type.Union([literalUnion(EXPECTATION_KINDS), Type.Literal('action')]),
  outcome: literalUnion(CHECK_OUTCOMES),
  detail: Type.String({ maxLength: 2000 }),
});

export const BreakFrame = closedObject({
  ref: ArtifactRef,
  tMs: Type.Integer({ description: 'Milliseconds relative to the break; negative is before' }),
});

export const BreakCandidate = closedObject({
  cid: CandidateId,
  role: Type.String({ maxLength: 64 }),
  name: Type.String({ maxLength: 500 }),
  row: Type.Optional(Type.String({ maxLength: 1000 })),
  region: Type.Optional(Type.String({ maxLength: 300 })),
  probability: Probability,
});

export const BreakPacket = closedObject({
  runId: Identifier,
  stepId: StepId,
  attempt: PositiveInteger,
  reason: literalUnion(BREAK_REASONS),
  script: closedObject({
    title: NonEmptyText(200),
    stepIndex: NonNegativeInteger,
    stepCount: PositiveInteger,
    step: closedObject({
      id: StepId,
      intent: NonEmptyText(300),
      action: Type.Optional(literalUnion(ACTION_TYPES)),
      risk: Type.Optional(literalUnion(RISK_CLASSES)),
      target: Type.Optional(Target),
    }),
    previousIntents: Type.Array(NonEmptyText(300), { maxItems: 500 }),
    nextIntent: Type.Union([NonEmptyText(300), Type.Null()]),
  }),
  signals: closedObject({
    jev: Type.Record(Type.String({ pattern: '^[a-z][a-z0-9_-]{0,80}$' }), Probability, {
      additionalProperties: false,
    }),
    checks: Type.Array(BreakCheck, { maxItems: 64 }),
    actionError: Type.Union([Type.String({ maxLength: 2000 }), Type.Null()]),
    elapsedMs: NonNegativeInteger,
  }),
  observations: closedObject({
    before: Type.Union([ObservationSummary, Type.Null()]),
    after: Type.Union([ObservationSummary, Type.Null()]),
  }),
  frames: Type.Array(BreakFrame, { maxItems: 6 }),
  console: Type.Array(ConsoleEntry, { maxItems: 50 }),
  network: Type.Array(NetworkEntry, { maxItems: 50 }),
  candidates: Type.Optional(Type.Array(BreakCandidate, { maxItems: 5 })),
  allowed: closedObject({
    decisions: Type.Array(literalUnion(ANALYST_DECISIONS), { minItems: 1, uniqueItems: true }),
    patchActions: Type.Array(literalUnion(ACTION_TYPES), { uniqueItems: true }),
    origins: Type.Array(Type.String({ pattern: ORIGIN_PATTERN }), { uniqueItems: true }),
  }),
  budget: closedObject({
    escalationsLeft: NonNegativeInteger,
    patchActionsMax: NonNegativeInteger,
  }),
});
export type BreakPacket = Static<typeof BreakPacket>;

// ---------------------------------------------------------------------------
// AnalystDecision
// ---------------------------------------------------------------------------

export const Evidence = closedObject({
  frame: Type.Optional(ArtifactRef),
  observation: Type.Optional(literalUnion(['before', 'after'] as const)),
  check: Type.Optional(NonNegativeInteger),
  console: Type.Optional(NonNegativeInteger),
  network: Type.Optional(NonNegativeInteger),
  note: NonEmptyText(1000),
});
export type Evidence = Static<typeof Evidence>;

export const DefectDescription = closedObject({
  title: NonEmptyText(200),
  severity: literalUnion(DEFECT_SEVERITIES),
  expected: NonEmptyText(1000),
  actual: NonEmptyText(1000),
});
export type DefectDescription = Static<typeof DefectDescription>;

export const AnalystDecision = closedObject({
  decision: literalUnion(ANALYST_DECISIONS),
  classification: literalUnion(CLASSIFICATIONS),
  certainty: literalUnion(CERTAINTIES),
  rationale: NonEmptyText(2000),
  evidence: Type.Array(Evidence, { maxItems: 12 }),
  patch: Type.Optional(Type.Array(PatchAction, { maxItems: 10 })),
  resolveTarget: Type.Optional(closedObject({ cid: CandidateId })),
  defect: Type.Optional(Type.Union([DefectDescription, Type.Null()])),
  scriptSuggestion: Type.Optional(Type.Union([NonEmptyText(2000), Type.Null()])),
});
export type AnalystDecision = Static<typeof AnalystDecision>;

// ---------------------------------------------------------------------------
// Vision grounding and assertions
// ---------------------------------------------------------------------------

export const VisualGroundRequest = closedObject({
  runId: Identifier,
  stepId: StepId,
  step: closedObject({ intent: NonEmptyText(300), target: Target }),
  image: InlineImage,
  marks: Type.Array(
    closedObject({
      mark: Type.String({ pattern: '^[0-9]{1,3}$' }),
      label: Type.Optional(Type.String({ maxLength: 300 })),
    }),
    { minItems: 1, maxItems: 200 },
  ),
});
export type VisualGroundRequest = Static<typeof VisualGroundRequest>;

export const VisualGroundResult = closedObject({
  mark: Type.Union([Type.String({ pattern: '^[0-9]{1,3}$' }), Type.Null()]),
  certainty: literalUnion(CERTAINTIES),
  rationale: NonEmptyText(2000),
});
export type VisualGroundResult = Static<typeof VisualGroundResult>;

export const VisionAssertRequest = closedObject({
  runId: Identifier,
  stepId: StepId,
  question: NonEmptyText(500),
  expected: Type.Boolean(),
  image: InlineImage,
  frames: Type.Optional(Type.Array(InlineImage, { maxItems: 6 })),
});
export type VisionAssertRequest = Static<typeof VisionAssertRequest>;

export const VisionAssertResult = closedObject({
  answer: literalUnion(['yes', 'no', 'unsure'] as const),
  certainty: literalUnion(CERTAINTIES),
  rationale: NonEmptyText(2000),
});
export type VisionAssertResult = Static<typeof VisionAssertResult>;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export const RunFlags = closedObject({ adjudicated: Type.Boolean(), healed: Type.Boolean() });
export type RunFlags = Static<typeof RunFlags>;

export const RunStats = closedObject({
  steps: NonNegativeInteger,
  passed: NonNegativeInteger,
  failed: NonNegativeInteger,
  broken: NonNegativeInteger,
  skipped: NonNegativeInteger,
  durationMs: NonNegativeInteger,
  jevCalls: NonNegativeInteger,
  llmCalls: NonNegativeInteger,
  credits: Type.Number({ minimum: 0 }),
});
export type RunStats = Static<typeof RunStats>;

export const ReportDefect = closedObject({
  id: Type.String({ pattern: '^def_[A-Za-z0-9_-]{1,64}$' }),
  stepId: StepId,
  title: NonEmptyText(200),
  severity: literalUnion(DEFECT_SEVERITIES),
  classification: literalUnion(CLASSIFICATIONS),
  signature: Sha256,
});
export type ReportDefect = Static<typeof ReportDefect>;

export const ReportAdjudication = closedObject({
  stepId: StepId,
  decision: literalUnion(['MARK_PASSED', 'RESOLVE_TARGET'] as const),
  rationale: NonEmptyText(2000),
});

export const ReportHeal = closedObject({ stepId: StepId, status: literalUnion(HEAL_STATUSES) });

export const ReportMaintenance = closedObject({
  stepId: Type.Union([StepId, Type.Null()]),
  suggestion: NonEmptyText(2000),
});

export const GeneratedBy = closedObject({
  model: NonEmptyText(128),
  promptVersion: Type.String({ pattern: '^[a-z]-[0-9]+$' }),
});

const reportBodyProperties = {
  summary: NonEmptyText(4000),
  defects: Type.Array(ReportDefect, { maxItems: 500 }),
  adjudications: Type.Array(ReportAdjudication, { maxItems: 500 }),
  heals: Type.Array(ReportHeal, { maxItems: 500 }),
  maintenance: Type.Array(ReportMaintenance, { maxItems: 100 }),
  generatedBy: GeneratedBy,
};

/** What the Analyst returns: no verdict, flags or stats; code injects those. */
export const ReportBody = closedObject(reportBodyProperties);
export type ReportBody = Static<typeof ReportBody>;

export const RunReport = closedObject({
  runId: Identifier,
  verdict: literalUnion(VERDICTS),
  flags: RunFlags,
  stats: RunStats,
  ...reportBodyProperties,
});
export type RunReport = Static<typeof RunReport>;

export const ReportInput = closedObject({
  runId: Identifier,
  script: closedObject({
    name: Slug,
    title: NonEmptyText(200),
    steps: Type.Array(closedObject({ id: StepId, intent: NonEmptyText(300) }), { maxItems: 500 }),
  }),
  verdict: literalUnion(VERDICTS),
  flags: RunFlags,
  stats: RunStats,
  events: Type.Array(RunEvent, { maxItems: 100_000 }),
  keyFrames: Type.Array(
    closedObject({
      ref: ArtifactRef,
      stepId: Type.Union([StepId, Type.Null()]),
      image: Type.Optional(InlineImage),
    }),
    { maxItems: 12 },
  ),
  promptVersion: Type.Optional(Type.String({ pattern: '^[a-z]-[0-9]+$' })),
});
export type ReportInput = Static<typeof ReportInput>;

/** Body of `POST /brain/v1/triage`: the packet plus the frames it references, inlined. */
export const TriageRequest = closedObject({
  packet: BreakPacket,
  frameImages: Type.Array(closedObject({ ref: ArtifactRef, image: InlineImage }), {
    maxItems: 6,
  }),
});
export type TriageRequest = Static<typeof TriageRequest>;
