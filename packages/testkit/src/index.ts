export {
  NETWORK_DENIED,
  NetworkDeniedError,
  PROXY_ENVIRONMENT_VARIABLES,
  connectTarget,
  datagramAddress,
  deniedAttempts,
  fetchUrl,
  guardChildProcessArguments,
  guardImportFlag,
  guardLookupFunction,
  guardLookupOption,
  guardWorkerArguments,
  httpRequestHosts,
  installNetworkGuard,
  isLoopbackHost,
  isNetworkGuardInstalled,
  lookupAddresses,
  networkGuardPreloadUrl,
  preloadProblem,
  propagateNetworkGuard,
  stripProxyEnvironment,
  withGuardNodeOptions,
} from './network-guard.js';
export type { ConnectTarget, NetworkGuardOptions } from './network-guard.js';
export { recordGateMetrics } from './gate-metrics.js';
export type { MetricValue, Metrics } from './gate-metrics.js';

// Seeded randomness and token estimates shared by the fakes.
export { seededRandom } from './core/random.js';
export type { Random } from './core/random.js';
export { estimateTextTokens, estimateTokens } from './core/tokens.js';

// Port fakes (ADR M03-port-fakes).
export { FAKE_CLOCK_EPOCH, FakeClock } from './core/fakes/clock.js';
export { SeqIdGenerator } from './core/fakes/ids.js';
export type { SeqIdOptions } from './core/fakes/ids.js';
export {
  HEARTBEAT_INTERVAL_MS,
  InMemoryQueue,
  LEASE_TTL_MS,
  MAX_LEASES,
} from './core/fakes/queue.js';
export type { InMemoryQueueOptions } from './core/fakes/queue.js';
export { InMemoryEventBus } from './core/fakes/event-bus.js';
export { InMemoryMailer } from './core/fakes/mailer.js';
export {
  DEFAULT_WEBHOOK_SECRET,
  InMemoryPayments,
  WEBHOOK_TOLERANCE_SECONDS,
  signWebhook,
} from './core/fakes/payments.js';
export type {
  ChargeOutcome,
  ChargeStatus,
  InMemoryPaymentsOptions,
} from './core/fakes/payments.js';
export { InMemoryObjectStore } from './core/fakes/object-store.js';
export type { InMemoryObjectStoreOptions, PresignCheck } from './core/fakes/object-store.js';
export { hmacSha256Hex } from './core/fakes/hmac.js';
export { serveObjectStore } from './adapters/object-store-server.js';
export type { ObjectStoreRequestRecord } from './adapters/object-store-server.js';

// Fake servers share one handle shape (ADR M03-port-fakes): { url, close, requests }.
export type { FakeServer, ListenOptions } from './adapters/http.js';

// Fake Jev (ADR M03-jev-fake, ADR M03-jev-modes).
export {
  argmax,
  choiceAnswer,
  choiceConfidence,
  distributionWithConfidence,
  normalize,
  noulAnswer,
  scoreAnswer,
  uniformAnswer,
} from './core/jev/answers.js';
export { JEV_MODEL_ALIASES, JEV_MODELS, JEV_PINNED_MODEL } from './core/jev/models.js';
export { oracleAnswers, oracleFromTargets } from './core/jev/oracle.js';
export type {
  OracleAnswers,
  OracleOptions,
  OracleTruth,
  OracleTruthFunction,
  TargetOracleOptions,
  TargetTruth,
} from './core/jev/oracle.js';
export { ScriptRunner, answerFromScript, lookupAnswer, matches } from './core/jev/script.js';
export type {
  JevMatcher,
  JevOutcome,
  JevRule,
  JevScript,
  ScriptedAnswer,
  ScriptedAnswers,
} from './core/jev/script.js';
export type {
  ChoiceAnswer,
  ChoiceQuestion,
  EntryType,
  JevAnswer,
  JevModelCard,
  JevQuestion,
  JevRequest,
  JevResult,
  JevUsage,
  JevValidationIssue,
  JsonValue,
  NoulAnswer,
  NoulQuestion,
  ScoreAnswer,
  ScoreQuestion,
} from './core/jev/types.js';
export {
  JEV_LATEST_ALIAS,
  MAX_CHOICE_OPTIONS,
  MAX_CONTEXT_TOKENS,
  MAX_SCORE_LEVELS,
  MIN_SCORE_LEVELS,
  estimateJevInputTokens,
  validateJevRequest,
} from './core/jev/validate.js';
export type { JevValidation, JevValidationOptions } from './core/jev/validate.js';
export {
  DEFAULT_FAKE_JEV_API_KEY,
  FAKE_JEV_ERROR,
  startFakeJev,
} from './adapters/fake-jev-server.js';
export type {
  FakeJevMode,
  FakeJevOptions,
  FakeJevServer,
  JevCallOutcome,
  JevRequestRecord,
} from './adapters/fake-jev-server.js';

