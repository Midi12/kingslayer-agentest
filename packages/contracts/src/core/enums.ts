/**
 * Closed vocabularies of the ARGUS contracts (Architecture and contracts tab). Each one is
 * a `const` array, so code can iterate it, and a union type derived from it.
 */

export const API_VERSION = 'argus/v1';

/** Base of every schema `$id`; a schema file is `<base><kebab-name>.schema.json`. */
export const SCHEMA_ID_BASE = 'https://argus.dev/schemas/argus/v1/';

/** Base of the RFC 9457 problem `type` URIs; the code is appended. */
export const PROBLEM_TYPE_BASE = 'https://argus.dev/problems/';

export const BREAK_REASONS = [
  'TARGET_NOT_FOUND',
  'GROUNDING_AMBIGUOUS',
  'AUTH_LOST',
  'BLOCKING_MODAL',
  'UNEXPECTED_ERROR_UI',
  'ASSERTION_FAILED',
  'VISUAL_DIFF',
  'EXPECTATION_FAILED',
  'EXPECTATION_UNCERTAIN',
  'NO_EFFECT',
  'CONSOLE_OR_NETWORK_ERROR',
  'ACTION_ERROR',
  'TIMEOUT',
  'OFF_PATH',
  'OBSERVE_FAILED',
  'SETUP_FAILED',
  'BUDGET_EXHAUSTED',
  'RUNNER_LOST',
  'ANALYST_UNAVAILABLE',
  'ANALYST_INVALID',
  'NAVIGATOR_UNAVAILABLE',
] as const;
export type BreakReason = (typeof BREAK_REASONS)[number];

export const VERDICTS = ['passed', 'failed', 'broken', 'aborted', 'canceled'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const STEP_OUTCOMES = ['passed', 'failed', 'broken', 'skipped'] as const;
export type StepOutcome = (typeof STEP_OUTCOMES)[number];

export const RISK_CLASSES = ['read', 'write', 'critical'] as const;
export type RiskClass = (typeof RISK_CLASSES)[number];

export const ROLES = ['owner', 'admin', 'maintainer', 'runner', 'viewer', 'billing'] as const;
export type Role = (typeof ROLES)[number];

export const ACTION_TYPES = [
  'navigate',
  'click',
  'dblclick',
  'rightclick',
  'hover',
  'check',
  'uncheck',
  'fill',
  'clear',
  'select',
  'press',
  'upload',
  'drag',
  'scroll',
  'wait',
  'assert',
  'extract',
  'http',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Action types that take exactly one `target` and nothing else. */
export const POINTER_ACTION_TYPES = [
  'click',
  'dblclick',
  'rightclick',
  'hover',
  'check',
  'uncheck',
] as const;
export type PointerActionType = (typeof POINTER_ACTION_TYPES)[number];

/**
 * Action types a read-only (production) environment still allows
 * (Security table: navigate, hover, scroll, wait, assert and extract).
 */
export const READ_ONLY_ACTION_TYPES = [
  'navigate',
  'hover',
  'scroll',
  'wait',
  'assert',
  'extract',
] as const satisfies readonly ActionType[];

export const EXPECTATION_KINDS = [
  'noul',
  'dom',
  'url',
  'color',
  'blink',
  'visual',
  'vision',
  'console',
  'network',
  'a11y',
] as const;
export type ExpectationKind = (typeof EXPECTATION_KINDS)[number];

export const DOM_OPS = [
  'exists',
  'absent',
  'visible',
  'enabled',
  'disabled',
  'textEquals',
  'textContains',
  'textMatches',
  'valueEquals',
  'numberCompare',
  'countEquals',
] as const;
export type DomOp = (typeof DOM_OPS)[number];

/** DOM operations that carry no operand. */
export const DOM_STATE_OPS = ['exists', 'absent', 'visible', 'enabled', 'disabled'] as const;
/** DOM operations whose operand is a literal string `value`. */
export const DOM_TEXT_OPS = ['textEquals', 'textContains', 'valueEquals'] as const;

export const NUMBER_COMPARATORS = ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] as const;
export type NumberComparator = (typeof NUMBER_COMPARATORS)[number];

export const URL_OPS = ['equals', 'contains', 'matches'] as const;
export type UrlOp = (typeof URL_OPS)[number];

export const COLOR_OPS = ['is', 'isNot'] as const;
export type ColorOp = (typeof COLOR_OPS)[number];

export const PALETTE = [
  'red',
  'amber',
  'yellow',
  'green',
  'blue',
  'grey',
  'white',
  'black',
] as const;
export type PaletteColor = (typeof PALETTE)[number];

export const A11Y_RULESETS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'wcag22aa',
  'best-practice',
] as const;
export type A11yRuleset = (typeof A11Y_RULESETS)[number];

