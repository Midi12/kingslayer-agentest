/**
 * Wire bodies of the runner protocol (`/runner/v1/*`), the internal brain API
 * (`/brain/v1/*`) and RFC 9457 problem documents (Architecture and contracts, "Runner
 * protocol" and "REST API").
 */
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import {
  ARTIFACT_KINDS,
  ENGINE_STATES,
  ENVIRONMENT_KINDS,
  PROBLEM_CODES,
  RUN_TERMINATIONS,
  RUNNER_KINDS,
  SECRET_LOCATIONS,
  VERDICTS,
} from '../enums.js';
import {
  ArtifactRef,
  HOST_PATTERN,
  Identifier,
  IsoTimestamp,
  NonEmptyText,
  NonNegativeInteger,
  ORIGIN_PATTERN,
  PositiveInteger,
  ScalarValue,
  SecretName,
  Sha256,
  StepId,
  VariableName,
  Version,
  closedObject,
  literalUnion,
} from './common.js';
import { BrainUsage, CompileResult, LintFinding } from './compile.js';
import { RunCounters } from './events.js';
import { GroundResult, VerifyResult } from './navigator.js';
import {
  AnalystDecision,
  ReportBody,
  RunFlags,
  VisionAssertResult,
  VisualGroundResult,
} from './analyst.js';
import { ResolvedPolicy, TestScript, Viewport } from './script.js';

const Label = Type.String({ pattern: '^[a-z0-9]([a-z0-9._/-]{0,62}[a-z0-9])?$' });
const Labels = Type.Array(Label, { uniqueItems: true, maxItems: 32 });

// ---------------------------------------------------------------------------
// Runner protocol
// ---------------------------------------------------------------------------

/** `POST /runner/v1/register`; the runner token travels as the bearer credential. */
export const RunnerRegisterRequest = closedObject({
  name: NonEmptyText(128),
  version: Version,
  kind: literalUnion(RUNNER_KINDS),
  slots: Type.Integer({ minimum: 1, maximum: 64 }),
  labels: Labels,
  platform: Type.Optional(closedObject({ os: NonEmptyText(32), arch: NonEmptyText(32) })),
});
export type RunnerRegisterRequest = Static<typeof RunnerRegisterRequest>;

export const RunnerRegisterResponse = closedObject({
  runnerId: Identifier,
  sessionToken: NonEmptyText(8192, 'Short-lived session JWT'),
  expiresAt: IsoTimestamp,
  heartbeatIntervalSec: PositiveInteger,
  leaseWaitSec: Type.Integer({ minimum: 1, maximum: 30 }),
});
export type RunnerRegisterResponse = Static<typeof RunnerRegisterResponse>;

export const LeaseRequest = closedObject({
  runnerId: Identifier,
  slotsFree: PositiveInteger,
  labels: Labels,
  waitSec: Type.Optional(Type.Integer({ minimum: 0, maximum: 30 })),
});
export type LeaseRequest = Static<typeof LeaseRequest>;

export const JobEnvironment = closedObject({
  id: Identifier,
  name: NonEmptyText(128),
  kind: literalUnion(ENVIRONMENT_KINDS),
  baseUrl: NonEmptyText(2048),
  allowedOrigins: Type.Array(Type.String({ pattern: ORIGIN_PATTERN }), { uniqueItems: true }),
  allowedHttpHosts: Type.Array(Type.String({ pattern: HOST_PATTERN }), { uniqueItems: true }),
  readOnly: Type.Boolean(),
  values: Type.Record(
    Type.String({ pattern: '^[A-Z][A-Z0-9_]{0,63}$' }),
    Type.String({ maxLength: 4096 }),
    {
      additionalProperties: false,
      description: 'Values of ${env.NAME}, BASE_URL included',
    },
  ),
  viewport: Type.Optional(Viewport),
  locale: Type.Optional(NonEmptyText(35)),
  timezone: Type.Optional(NonEmptyText(64)),
});
export type JobEnvironment = Static<typeof JobEnvironment>;

