/**
 * Scripted behaviour of the fake Jev server (ADR M03-jev-modes): answers by question key,
 * optionally per request matcher, and queues of per-call outcomes (errors, delays, a hang,
 * answers for one call). Everything here is plain data except `where`, so a script can
 * come from a JSON file.
 */
import { canonicalize } from '@argus/contracts';
import {
  choiceAnswer,
  distributionWithConfidence,
  noulAnswer,
  scoreAnswer,
  uniformAnswer,
} from './answers.js';
import type { JevAnswer, JevQuestion, JevRequest, JsonValue } from './types.js';

/**
 * A scripted answer: a label (Choice), a boolean or probability (Noul), a level (Score),
 * or an object giving the choice and its confidence, or the full probabilities.
 */
export type ScriptedAnswer =
  | string
  | number
  | boolean
  | {
      readonly choice?: string;
      readonly confidence?: number;
      readonly probabilities?: Readonly<Record<string, number>>;
      readonly noul?: number;
      readonly score?: number;
    };

/** Scripted answers by question key; a key may contain `*` wildcards (`expect_*`). */
export type ScriptedAnswers = Readonly<Record<string, ScriptedAnswer>>;

/** What one call does besides answering. */
export interface JevOutcome {
  /** Respond with this error status (401, 422, 429, 500, 529…) instead of answering. */
  readonly status?: number;
  /** For an error: Retry-After (seconds, rounded up) and retry-after-ms headers. */
  readonly retryAfterMs?: number;
  /** For an error: the body; defaults to `{ detail }` with the status text. */
  readonly body?: JsonValue;
  /** Wait this long before responding (or before the error). */
  readonly delayMs?: number;
  /** Never respond: the client times out or aborts. */
  readonly hang?: boolean;
  /** Answers for this call only, over the script's answers. */
  readonly answers?: ScriptedAnswers;
}

export interface JevMatcher {
  /** Every one of these question keys is asked. */
  readonly questions?: readonly string[];
  /** The canonical JSON of the state contains this text. */
  readonly stateIncludes?: string;
  readonly model?: string;
  readonly where?: (request: JevRequest) => boolean;
}

export interface JevRule {
  readonly match: JevMatcher;
  readonly answers?: ScriptedAnswers;
  /** Consumed one per matching call, before the global queue. */
  readonly outcomes?: readonly JevOutcome[];
}

export interface JevScript {
  readonly answers?: ScriptedAnswers;
  readonly rules?: readonly JevRule[];
  /** Consumed one per call to `POST /v1/systemone`. */
  readonly outcomes?: readonly JevOutcome[];
  /** A question without a scripted answer: an error (default) or a uniform answer. */
  readonly fallback?: 'error' | 'uniform';
}

export function matches(matcher: JevMatcher, request: JevRequest): boolean {
  if (matcher.questions?.some((key) => !(key in request.questions)) === true) {
    return false;
  }
  if (matcher.model !== undefined && matcher.model !== request.model) {
    return false;
  }
  if (
    matcher.stateIncludes !== undefined &&
    !canonicalize(request.state).includes(matcher.stateIncludes)
  ) {
    return false;
  }
  return matcher.where === undefined || matcher.where(request);
}