// Fake LLM (ADR M03-llm-fake).
export {
  LLM_FAULT_MODES,
  REFUSAL_TEXT,
  findInjection,
  isLlmFault,
  malformJson,
  obey,
  overlongText,
  schemaViolation,
} from './core/llm/faults.js';
export type { Injection, LlmFault } from './core/llm/faults.js';
export {
  OPENAI_DEFAULT_MAX_TOKENS,
  messageText,
  parseAnthropicRequest,
  parseOpenAiRequest,
} from './core/llm/request.js';
export type {
  LlmMessageView,
  LlmParse,
  LlmRequestView,
  LlmShape,
  LlmToolSpec,
} from './core/llm/request.js';
export { LlmScriptRunner, llmMatches } from './core/llm/script.js';
export type {
  LlmCall,
  LlmLogprob,
  LlmMatcher,
  LlmOutcome,
  LlmRule,
  LlmScript,
  LlmScriptedResponse,
} from './core/llm/script.js';
export {
  DEFAULT_FAKE_LLM_API_KEY,
  DEFAULT_TIMEOUT_HOLD_MS,
  FAULT_HEADER,
  startFakeLlm,
} from './adapters/fake-llm-server.js';
export type {
  FakeLlmOptions,
  FakeLlmServer,
  LlmCallOutcome,
  LlmRequestRecord,
} from './adapters/fake-llm-server.js';

// Cassettes (ADR M03-cassettes).
export {
  CassetteBody,
  CassetteEntry,
  cassetteFileName,
  cassetteKey,
  decodeBody,
  encodeBody,
  isCassetteEntry,
  suiteSlug,
} from './core/cassette/entry.js';
export type { CanonicalRequest } from './core/cassette/entry.js';
export {
  CREDENTIAL_HEADERS,
  KEY_PATTERNS,
  REDACTED,
  findKeyMaterial,
  maskCredential,
  maskHeaders,
  recordingKey,
  redactJson,
  redactString,
  redactText,
  sanitizeBody,
  sanitizeHeaders,
  sanitizeRequest,
} from './core/cassette/redact.js';
export type { KeyMatch, KeyPattern } from './core/cassette/redact.js';
export { MemoryCassetteStore } from './core/cassette/memory-store.js';
export type { CassetteStore } from './ports/cassette.js';
export {
  CASSETTE_BINARY_BODY,
  CASSETTE_MISS,
  CassetteBinaryBodyError,
  CassetteMissError,
  FileCassetteStore,
  cassetteDir,
  createCassetteFetch,
  replayResponse,
  startCassetteProxy,
} from './adapters/cassettes.js';
export type {
  CassetteFetch,
  CassetteFetchOptions,
  CassetteMode,
  CassetteProxyOptions,
  CassetteProxyRecord,
  FetchLike,
} from './adapters/cassettes.js';

// Script files (JSON) for the fakes app and the admin endpoints.
export {
  JevScriptSchema,
  LlmScriptSchema,
  parseJevOutcomes,
  parseJevScript,
  parseLlmOutcomes,
  parseLlmScript,
  parseTargetMap,
} from './core/script-files.js';