export const A11Y_IMPACTS = ['minor', 'moderate', 'serious', 'critical'] as const;
export type A11yImpact = (typeof A11Y_IMPACTS)[number];

export const SCROLL_DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export type ScrollDirection = (typeof SCROLL_DIRECTIONS)[number];

export const EXTRACT_PARSERS = ['text', 'number', 'regex'] as const;
export type ExtractParser = (typeof EXTRACT_PARSERS)[number];

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Standard probes asked on every verify (question catalogue). */
export const PROBE_NAMES = ['error_ui', 'auth_lost', 'blocking_modal', 'loading'] as const;
export type ProbeName = (typeof PROBE_NAMES)[number];

/** Options of the `screen_kind` Choice. */
export const SCREEN_KINDS = ['expected', 'same_app_other', 'error_or_blank', 'external'] as const;
export type ScreenKind = (typeof SCREEN_KINDS)[number];

export const ON_BREAK_POLICIES = ['escalate', 'fail', 'skip'] as const;
export type OnBreakPolicy = (typeof ON_BREAK_POLICIES)[number];

export const SCREENSHOT_SHARING = ['never', 'on-break', 'always'] as const;
export type ScreenshotSharing = (typeof SCREENSHOT_SHARING)[number];

export const ARTIFACT_POLICIES = ['on-failure', 'full'] as const;
export type ArtifactPolicy = (typeof ARTIFACT_POLICIES)[number];

export const PII_MODES = ['off', 'standard', 'strict'] as const;
export type PiiMode = (typeof PII_MODES)[number];

export const DEGRADE_POLICIES = ['analyst', 'fail'] as const;
export type DegradePolicy = (typeof DEGRADE_POLICIES)[number];

export const HEAL_APPROVALS = ['manual', 'auto'] as const;
export type HealApproval = (typeof HEAL_APPROVALS)[number];

export const ANALYST_DECISIONS = [
  'RETRY_STEP',
  'PATCH',
  'RESOLVE_TARGET',
  'MARK_PASSED',
  'MARK_FAILED_CONTINUE',
  'MARK_FAILED_ABORT',
  'ABORT_ENV',
] as const;
export type AnalystDecisionType = (typeof ANALYST_DECISIONS)[number];

