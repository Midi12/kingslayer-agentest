/**
 * @argus/contracts: every public type and schema of ARGUS, plus the pure helpers that
 * belong to them (canonical JSON and hashes, durations, validation, lint, step rendering,
 * the additive-only schema diff) and the port interfaces.
 */

export * from './core/enums.js';
export { err, isErr, isOk, mapResult, ok, unwrapOr } from './core/result.js';
export type { Err, Ok, Result } from './core/result.js';

export { CanonicalizationError, canonicalize, contentHash, hashBytes } from './core/canonical.js';
export { sha256Hex, utf8 } from './core/sha256.js';
export { formatDuration, parseDuration } from './core/duration.js';

export { conforms, explain, validate, validateAgainst } from './core/validate.js';
export type { ValidationError } from './core/validate.js';
export {
  BRAIN_ENDPOINTS,
  RUNNER_ENDPOINTS,
  SCHEMAS,
  SCHEMA_NAMES,
  isSchemaName,
  schemaFileName,
  schemaFileStem,
  schemaId,
} from './core/schemas/registry.js';
export type { SchemaName, SchemaType } from './core/schemas/registry.js';
export {
  CONTRACT_KEYWORDS,
  JSON_SCHEMA_DIALECT,
  exportJsonSchema,
  exportJsonSchemas,
  serializeJsonSchema,
} from './core/json-schema.js';
export type { JsonSchemaDocument } from './core/json-schema.js';
export { diffSchema, diffSchemaSets } from './core/schema-diff.js';
export { discriminatorOf, discriminatorValues } from './core/discriminator.js';
export type { BreakingChange, BreakingKind } from './core/schema-diff.js';

export {
  DEFAULT_RUN_TIMEOUT_MS,
  DEFAULT_WITHIN_MS,
  DESCRIPTION_PRONOUNS,
  MAX_WITHIN_MS,
  defaultLintContext,
  lintScript,
  normalizeIntent,
  noulStatementProblems,
  ownerIdAt,
  verbForms,
} from './core/lint.js';
export type { LintContext } from './core/lint.js';
export { renderAction, renderExpectation, renderSteps, renderTarget } from './core/render.js';
export {
  POLICY_DEFAULTS,
  actionTargets,
  allSteps,
  effectiveRisk,
  isActionStep,
  isFragmentStep,
  isReadOnlyAction,
  maxRisk,
  resolvePolicy,
  resolveTemplates,
  riskForAction,
  templateReferences,
} from './core/script.js';
export type { StepVisit, TemplateReference, TemplateScope } from './core/script.js';
export { stripCandidate, stripForNavigator } from './core/observation.js';

// Schemas and their static types (each name is both a TypeBox schema and a type).
export {
  ARTIFACT_REF_PATTERN,
  ArtifactRef,
  BASE64_PATTERN,
  CANDIDATE_ID_PATTERN,
  CandidateId,
  DURATION_PATTERN,
  Duration,
  HOST_PATTERN,
  ISO_TIMESTAMP_PATTERN,
  Identifier,
  InlineImage,
  IsoTimestamp,
  LOCALE_PATTERN,
  NonNegativeInteger,
  ORIGIN_PATTERN,
  PositiveInteger,
  Probability,
  ProbabilityMap,
  SECRET_NAME_PATTERN,
  SHA256_PATTERN,
  SLUG_PATTERN,
  STEP_ID_PATTERN,
  SecretName,
  Sha256,
  Slug,
  StepId,
  TIMEZONE_PATTERN,
  TokenUsage,
  VARIABLE_NAME_PATTERN,
  VERSION_PATTERN,
  VariableName,
  Version,
} from './core/schemas/common.js';
export type { ScalarValue } from './core/schemas/common.js';
export {
  A11yExpectation,
  Action,
  ActionStep,
  BlinkExpectation,
  ColorExpectation,
  CompilerInfo,
  ConsoleExpectation,
  DomExpectation,
  Expectation,
  Fragment,
  FragmentStep,
  Handler,
  HandlerCondition,
  MaskRect,
  NetworkExpectation,
  NoulExpectation,
  PatchAction,
  PatchTarget,
  Policy,
  ResolvedPolicy,
  ScriptMetadata,
  ScriptTarget,
  Step,
  Target,
  TargetHints,
  TestScript,
  UrlExpectation,
  Variables,
  Viewport,
  VisionExpectation,
  VisualExpectation,
  VisualMask,
} from './core/schemas/script.js';
export type { ActionOf, ExpectationOf } from './core/schemas/script.js';
export {
  BoundingBox,
  Candidate,
  CandidateContext,
  CandidateState,
  ConsoleEntry,
  NavigatorCandidate,
  NavigatorObservation,
  NetworkEntry,
  Observation,
  ObservationFrames,
  ObservationSummary,
  PageSummary,
  RUNNER_ONLY_CANDIDATE_FIELDS,
  RUNNER_ONLY_KEYWORD,
} from './core/schemas/observation.js';
export {
  GroundRequest,
  GroundResult,
  ScreenAnswer,
  VerifyExpectation,
  VerifyHandlerCondition,
  VerifyRequest,
  VerifyResult,
} from './core/schemas/navigator.js';
export {
  AnalystDecision,
  BreakCandidate,
  BreakCheck,
  BreakFrame,
  BreakPacket,
  DefectDescription,
  Evidence,
  GeneratedBy,
  ReportAdjudication,
  ReportBody,
  ReportDefect,
  ReportHeal,
  ReportMaintenance,
  ReportInput,
  RunFlags,
  RunReport,
  RunStats,
  TriageRequest,
  VisionAssertRequest,
  VisionAssertResult,
  VisualGroundRequest,
  VisualGroundResult,
} from './core/schemas/analyst.js';
export {
  RUN_EVENT_STEP_SCOPE,
  RunCounters,
  RunEnvironmentInfo,
  RunEvent,
  RunEventBatch,
  RunEventData,
  UsageEvent,
} from './core/schemas/events.js';
export type { RunEventDataOf, RunEventOf } from './core/schemas/events.js';
export {
  BrainUsage,
  Clarification,
  CompileEnvironment,
  CompileRequest,
  CompileResult,
  LintFinding,
} from './core/schemas/compile.js';
export {
  ArtifactsRequest,
  ArtifactsResponse,
  BrainAssertVisualResponse,
  BrainCompileResponse,
  BrainGroundResponse,
  BrainGroundVisualResponse,
  BrainReportResponse,
  BrainTriageResponse,
  BrainVerifyResponse,
  CompleteRequest,
  CompleteResponse,
  EventsBatchResponse,
  HeartbeatRequest,
  HeartbeatResponse,
  JobEnvironment,
  JobLimits,
  JobSecret,
  LeaseRequest,
  LeaseResponse,
  Problem,
  ProblemFieldError,
  RunJob,
  RunnerRegisterRequest,
  RunnerRegisterResponse,
} from './core/schemas/api.js';
export type { Billed } from './core/schemas/api.js';
export { problem, problemType } from './core/problem.js';

// Ports: types only.
export type {
  AiPortError,
  Analyst,
  AnalystError,
  Compiler,
  CompilerError,
  Navigator,
  NavigatorError,
  TriageFrames,
} from './ports/ai.js';
export type { Clock, IdGenerator } from './ports/runtime.js';
export type * from './ports/platform.js';