function wildcard(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** The scripted answer for `key`: an exact key first, then the wildcard with the longest literal part. */
export function lookupAnswer(answers: ScriptedAnswers, key: string): ScriptedAnswer | undefined {
  if (Object.hasOwn(answers, key)) {
    return answers[key];
  }
  const patterns = Object.keys(answers)
    .filter((pattern) => pattern.includes('*') && wildcard(pattern).test(key))
    .sort((a, b) => b.replace(/\*/g, '').length - a.replace(/\*/g, '').length);
  const best = patterns[0];
  return best === undefined ? undefined : answers[best];
}

export type AnswerBuild =
  | { readonly ok: true; readonly answer: JevAnswer }
  | { readonly ok: false; readonly message: string };

function fail(message: string): AnswerBuild {
  return { ok: false, message };
}

function probabilityProblem(value: number): boolean {
  return !Number.isFinite(value) || value < 0 || value > 1;
}

function weightsFor(
  labels: readonly string[],
  probabilities: Readonly<Record<string, number>>,
  key: string,
): number[] | string {
  for (const [label, value] of Object.entries(probabilities)) {
    if (!labels.includes(label)) {
      return `scripted probability for '${label}' is not an option of question '${key}'`;
    }
    if (!Number.isFinite(value) || value < 0) {
      return `scripted probability for '${label}' of question '${key}' is not a non-negative number`;
    }
  }
  return labels.map((label) => probabilities[label] ?? 0);
}

function choiceFromScript(
  question: Extract<JevQuestion, { type: 'choice' }>,
  key: string,
  spec: ScriptedAnswer,
): AnswerBuild {
  const labels = Object.keys(question.criteria);
  const object = typeof spec === 'object' ? spec : undefined;
  if (object?.probabilities !== undefined) {
    const weights = weightsFor(labels, object.probabilities, key);
    return typeof weights === 'string'
      ? fail(weights)
      : { ok: true, answer: choiceAnswer(labels, weights) };
  }
  const label = typeof spec === 'string' ? spec : object?.choice;
  if (label === undefined) {
    return fail(
      `question '${key}' is a Choice; script a label, { choice, confidence } or { probabilities }`,
    );
  }
  const index = labels.indexOf(label);
  if (index < 0) {
    return fail(`scripted choice '${label}' is not an option of question '${key}'`);
  }
  const confidence = object?.confidence ?? 1;
  if (probabilityProblem(confidence)) {
    return fail(`scripted confidence of question '${key}' must lie in [0, 1]`);
  }
  return {
    ok: true,
    answer: choiceAnswer(labels, distributionWithConfidence(labels.length, index, confidence)),
  };
}

function noulFromScript(key: string, spec: ScriptedAnswer): AnswerBuild {
  const value =
    typeof spec === 'boolean'
      ? spec
        ? 1
        : 0
      : typeof spec === 'number'
        ? spec
        : typeof spec === 'object'
          ? spec.noul
          : undefined;
  if (value === undefined || probabilityProblem(value)) {
    return fail(`question '${key}' is a Noul; script a boolean or a probability in [0, 1]`);
  }
  return { ok: true, answer: noulAnswer(value) };
}

function scoreFromScript(
  question: Extract<JevQuestion, { type: 'score' }>,
  key: string,
  spec: ScriptedAnswer,
): AnswerBuild {
  const levels = question.criteria.map((_, index) => String(index));
  const object = typeof spec === 'object' ? spec : undefined;
  if (object?.probabilities !== undefined) {
    const weights = weightsFor(levels, object.probabilities, key);
    return typeof weights === 'string'
      ? fail(weights)
      : { ok: true, answer: scoreAnswer(question.criteria, weights) };
  }
  const level = typeof spec === 'number' ? spec : object?.score;
  if (level === undefined || !Number.isInteger(level) || level < 0 || level >= levels.length) {
    return fail(
      `question '${key}' is a Score with levels 0 to ${levels.length - 1}; script a level or { probabilities }`,
    );
  }
  const confidence = object?.confidence ?? 1;
  if (probabilityProblem(confidence)) {
    return fail(`scripted confidence of question '${key}' must lie in [0, 1]`);
  }
  return {
    ok: true,
    answer: scoreAnswer(
      question.criteria,
      distributionWithConfidence(levels.length, level, confidence),
    ),
  };
}

/** Builds the answer a script gives to one question. */
export function answerFromScript(
  question: JevQuestion,
  key: string,
  spec: ScriptedAnswer,
): AnswerBuild {
  switch (question.type) {
    case 'choice':
      return choiceFromScript(question, key, spec);
    case 'noul':
      return noulFromScript(key, spec);
    case 'score':
      return scoreFromScript(question, key, spec);
  }
}

/** One call as the script decides it: the outcome to apply and the answers in force. */
export interface ScriptedCall {
  readonly outcome: JevOutcome | undefined;
  readonly answers: ScriptedAnswers;
}

/** Throws when an outcome's status is not an error status (an integer from 400 to 599). */
export function assertJevOutcomes(outcomes: readonly JevOutcome[]): void {
  for (const outcome of outcomes) {
    const status = outcome.status;
    if (status !== undefined && !(Number.isInteger(status) && status >= 400 && status <= 599)) {
      throw new RangeError(
        `a queued outcome status is an error status from 400 to 599, got ${String(status)}`,
      );
    }
  }
}

function assertJevScript(script: JevScript): void {
  assertJevOutcomes(script.outcomes ?? []);
  for (const rule of script.rules ?? []) {
    assertJevOutcomes(rule.outcomes ?? []);
  }
}

/** Mutable queue state over a script; one instance per server. */
export class ScriptRunner {
  #script: JevScript;
  #globalQueue: JevOutcome[];
  #ruleQueues: JevOutcome[][];

  constructor(script: JevScript = {}) {
    assertJevScript(script);
    this.#script = script;
    this.#globalQueue = [...(script.outcomes ?? [])];
    this.#ruleQueues = (script.rules ?? []).map((rule) => [...(rule.outcomes ?? [])]);
  }

  get script(): JevScript {
    return this.#script;
  }

  /** Replaces the script and its queues. */
  replace(script: JevScript): void {
    assertJevScript(script);
    this.#script = script;
    this.#globalQueue = [...(script.outcomes ?? [])];
    this.#ruleQueues = (script.rules ?? []).map((rule) => [...(rule.outcomes ?? [])]);
  }

  /** Appends outcomes to the global queue. */
  enqueue(...outcomes: readonly JevOutcome[]): void {
    assertJevOutcomes(outcomes);
    this.#globalQueue.push(...outcomes);
  }

  /** Outcomes still queued (global queue plus rule queues). */
  get pending(): number {
    return (
      this.#globalQueue.length + this.#ruleQueues.reduce((total, queue) => total + queue.length, 0)
    );
  }

  /** Decides one call: the first matching rule's queue, then the global queue. */
  next(request: JevRequest): ScriptedCall {
    const rules = this.#script.rules ?? [];
    const index = rules.findIndex((rule) => matches(rule.match, request));
    const rule = index >= 0 ? rules[index] : undefined;
    const ruleQueue = index >= 0 ? this.#ruleQueues[index] : undefined;
    const outcome = ruleQueue?.shift() ?? this.#globalQueue.shift();
    return {
      outcome,
      answers: { ...this.#script.answers, ...rule?.answers, ...outcome?.answers },
    };
  }

  /** Scripted answers for every question of a request. */
  answer(
    request: JevRequest,
    answers: ScriptedAnswers,
  ): { ok: true; answers: Record<string, JevAnswer> } | { ok: false; message: string } {
    const result: Record<string, JevAnswer> = {};
    for (const [key, question] of Object.entries(request.questions)) {
      const spec = lookupAnswer(answers, key);
      if (spec === undefined) {
        if (this.#script.fallback === 'uniform') {
          result[key] = uniformAnswer(question);
          continue;
        }
        return { ok: false, message: `no scripted answer for question '${key}'` };
      }
      const built = answerFromScript(question, key, spec);
      if (!built.ok) {
        return built;
      }
      result[key] = built.answer;
    }
    return { ok: true, answers: result };
  }
}
