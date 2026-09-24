/**
 * AI ports (Architecture and contracts, "Navigator port" and "Analyst and Compiler
 * ports"). Types only: adapters live in @argus/navigator, @argus/analyst,
 * @argus/compiler and the brain client; fakes in @argus/testkit.
 *
 * Every method returns a Result: an unavailable provider or an answer that stays invalid
 * after its repair attempt is an expected failure, not an exception (ADR M01-ports).
 */
import type { Result } from '../core/result.js';
import type {
  AnalystDecision,
  BreakPacket,
  ReportBody,
  ReportInput,
  VisionAssertRequest,
  VisionAssertResult,
  VisualGroundRequest,
  VisualGroundResult,
} from '../core/schemas/analyst.js';
import type { Billed } from '../core/schemas/api.js';
import type { CompileRequest, CompileResult } from '../core/schemas/compile.js';
import type {
  GroundRequest,
  GroundResult,
  VerifyRequest,
  VerifyResult,
} from '../core/schemas/navigator.js';
import type { InlineImage } from '../core/schemas/common.js';

/** Why an AI port call produced no usable answer. */
export type AiPortError =
  /** Provider unreachable, overloaded past its retry budget, or timed out. */
  | { readonly code: 'unavailable'; readonly message: string; readonly retryAfterMs?: number }
  /** The request itself is unusable, e.g. over the state budget; a bug upstream. */
  | { readonly code: 'invalid_request'; readonly message: string }
  /** The answer failed validation, after the one repair attempt where one applies. */
  | {
      readonly code: 'invalid_answer';
      readonly message: string;
      readonly errors: readonly string[];
    }
  /** Page-derived text still held a secret; nothing was sent. */
  | { readonly code: 'redaction_failed'; readonly message: string };

/** Navigator errors: `unavailable` becomes `NAVIGATOR_UNAVAILABLE` in the engine. */
export type NavigatorError = AiPortError;

export interface Navigator {
  /** Stage one, then stage two when needed. */
  ground(request: GroundRequest): Promise<Result<GroundResult, NavigatorError>>;
  /** Expectations, probes and handler conditions of one step, in one request. */
  verify(request: VerifyRequest): Promise<Result<VerifyResult, NavigatorError>>;
}

/** Analyst errors: `unavailable` is `ANALYST_UNAVAILABLE`, `invalid_answer` `ANALYST_INVALID`. */
export type AnalystError = AiPortError;

/** Frames a triage call may look at, keyed by the packet's frame references. */
export interface TriageFrames {
  readonly frameImages: readonly { readonly ref: string; readonly image: InlineImage }[];
}

export interface Analyst {
  triage(
    packet: BreakPacket,
    frames?: TriageFrames,
  ): Promise<Result<Billed<AnalystDecision>, AnalystError>>;
  /** Set-of-marks grounding: one mark id from the closed set, or null. */
  groundVisually(
    request: VisualGroundRequest,
  ): Promise<Result<Billed<VisualGroundResult>, AnalystError>>;
  /** Expectation kind `vision`. */
  assertVisually(
    request: VisionAssertRequest,
  ): Promise<Result<Billed<VisionAssertResult>, AnalystError>>;
  /** The report body: no verdict, flags or stats. */
  report(input: ReportInput): Promise<Result<Billed<ReportBody>, AnalystError>>;
}

export type CompilerError = AiPortError;

export interface Compiler {
  /** `CompileResult = { script?, lint, clarifications, usage }`. */
  compile(request: CompileRequest): Promise<Result<CompileResult, CompilerError>>;
}
