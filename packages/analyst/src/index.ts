/**
 * @argus/analyst: the LLM behind closed menus (implementation spec M07). Ports
 * (`LlmProvider`, `ImageScaler`), the decision matrix and validator, prompt templates
 * and data blocks, budgets, the `LlmAnalyst` implementation of the `Analyst` port, the
 * report assembly, and the adapters (Anthropic, OpenAI-compatible, sharp, prompt files).
 */

// Ports.
export type {
  LlmContent,
  LlmError,
  LlmJsonSchema,
  LlmMessage,
  LlmProvider,
  LlmProviderKind,
  LlmRequest,
  LlmResponse,
  LlmStopReason,
  LlmUsage,
} from './ports/llm.js';
export type { ImageError, ImageScaler, ScaledImage } from './ports/images.js';

// Decision menu and validation.
export {
  MATRIX_EXTENSION_REASONS,
  MATRIX_TABLE_REASONS,
  allowedDecisions,
  isEscalable,
} from './core/matrix.js';
export type { MatrixPolicy, MatrixStep } from './core/matrix.js';
export {
  DECISION_RULES,
  formatIssue,
  staysInsideOrigins,
  validateDecision,
} from './core/validate-decision.js';
export type { DecisionIssue, DecisionRule } from './core/validate-decision.js';

// Prompts and data blocks.
export {
  PROMPT_ID_PATTERN,
  PROMPT_SECTIONS,
  parsePromptTemplate,
  placeholdersOf,
  renderSection,
  selectTemplate,
} from './core/prompt-template.js';
export type { PromptKind, PromptTemplate } from './core/prompt-template.js';
export {
  DATA_TAG,
  dataBlock,
  findDataBlocks,
  ndjsonBlock,
  outsideDataBlocks,
} from './core/data-block.js';

// Budgets, frames, estimates, schemas.
export { DEFAULT_LIMITS } from './core/budgets.js';
export type { AnalystLimits } from './core/budgets.js';
export { frameDropOrder, selectFrames } from './core/frames.js';
export {
  MESSAGE_OVERHEAD_TOKENS,
  estimateImageTokens,
  estimateRequestTokens,
  estimateTextTokens,
} from './core/tokens.js';
export type { EstimatedContent } from './core/tokens.js';
export { estimateLlmRequest } from './core/request.js';
export {
  providerSchema,
  triageAnswerSchema,
  visionAssertAnswerSchema,
  visualGroundAnswerSchema,
} from './core/provider-schema.js';
export { buildTriageRequest, renderMenu } from './core/triage-request.js';
export type { BuiltRequest, TriageFrame, TriageOmissions } from './core/triage-request.js';
export { buildReportRequest, reportAnswerSchema } from './core/report-request.js';
export type { ReportKeyFrame, ReportOmissions } from './core/report-request.js';
export {
  eventDropClasses,
  eventPriority,
  ledgerEvents,
  ledgerLines,
  ledgerRecord,
  orderedEvents,
} from './core/ledger.js';
export type { DropClasses, EventPriority, OmittedRun } from './core/ledger.js';
export { readJsonAnswer } from './core/answer.js';

// Report.
export {
  ReportDraft,
  assembleReportBody,
  buildRunReport,
  defectSignature,
  readReportDraft,
} from './core/report.js';
export type { ComputedReportFields } from './core/report.js';

// Retries and models.
export {
  DEFAULT_RETRY_POLICY,
  isRetryableStatus,
  parseRetryAfter,
  retryDelay,
  withRetries,
} from './core/retry.js';
export type { AttemptOutcome, Attempted, RetryPolicy } from './core/retry.js';
export { DEFAULT_PREMIUM_MODEL, DEFAULT_STANDARD_MODEL, modelForTier } from './core/models.js';
export type { ModelEnvironment } from './core/models.js';

// The Analyst.
export { LlmAnalyst, analystBreakReason } from './core/analyst.js';
export type { AnalystOperation, AnalystRequestInfo, LlmAnalystOptions } from './core/analyst.js';

// Live quality (M07-G7, M19-G6).
export { parseLabelledBreaks, runTriageEvaluation, scoreTriage } from './core/evaluation.js';
export type { LabelledBreak, TriageOutcome, TriageQuality } from './core/evaluation.js';

// Adapters (wired in apps/brain/src/main.ts).
export {
  AnthropicProvider,
  REFUSAL_FALLBACK_BETA,
  classify,
} from './adapters/anthropic-provider.js';
export type { AnthropicProviderOptions } from './adapters/anthropic-provider.js';
export { OpenAiCompatibleProvider } from './adapters/openai-compatible-provider.js';
export type {
  OpenAiCompatibleProviderOptions,
  StructuredOutputMode,
} from './adapters/openai-compatible-provider.js';
export { SharpImageScaler } from './adapters/sharp-scaler.js';
export { loadPromptDirectory } from './adapters/prompt-files.js';
export { systemClock } from './adapters/system-clock.js';