export const CLASSIFICATIONS = [
  'PRODUCT_DEFECT',
  'TEST_DRIFT',
  'ENVIRONMENT',
  'TRANSIENT',
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export const CERTAINTIES = ['low', 'medium', 'high'] as const;
export type Certainty = (typeof CERTAINTIES)[number];

export const DEFECT_SEVERITIES = ['critical', 'major', 'minor', 'trivial'] as const;
export type DefectSeverity = (typeof DEFECT_SEVERITIES)[number];

/** Decisions of the pure `decide` function (Decision function table). */
export const ENGINE_DECISIONS = ['CONTINUE', 'RETRY', 'WAIT', 'RUN_HANDLER', 'BREAK'] as const;
export type EngineDecision = (typeof ENGINE_DECISIONS)[number];

/** States of the run engine state machine. */
export const ENGINE_STATES = [
  'PREPARE',
  'OBSERVE',
  'HANDLERS',
  'GROUND',
  'ACT',
  'SETTLE',
  'VERIFY',
  'DECIDE',
  'ESCALATE',
  'NEXT',
  'FINALIZE',
] as const;
export type EngineState = (typeof ENGINE_STATES)[number];

export const GROUNDING_SOURCES = ['cache', 'jev', 'vision'] as const;
export type GroundingSource = (typeof GROUNDING_SOURCES)[number];

export const CANDIDATE_SOURCES = ['dom', 'ocr', 'region'] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

export const CHECK_OUTCOMES = ['pass', 'fail', 'error'] as const;
export type CheckOutcome = (typeof CHECK_OUTCOMES)[number];

export const HEAL_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type HealStatus = (typeof HEAL_STATUSES)[number];

export const RUN_EVENT_TYPES = [
  'run.started',
  'step.started',
  'step.finished',
  'observation.captured',
  'navigator.ground',
  'navigator.verify',
  'action.performed',
  'check.evaluated',
  'decision.made',
  'handler.fired',
  'escalation.requested',
  'escalation.decided',
  'artifact.stored',
  'usage.recorded',
  'run.finished',
] as const;
export type RunEventType = (typeof RUN_EVENT_TYPES)[number];

/** Rate-card operations (product design, Rate card). */
export const USAGE_OPERATIONS = [
  'step',
  'ai_vision',
  'escalation',
  'report',
  'compile',
  'runner_minute',
] as const;
export type UsageOperation = (typeof USAGE_OPERATIONS)[number];

export const AI_MODES = ['managed', 'byo'] as const;
export type AiMode = (typeof AI_MODES)[number];

export const MODEL_TIERS = ['standard', 'premium'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const RUNNER_KINDS = ['cloud', 'self-hosted', 'ephemeral'] as const;
export type RunnerKind = (typeof RUNNER_KINDS)[number];

export const ENVIRONMENT_KINDS = ['dev', 'staging', 'production', 'ephemeral'] as const;
export type EnvironmentKind = (typeof ENVIRONMENT_KINDS)[number];

export const SECRET_LOCATIONS = ['vault', 'runner-local'] as const;
export type SecretLocation = (typeof SECRET_LOCATIONS)[number];

export const ARTIFACT_KINDS = [
  'screenshot',
  'frame',
  'trace',
  'video',
  'har',
  'packet',
  'report',
  'baseline',
  'log',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/** How a run ended, as the runner reports it in `run.finished` and `complete`. */
export const RUN_TERMINATIONS = [
  'completed',
  'aborted',
  'canceled',
  'setup_failed',
  'runner_lost',
] as const;
export type RunTermination = (typeof RUN_TERMINATIONS)[number];

export const LINT_CODES = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'] as const;
export type LintCode = (typeof LINT_CODES)[number];

export const LINT_SEVERITIES = ['error', 'warning'] as const;
export type LintSeverity = (typeof LINT_SEVERITIES)[number];

export const AI_PROVIDER_KINDS = ['jev', 'llm', 'none'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/** Stable `code` of RFC 9457 problem documents, with its HTTP status. */
export const PROBLEM_STATUS = {
  validation_failed: 400,
  unauthorized: 401,
  insufficient_credits: 402,
  forbidden: 403,
  target_not_verified: 403,
  not_found: 404,
  conflict: 409,
  not_approved: 409,
  environment_read_only: 409,
  gap_detected: 409,
  lint_failed: 422,
  origin_not_allowed: 422,
  quota_exceeded: 429,
  rate_limited: 429,
  internal: 500,
} as const;
export type ProblemCode = keyof typeof PROBLEM_STATUS;
export const PROBLEM_CODES = Object.keys(PROBLEM_STATUS) as readonly ProblemCode[];

/** Verbs that force `risk: critical` when a project defines none (lint rule L5). */
export const DEFAULT_CRITICAL_VERBS = ['delete', 'stop', 'reset', 'purge', 'emergency'] as const;
