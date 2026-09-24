/**
 * Oracle mode of the fake Jev server (ADR M03-jev-modes). A truth function reads the
 * parsed request and returns the correct answer per question; the fake mixes it with
 * seeded noise: p = (1 − a)·truth + a·noise, where a is the noise amplitude in [0, 1] and
 * the noise vector is drawn from a generator seeded by (seed, request, question key).
 * Amplitude 0 gives the truth with probability 1; the same seed and request always give
 * the same answer.
 */
import { choiceAnswer, noulAnswer, scoreAnswer, uniformAnswer } from './answers.js';
import type { JevAnswer, JevQuestion, JevRequest, JsonValue } from './types.js';
import { seededRandom } from '../random.js';

/**
 * The truth for one question: a label or a set of equally correct labels (Choice), a
 * boolean or a probability (Noul), a level (Score); null or undefined when unknown, which
 * gives the uniform answer (0.5 for a Noul).
 */
export type OracleTruth = string | readonly string[] | boolean | number | null | undefined;

export type OracleTruthFunction = (request: JevRequest) => Readonly<Record<string, OracleTruth>>;

export interface OracleOptions {
  readonly truth: OracleTruthFunction;
  /** Noise amplitude in [0, 1]; 0 by default. */
  readonly noise?: number;
  readonly seed?: number | string;
}

export type OracleAnswers =
  | { readonly ok: true; readonly answers: Record<string, JevAnswer> }
  | { readonly ok: false; readonly message: string };

function mix(base: readonly number[], noise: readonly number[], amplitude: number): number[] {
  const sum = noise.reduce((total, value) => total + value, 0);
  return base.map((value, index) => {
    const share = sum > 0 ? (noise[index] ?? 0) / sum : 1 / base.length;
    return (1 - amplitude) * value + amplitude * share;
  });
}

function oneHotOver(labels: readonly string[], truth: readonly string[]): number[] {
  return labels.map((label) => (truth.includes(label) ? 1 / truth.length : 0));
}

function answerFor(
  key: string,
  question: JevQuestion,
  truth: OracleTruth,
  amplitude: number,
  draw: () => number,
): JevAnswer | string {
  switch (question.type) {
    case 'choice': {
      const labels = Object.keys(question.criteria);
      if (truth === null || truth === undefined) {
        return uniformAnswer(question);
      }
      if (typeof truth !== 'string' && !Array.isArray(truth)) {
        return `oracle truth of Choice question '${key}' must be a label or a list of labels`;
      }
      const correct: readonly string[] = typeof truth === 'string' ? [truth] : truth;
      const unknown = correct.find((label) => !labels.includes(label));
      if (unknown !== undefined || correct.length === 0) {
        return `oracle truth '${String(unknown)}' is not an option of question '${key}'`;
      }
      const noise = labels.map(() => draw());
      return choiceAnswer(labels, mix(oneHotOver(labels, correct), noise, amplitude));
    }
    case 'noul': {
      if (truth === null || truth === undefined) {
        return noulAnswer(0.5);
      }
      const base = typeof truth === 'boolean' ? (truth ? 1 : 0) : truth;
      if (typeof base !== 'number' || !(base >= 0 && base <= 1)) {
        return `oracle truth of Noul question '${key}' must be a boolean or a probability`;
      }
      return noulAnswer((1 - amplitude) * base + amplitude * draw());
    }
    case 'score': {
      if (truth === null || truth === undefined) {
        return uniformAnswer(question);
      }
      const levels = question.criteria.length;
      if (typeof truth !== 'number' || !Number.isInteger(truth) || truth < 0 || truth >= levels) {
        return `oracle truth of Score question '${key}' must be a level from 0 to ${levels - 1}`;
      }
      const base = question.criteria.map((_, index) => (index === truth ? 1 : 0));
      const noise = question.criteria.map(() => draw());
      return scoreAnswer(question.criteria, mix(base, noise, amplitude));
    }
  }
}