export const JobSecret = closedObject({
  name: SecretName,
  location: literalUnion(SECRET_LOCATIONS),
  value: Type.Optional(
    Type.String({
      maxLength: 65_536,
      description: 'Present for vault secrets; runner-local ones resolve on site',
    }),
  ),
});

export const JobLimits = closedObject({
  runTimeoutMs: PositiveInteger,
  stepTimeoutMs: PositiveInteger,
  stepRetries: NonNegativeInteger,
  escalationsPerStep: NonNegativeInteger,
  escalationsPerRun: NonNegativeInteger,
  patchActionsPerEscalation: NonNegativeInteger,
});
export type JobLimits = Static<typeof JobLimits>;

export const RunJob = closedObject({
  runId: Identifier,
  orgId: Identifier,
  projectId: Identifier,
  testVersionId: Identifier,
  attempt: PositiveInteger,
  script: TestScript,
  scriptHash: Sha256,
  environment: JobEnvironment,
  policy: ResolvedPolicy,
  variables: Type.Record(VariableName, ScalarValue, { additionalProperties: false }),
  secrets: Type.Array(JobSecret, { maxItems: 64 }),
  strict: Type.Boolean(),
  limits: JobLimits,
  brain: closedObject({
    url: NonEmptyText(2048),
    runToken: NonEmptyText(8192, 'Per-run token for the brain: org, run id, expiry'),
  }),
  ci: Type.Optional(
    closedObject({
      branch: Type.Optional(NonEmptyText(256)),
      sha: Type.Optional(Type.String({ pattern: '^[0-9a-f]{7,64}$' })),
      pipelineUrl: Type.Optional(NonEmptyText(2048)),
    }),
  ),
});
export type RunJob = Static<typeof RunJob>;

/** 200 body of `POST /runner/v1/lease`; no job is a 204 without a body. */
export const LeaseResponse = closedObject({
  leaseId: Identifier,
  expiresAt: IsoTimestamp,
  heartbeatIntervalSec: PositiveInteger,
  job: RunJob,
});
export type LeaseResponse = Static<typeof LeaseResponse>;

export const HeartbeatRequest = closedObject({
  leaseId: Identifier,
  state: Type.Optional(literalUnion(ENGINE_STATES)),
  stepId: Type.Optional(Type.Union([StepId, Type.Null()])),
  lastSeq: Type.Optional(NonNegativeInteger),
});
export type HeartbeatRequest = Static<typeof HeartbeatRequest>;

export const HeartbeatResponse = closedObject({
  expiresAt: IsoTimestamp,
  cancel: Type.Boolean(),
  cancelReason: Type.Optional(NonEmptyText(500)),
});
export type HeartbeatResponse = Static<typeof HeartbeatResponse>;

/** 200 body of `POST /runner/v1/runs/{id}/events` (the request is NDJSON RunEvent lines). */
export const EventsBatchResponse = closedObject({
  accepted: NonNegativeInteger,
  duplicates: NonNegativeInteger,
  lastSeq: NonNegativeInteger,
});
export type EventsBatchResponse = Static<typeof EventsBatchResponse>;

export const ArtifactsRequest = closedObject({
  artifacts: Type.Array(
    closedObject({
      kind: literalUnion(ARTIFACT_KINDS),
      name: Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$' }),
      contentType: Type.String({ pattern: '^[a-z]+/[A-Za-z0-9.+-]+$' }),
      bytes: NonNegativeInteger,
      sha256: Sha256,
      stepId: Type.Optional(StepId),
    }),
    { minItems: 1, maxItems: 100 },
  ),
});
export type ArtifactsRequest = Static<typeof ArtifactsRequest>;

