/**
 * Wire types of the TypeSafe Jev API (`POST /v1/systemone`, `GET /v1/models`), as the
 * official SDK `@typesafe-ai/sdk@0.6.0` declares them. They describe a third-party API,
 * not an ARGUS contract, so they live with the fake rather than in @argus/contracts.
 */

/** A JSON value. */
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Text, a JSON object or array, or null: state, instructions and criteria. */
export type EntryType =
  string | { readonly [key: string]: JsonValue } | readonly JsonValue[] | null;

export interface NoulQuestion {
  readonly type: 'noul';
  readonly instructions?: EntryType;
  readonly criteria?: { readonly true?: EntryType; readonly false?: EntryType } | null;
}

export interface ChoiceQuestion {
  readonly type: 'choice';
  readonly instructions?: EntryType;
  readonly criteria: { readonly [label: string]: EntryType };
}

export interface ScoreQuestion {
  readonly type: 'score';
  readonly instructions?: EntryType;
  readonly criteria: readonly EntryType[];
}

export type JevQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion;

/** A validated request body with the model resolved. */
export interface JevRequest {
  readonly model: string;
  readonly state: EntryType;
  readonly questions: { readonly [key: string]: JevQuestion };
}

export interface NoulAnswer {
  readonly type: 'noul';
  readonly noul: number;
}

export interface ChoiceAnswer {
  readonly type: 'choice';
  readonly choice: string;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export interface ScoreAnswer {
  readonly type: 'score';
  readonly score: number;
  readonly confidence: number;
  readonly legend: Readonly<Record<string, EntryType>>;
  readonly probabilities: Readonly<Record<string, number>>;
}

export type JevAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export interface JevUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

/** The `SystemOneResult` body. */
export interface JevResult {
  readonly model: string;
  readonly answers: Readonly<Record<string, JevAnswer>>;
  readonly usage: JevUsage;
}

export interface JevModelCard {
  readonly name: string;
  readonly description: string;
  readonly release_date: string;
}

/** One entry of a 422 body, in the `{ detail: [{ loc, msg, type }] }` form the SDK parses. */
export interface JevValidationIssue {
  readonly loc: readonly (string | number)[];
  readonly msg: string;
  readonly type: string;
}
