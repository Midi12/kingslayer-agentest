/**
 * Request validation of the fake Jev server (ADR M03-jev-fake). The rules are the
 * documented limits (at most 255 Choice options, 2 to 10 Score levels, a known model,
 * 32k tokens for the state plus the longest question) and the SDK's own types.
 */
import { estimateTokens } from '../tokens.js';
import type { EntryType, JevQuestion, JevRequest, JevValidationIssue } from './types.js';

export const MAX_CHOICE_OPTIONS = 255;
export const MIN_SCORE_LEVELS = 2;
export const MAX_SCORE_LEVELS = 10;
/** Tokens allowed for the state plus the longest question. */
export const MAX_CONTEXT_TOKENS = 32_768;
/** Model used when a request names none (the SDK default). */
export const JEV_LATEST_ALIAS = 'jev-latest';

/** `usage.input_tokens` of a request: the estimate over its state and questions. */
export function estimateJevInputTokens(request: Pick<JevRequest, 'state' | 'questions'>): number {
  return estimateTokens({ state: request.state, questions: request.questions });
}

export type JevValidation =
  | { readonly ok: true; readonly request: JevRequest }
  | { readonly ok: false; readonly issues: readonly JevValidationIssue[] };

export interface JevValidationOptions {
  /** Model names the server serves. */
  readonly models: readonly string[];
  /** Aliases and the model each resolves to, e.g. `jev-latest`. */
  readonly aliases?: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEntry(value: unknown): value is EntryType {
  return value === null || typeof value === 'string' || typeof value === 'object';
}

type Loc = readonly (string | number)[];

class Issues {
  readonly list: JevValidationIssue[] = [];
  add(loc: Loc, msg: string, type: string): void {
    this.list.push({ loc: ['body', ...loc], msg, type });
  }
}

function checkEntry(issues: Issues, loc: Loc, value: unknown): void {
  if (!isEntry(value)) {
    issues.add(loc, 'Input should be a string, a JSON object, a JSON array or null', 'entry_type');
  }
}

function checkChoice(issues: Issues, loc: Loc, criteria: unknown): void {
  if (!isRecord(criteria)) {
    issues.add(
      [...loc, 'criteria'],
      'Choice criteria must be a map of labels to descriptions',
      'dict_type',
    );
    return;
  }
  const labels = Object.keys(criteria);
  if (labels.length === 0) {
    issues.add([...loc, 'criteria'], 'Choice criteria must name at least one option', 'too_short');
  }
  if (labels.length > MAX_CHOICE_OPTIONS) {
    issues.add(
      [...loc, 'criteria'],
      `Choice criteria may name at most ${MAX_CHOICE_OPTIONS} options, got ${labels.length}`,
      'too_long',
    );
  }
  for (const label of labels) {
    if (label.length === 0) {
      issues.add(
        [...loc, 'criteria', label],
        'Option labels must not be empty',
        'string_too_short',
      );
    }
    checkEntry(issues, [...loc, 'criteria', label], criteria[label]);
  }
}

function checkScore(issues: Issues, loc: Loc, criteria: unknown): void {
  if (!Array.isArray(criteria)) {
    issues.add(
      [...loc, 'criteria'],
      'Score criteria must be a list of descriptions indexed by score from zero',
      'list_type',
    );
    return;
  }
  if (criteria.length < MIN_SCORE_LEVELS || criteria.length > MAX_SCORE_LEVELS) {
    issues.add(
      [...loc, 'criteria'],
      `Score criteria must have ${MIN_SCORE_LEVELS} to ${MAX_SCORE_LEVELS} levels, got ${criteria.length}`,
      criteria.length < MIN_SCORE_LEVELS ? 'too_short' : 'too_long',
    );
  }
  criteria.forEach((entry: unknown, index) => {
    checkEntry(issues, [...loc, 'criteria', index], entry);
  });
}

function checkNoul(issues: Issues, loc: Loc, criteria: unknown): void {
  if (criteria === undefined || criteria === null) {
    return;
  }
  if (!isRecord(criteria)) {
    issues.add(
      [...loc, 'criteria'],
      'Noul criteria must be an object with true and false',
      'dict_type',
    );
    return;
  }
  for (const key of Object.keys(criteria)) {
    if (key !== 'true' && key !== 'false') {
      issues.add(
        [...loc, 'criteria', key],
        'Noul criteria accept only true and false',
        'extra_forbidden',
      );
    } else {
      checkEntry(issues, [...loc, 'criteria', key], criteria[key]);
    }
  }
}

function checkQuestion(issues: Issues, key: string, question: unknown): void {
  const loc = ['questions', key];
  if (key.length === 0) {
    issues.add(loc, 'Question names must not be empty', 'string_too_short');
  }
  if (!isRecord(question)) {
    issues.add(loc, 'Input should be a valid question object', 'dict_type');
    return;
  }
  if ('instructions' in question) {
    checkEntry(issues, [...loc, 'instructions'], question.instructions);
  }
  switch (question.type) {
    case 'choice':
      checkChoice(issues, loc, question.criteria);
      break;
    case 'score':
      checkScore(issues, loc, question.criteria);
      break;
    case 'noul':
      checkNoul(issues, loc, question.criteria);
      break;
    default:
      issues.add(
        [...loc, 'type'],
        `Input tag '${String(question.type)}' does not match any of the expected tags: 'noul', 'choice', 'score'`,
        'union_tag_invalid',
      );
  }
}

/** Validates a parsed `POST /v1/systemone` body; returns the request with its model resolved. */
export function validateJevRequest(body: unknown, options: JevValidationOptions): JevValidation {
  const issues = new Issues();
  if (!isRecord(body)) {
    issues.add([], 'Input should be a valid dictionary', 'dict_type');
    return { ok: false, issues: issues.list };
  }
  if (!('state' in body)) {
    issues.add(['state'], 'Field required', 'missing');
  } else {
    checkEntry(issues, ['state'], body.state);
  }
  const questions = body.questions;
  if (questions === undefined) {
    issues.add(['questions'], 'Field required', 'missing');
  } else if (!isRecord(questions)) {
    issues.add(['questions'], 'Input should be a valid dictionary', 'dict_type');
  } else if (Object.keys(questions).length === 0) {
    issues.add(['questions'], 'At least one question is required', 'too_short');
  } else {
    for (const [key, question] of Object.entries(questions)) {
      checkQuestion(issues, key, question);
    }
  }
  let model = JEV_LATEST_ALIAS;
  if ('model' in body && body.model !== undefined && body.model !== null) {
    if (typeof body.model !== 'string') {
      issues.add(['model'], 'Input should be a valid string', 'string_type');
    } else {
      model = body.model;
    }
  }
  const resolved = options.aliases?.[model] ?? model;
  if (!options.models.includes(resolved)) {
    issues.add(['model'], `Unknown model '${model}'; see GET /v1/models`, 'model_not_found');
  }
  if (issues.list.length > 0) {
    return { ok: false, issues: issues.list };
  }
  const request: JevRequest = {
    model: resolved,
    state: body.state as EntryType,
    questions: questions as Record<string, JevQuestion>,
  };
  const stateTokens = estimateTokens(request.state);
  const longest = Math.max(...Object.values(request.questions).map((q) => estimateTokens(q)));
  if (stateTokens + longest > MAX_CONTEXT_TOKENS) {
    issues.add(
      ['state'],
      `The state and the longest question take about ${stateTokens + longest} tokens; the limit is ${MAX_CONTEXT_TOKENS}`,
      'context_length_exceeded',
    );
    return { ok: false, issues: issues.list };
  }
  return { ok: true, request };
}