export const ArtifactsResponse = closedObject({
  uploads: Type.Array(
    closedObject({
      name: NonEmptyText(256),
      ref: ArtifactRef,
      url: NonEmptyText(8192, 'Pre-signed PUT URL'),
      method: Type.Literal('PUT'),
      headers: Type.Record(
        Type.String({ pattern: '^[A-Za-z0-9-]{1,128}$' }),
        Type.String({ maxLength: 4096 }),
        {
          additionalProperties: false,
        },
      ),
      expiresAt: IsoTimestamp,
    }),
    { maxItems: 100 },
  ),
});
export type ArtifactsResponse = Static<typeof ArtifactsResponse>;

export const CompleteRequest = closedObject({
  leaseId: Identifier,
  termination: literalUnion(RUN_TERMINATIONS),
  lastSeq: NonNegativeInteger,
  counters: RunCounters,
  error: Type.Optional(NonEmptyText(2000)),
});
export type CompleteRequest = Static<typeof CompleteRequest>;

export const CompleteResponse = closedObject({
  runId: Identifier,
  verdict: literalUnion(VERDICTS),
  flags: RunFlags,
  credits: closedObject({
    reserved: Type.Number({ minimum: 0 }),
    settled: Type.Number({ minimum: 0 }),
  }),
});
export type CompleteResponse = Static<typeof CompleteResponse>;

// ---------------------------------------------------------------------------
// Brain API: every response is { result, usage }
// ---------------------------------------------------------------------------

function brainResponse<T extends TSchema>(result: T) {
  return closedObject({ result, usage: BrainUsage });
}

export const BrainCompileResponse = brainResponse(CompileResult);
export const BrainGroundResponse = brainResponse(GroundResult);
export const BrainVerifyResponse = brainResponse(VerifyResult);
export const BrainTriageResponse = brainResponse(AnalystDecision);
export const BrainGroundVisualResponse = brainResponse(VisualGroundResult);
export const BrainAssertVisualResponse = brainResponse(VisionAssertResult);
export const BrainReportResponse = brainResponse(ReportBody);

/** A brain response: the result plus the usage block used for metering. */
export interface Billed<T> {
  result: T;
  usage: BrainUsage;
}

// ---------------------------------------------------------------------------
// RFC 9457 problem documents
// ---------------------------------------------------------------------------

export const ProblemFieldError = closedObject({
  path: Type.String({ pattern: '^(/[^/]*)*$' }),
  message: NonEmptyText(1000),
});

/**
 * A problem document. Extension members are allowed (RFC 9457 section 3.2); the ones
 * ARGUS defines are typed here.
 */
export const Problem = Type.Object(
  {
    type: Type.String({ pattern: '^https?://[^\\s]+$' }),
    title: NonEmptyText(200),
    status: Type.Integer({ minimum: 400, maximum: 599 }),
    code: literalUnion(PROBLEM_CODES),
    detail: Type.Optional(NonEmptyText(4000)),
    instance: Type.Optional(NonEmptyText(2048)),
    errors: Type.Optional(Type.Array(ProblemFieldError, { maxItems: 200 })),
    findings: Type.Optional(Type.Array(LintFinding, { maxItems: 1000 })),
    expectedSeq: Type.Optional(PositiveInteger),
    retryAfterSec: Type.Optional(NonNegativeInteger),
    requestId: Type.Optional(NonEmptyText(128)),
  },
  { additionalProperties: true },
);
export type Problem = Static<typeof Problem>;

// Static types of the building blocks above, for consumers that build or read them.
export type JobSecret = Static<typeof JobSecret>;
export type ProblemFieldError = Static<typeof ProblemFieldError>;
export type BrainCompileResponse = Static<typeof BrainCompileResponse>;
export type BrainGroundResponse = Static<typeof BrainGroundResponse>;
export type BrainVerifyResponse = Static<typeof BrainVerifyResponse>;
export type BrainTriageResponse = Static<typeof BrainTriageResponse>;
export type BrainGroundVisualResponse = Static<typeof BrainGroundVisualResponse>;
export type BrainAssertVisualResponse = Static<typeof BrainAssertVisualResponse>;
export type BrainReportResponse = Static<typeof BrainReportResponse>;
