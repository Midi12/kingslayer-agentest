/**
 * Scripted behaviour of the fake LLM: responses by request matcher, a default response,
 * and queues of per-call outcomes (a fault, a status, a delay, a one-off response).
 */
import type { LlmFault } from './faults.js';
import { messageText, type LlmRequestView, type LlmShape } from './request.js';

export interface LlmLogprob {
  readonly token: string;
  readonly logprob: number;
  /** Alternatives for this position and their log-probabilities. */
  readonly top?: Readonly<Record<string, number>>;
}

export interface LlmScriptedResponse {
  /** Plain text answer. */
  readonly text?: string;
  /** A JSON answer: a tool call when tools are supplied, JSON text otherwise. */
  readonly json?: unknown;
  /** An explicit tool call. */
  readonly toolUse?: { readonly name?: string; readonly input: unknown };
  /** Overrides the stop reason (Anthropic) or finish reason (OpenAI). */
  readonly stopReason?: string;
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number };
  /** OpenAI shape: log-probabilities of the output tokens. */
  readonly logprobs?: readonly LlmLogprob[];
  /**
   * OpenAI shape: probabilities of single-token labels (LocalNavigator Choice or yes/no);
   * the answer is the most likely label and the first token carries the alternatives.
   */
  readonly choiceProbabilities?: Readonly<Record<string, number>>;
}

export interface LlmOutcome {
  readonly fault?: LlmFault;
  /** Status of a `server-error` fault; 500 by default. */
  readonly status?: number;
  readonly delayMs?: number;
  readonly response?: LlmScriptedResponse;
}

export interface LlmMatcher {
  readonly shape?: LlmShape;
  readonly model?: string;
  readonly systemIncludes?: string;
  /** Some message text contains this. */
  readonly textIncludes?: string;
  /** A tool of this name is supplied. */
  readonly tool?: string;
  readonly where?: (view: LlmRequestView) => boolean;
}

export interface LlmRule {
  readonly match: LlmMatcher;
  readonly response?: LlmScriptedResponse;
  readonly fault?: LlmFault;
  readonly outcomes?: readonly LlmOutcome[];
}

export interface LlmScript {
  /** Response when no rule gives one. */
  readonly response?: LlmScriptedResponse;
  readonly rules?: readonly LlmRule[];
  readonly outcomes?: readonly LlmOutcome[];
  /** A fault applied to every call that nothing else decides. */
  readonly fault?: LlmFault;
}

export function llmMatches(matcher: LlmMatcher, view: LlmRequestView): boolean {
  return (
    (matcher.shape === undefined || matcher.shape === view.shape) &&
    (matcher.model === undefined || matcher.model === view.model) &&
    (matcher.systemIncludes === undefined || view.system.includes(matcher.systemIncludes)) &&
    (matcher.textIncludes === undefined || messageText(view).includes(matcher.textIncludes)) &&
    (matcher.tool === undefined || view.tools.some((tool) => tool.name === matcher.tool)) &&
    (matcher.where === undefined || matcher.where(view))
  );
}

export interface LlmCall {
  readonly fault: LlmFault | undefined;
  readonly status: number | undefined;
  readonly delayMs: number | undefined;
  readonly response: LlmScriptedResponse | undefined;
}

/** Throws when an outcome's status is not an error status (an integer from 400 to 599). */
export function assertLlmOutcomes(outcomes: readonly LlmOutcome[]): void {
  for (const outcome of outcomes) {
    const status = outcome.status;
    if (status !== undefined && !(Number.isInteger(status) && status >= 400 && status <= 599)) {
      throw new RangeError(
        `a queued outcome status is an error status from 400 to 599, got ${String(status)}`,
      );
    }
  }
}

function assertLlmScript(script: LlmScript): void {
  assertLlmOutcomes(script.outcomes ?? []);
  for (const rule of script.rules ?? []) {
    assertLlmOutcomes(rule.outcomes ?? []);
  }
}

export class LlmScriptRunner {
  #script: LlmScript;
  #queue: LlmOutcome[];
  #ruleQueues: LlmOutcome[][];

  constructor(script: LlmScript = {}) {
    assertLlmScript(script);
    this.#script = script;
    this.#queue = [...(script.outcomes ?? [])];
    this.#ruleQueues = (script.rules ?? []).map((rule) => [...(rule.outcomes ?? [])]);
  }

  get script(): LlmScript {
    return this.#script;
  }

  replace(script: LlmScript): void {
    assertLlmScript(script);
    this.#script = script;
    this.#queue = [...(script.outcomes ?? [])];
    this.#ruleQueues = (script.rules ?? []).map((rule) => [...(rule.outcomes ?? [])]);
  }

  enqueue(...outcomes: readonly LlmOutcome[]): void {
    assertLlmOutcomes(outcomes);
    this.#queue.push(...outcomes);
  }

  get pending(): number {
    return this.#queue.length + this.#ruleQueues.reduce((total, queue) => total + queue.length, 0);
  }

  next(view: LlmRequestView): LlmCall {
    const rules = this.#script.rules ?? [];
    const index = rules.findIndex((rule) => llmMatches(rule.match, view));
    const rule = index >= 0 ? rules[index] : undefined;
    const outcome =
      (index >= 0 ? this.#ruleQueues[index]?.shift() : undefined) ?? this.#queue.shift();
    return {
      fault: outcome?.fault ?? rule?.fault ?? this.#script.fault,
      status: outcome?.status,
      delayMs: outcome?.delayMs,
      response: outcome?.response ?? rule?.response ?? this.#script.response,
    };
  }
}