/** Answers every question of a request from the truth function plus seeded noise. */
export function oracleAnswers(request: JevRequest, options: OracleOptions): OracleAnswers {
  const amplitude = options.noise ?? 0;
  if (!(amplitude >= 0 && amplitude <= 1)) {
    return { ok: false, message: `oracle noise must lie in [0, 1], got ${String(amplitude)}` };
  }
  const truths = options.truth(request);
  const answers: Record<string, JevAnswer> = {};
  for (const [key, question] of Object.entries(request.questions)) {
    const draw = seededRandom({
      seed: options.seed ?? 0,
      key,
      request: request as unknown as JsonValue,
    });
    const answer = answerFor(key, question, truths[key], amplitude, draw);
    if (typeof answer === 'string') {
      return { ok: false, message: answer };
    }
    answers[key] = answer;
  }
  return { ok: true, answers };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export interface TargetOracleOptions {
  /** The target description of a request; default `state.step.target` (text or `.description`). */
  readonly describe?: (request: JevRequest) => string | undefined;
  /** Noul question telling whether the target is among the candidates; default `target_present`. */
  readonly presentKey?: string;
  /** Prefix of the stage-two confirmation Nouls; default `confirm_`. */
  readonly confirmPrefix?: string;
  /**
   * The candidate a confirmation question is about; default `state.top[<suffix>]` (an id,
   * or an object with `cid` or `id`).
   */
  readonly confirmCandidate?: (request: JevRequest, key: string) => string | undefined;
  /** Truths for questions this oracle does not know (probes, expectations). */
  readonly fallback?: OracleTruthFunction;
}

function defaultDescription(request: JevRequest): string | undefined {
  const target = record(record(request.state)?.step)?.target;
  if (typeof target === 'string') {
    return target;
  }
  const description = record(target)?.description;
  return typeof description === 'string' ? description : undefined;
}

function candidateId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  const object = record(value);
  const id = object?.cid ?? object?.id;
  return typeof id === 'string' ? id : undefined;
}

function candidatesOf(request: JevRequest): readonly string[] {
  const candidates = record(record(request.state)?.candidates);
  if (candidates !== undefined) {
    return Object.keys(candidates);
  }
  const choice = Object.values(request.questions).find((q) => q.type === 'choice');
  return choice?.type === 'choice' ? Object.keys(choice.criteria) : [];
}

/**
 * A truth function from a map of target description to the correct candidate id (null
 * when the target is absent). Choice questions get the id when it is an option; the
 * presence Noul is true when the id is among the candidates; a confirmation Noul is true
 * when it asks about the correct candidate.
 */
export function oracleFromTargets(
  targets: Readonly<Record<string, string | null>>,
  options: TargetOracleOptions = {},
): OracleTruthFunction {
  const presentKey = options.presentKey ?? 'target_present';
  const confirmPrefix = options.confirmPrefix ?? 'confirm_';
  return (request) => {
    const base = options.fallback?.(request) ?? {};
    const description = (options.describe ?? defaultDescription)(request);
    if (description === undefined || !Object.hasOwn(targets, description)) {
      return base;
    }
    const correct = targets[description] ?? null;
    const truths: Record<string, OracleTruth> = { ...base };
    for (const [key, question] of Object.entries(request.questions)) {
      if (question.type === 'choice') {
        truths[key] =
          correct !== null && Object.hasOwn(question.criteria, correct) ? correct : undefined;
      } else if (question.type === 'noul' && key === presentKey) {
        truths[key] = correct !== null && candidatesOf(request).includes(correct);
      } else if (question.type === 'noul' && key.startsWith(confirmPrefix)) {
        const about =
          options.confirmCandidate?.(request, key) ??
          candidateId(record(record(request.state)?.top)?.[key.slice(confirmPrefix.length)]);
        truths[key] = about === undefined ? undefined : about === correct;
      }
    }
    return truths;
  };
}
