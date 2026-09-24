/**
 * Scripts read from JSON files (the fakes app, `/_fake/script`): TypeBox schemas for the
 * data part of Jev and LLM scripts. Function matchers (`where`) exist only in code.
 */
import { Type, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { err, ok, type Result } from '@argus/contracts';
import { LLM_FAULT_MODES } from './llm/faults.js';
import type { JevOutcome, JevScript } from './jev/script.js';
import type { LlmOutcome, LlmScript } from './llm/script.js';

const Probabilities = Type.Record(Type.String(), Type.Number({ minimum: 0 }));

const ScriptedAnswerSchema = Type.Union([
  Type.String(),
  Type.Number(),
  Type.Boolean(),
  Type.Object(
    {
      choice: Type.Optional(Type.String()),
      confidence: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      probabilities: Type.Optional(Probabilities),
      noul: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      score: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
  ),
]);

const Answers = Type.Record(Type.String(), ScriptedAnswerSchema);

const JevOutcomeSchema = Type.Object(
  {
    status: Type.Optional(Type.Integer({ minimum: 400, maximum: 599 })),
    retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
    body: Type.Optional(Type.Unknown()),
    delayMs: Type.Optional(Type.Integer({ minimum: 0 })),
    hang: Type.Optional(Type.Boolean()),
    answers: Type.Optional(Answers),
  },
  { additionalProperties: false },
);

export const JevScriptSchema = Type.Object(
  {
    answers: Type.Optional(Answers),
    rules: Type.Optional(
      Type.Array(
        Type.Object(
          {
            match: Type.Object(
              {
                questions: Type.Optional(Type.Array(Type.String())),
                stateIncludes: Type.Optional(Type.String()),
                model: Type.Optional(Type.String()),
              },
              { additionalProperties: false },
            ),
            answers: Type.Optional(Answers),
            outcomes: Type.Optional(Type.Array(JevOutcomeSchema)),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    outcomes: Type.Optional(Type.Array(JevOutcomeSchema)),
    fallback: Type.Optional(Type.Union([Type.Literal('error'), Type.Literal('uniform')])),
  },
  { additionalProperties: false },
);

const Fault = Type.Union(LLM_FAULT_MODES.map((mode) => Type.Literal(mode)));

const LlmResponseSchema = Type.Object(
  {
    text: Type.Optional(Type.String()),
    json: Type.Optional(Type.Unknown()),
    toolUse: Type.Optional(
      Type.Object(
        { name: Type.Optional(Type.String()), input: Type.Unknown() },
        { additionalProperties: false },
      ),
    ),
    stopReason: Type.Optional(Type.String()),
    usage: Type.Optional(
      Type.Object(
        {
          inputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
          outputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
        },
        { additionalProperties: false },
      ),
    ),
    logprobs: Type.Optional(
      Type.Array(
        Type.Object(
          {
            token: Type.String(),
            logprob: Type.Number({ maximum: 0 }),
            top: Type.Optional(Type.Record(Type.String(), Type.Number({ maximum: 0 }))),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    choiceProbabilities: Type.Optional(Probabilities),
  },
  { additionalProperties: false },
);

const LlmOutcomeSchema = Type.Object(
  {
    fault: Type.Optional(Fault),
    status: Type.Optional(Type.Integer({ minimum: 400, maximum: 599 })),
    delayMs: Type.Optional(Type.Integer({ minimum: 0 })),
    response: Type.Optional(LlmResponseSchema),
  },
  { additionalProperties: false },
);

export const LlmScriptSchema = Type.Object(
  {
    response: Type.Optional(LlmResponseSchema),
    rules: Type.Optional(
      Type.Array(
        Type.Object(
          {
            match: Type.Object(
              {
                shape: Type.Optional(
                  Type.Union([Type.Literal('anthropic'), Type.Literal('openai')]),
                ),
                model: Type.Optional(Type.String()),
                systemIncludes: Type.Optional(Type.String()),
                textIncludes: Type.Optional(Type.String()),
                tool: Type.Optional(Type.String()),
              },
              { additionalProperties: false },
            ),
            response: Type.Optional(LlmResponseSchema),
            fault: Type.Optional(Fault),
            outcomes: Type.Optional(Type.Array(LlmOutcomeSchema)),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    outcomes: Type.Optional(Type.Array(LlmOutcomeSchema)),
    fault: Type.Optional(Fault),
  },
  { additionalProperties: false },
);

function parseWith<T>(schema: TSchema, value: unknown, what: string): Result<T, string> {
  if (Value.Check(schema, value)) {
    return ok(value as T);
  }
  const first = Value.Errors(schema, value).First();
  return err(
    `${what}: ${first === undefined ? 'invalid' : `${first.path || '/'} ${first.message}`}`,
  );
}

export function parseJevScript(value: unknown): Result<JevScript, string> {
  return parseWith<JevScript>(JevScriptSchema, value, 'Jev script');
}

export function parseLlmScript(value: unknown): Result<LlmScript, string> {
  return parseWith<LlmScript>(LlmScriptSchema, value, 'LLM script');
}

/** A JSON list of per-call Jev outcomes (`POST /_fake/outcomes`). */
export function parseJevOutcomes(value: unknown): Result<JevOutcome[], string> {
  return parseWith<JevOutcome[]>(Type.Array(JevOutcomeSchema), value, 'Jev outcomes');
}

/** A JSON list of per-call LLM outcomes (`POST /_fake/outcomes`). */
export function parseLlmOutcomes(value: unknown): Result<LlmOutcome[], string> {
  return parseWith<LlmOutcome[]>(Type.Array(LlmOutcomeSchema), value, 'LLM outcomes');
}

/** A map of target description to correct candidate id (null when absent). */
export function parseTargetMap(value: unknown): Result<Record<string, string | null>, string> {
  return parseWith<Record<string, string | null>>(
    Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()])),
    value,
    'oracle targets',
  );
}
