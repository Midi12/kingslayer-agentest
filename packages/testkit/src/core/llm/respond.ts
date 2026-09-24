/**
 * Response bodies of the fake LLM in both API shapes, from a scripted response or a fault
 * (ADR M03-llm-fake). Anthropic: `{ id, type: 'message', role, model, content, stop_reason,
 * stop_sequence, usage }`. OpenAI: `{ id, object: 'chat.completion', created, model,
 * choices: [{ index, message, logprobs, finish_reason }], usage }`.
 */
import { utf8 } from '@argus/contracts';
import { estimateTextTokens, estimateTokens } from '../tokens.js';
import {
  REFUSAL_TEXT,
  malformJson,
  overlongText,
  schemaViolation,
  type Injection,
  type LlmFault,
} from './faults.js';
import type { LlmRequestView } from './request.js';
import type { LlmLogprob, LlmScriptedResponse } from './script.js';

/** Default JSON the faults distort when the script gives no answer to start from. */
export const DEFAULT_INTENDED_JSON = { answer: 'fake' };

/** What the model "said", before it is put in a shape. */
export type LlmAnswer =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly stop: 'end' | 'max_tokens' | 'refusal';
      readonly logprobs?: readonly LlmLogprob[];
    }
  | { readonly kind: 'tool'; readonly name: string; readonly input: unknown }
  /** OpenAI only: tool arguments are a string and can be malformed. */
  | { readonly kind: 'tool-raw'; readonly name: string; readonly argumentsText: string };

export interface ReplyIds {
  readonly message: string;
  readonly tool: string;
}

export interface Reply {
  readonly body: Record<string, unknown>;
  readonly answer: LlmAnswer;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolFor(view: LlmRequestView, name?: string): string | undefined {
  if (view.tools.length === 0) {
    return undefined;
  }
  return view.tools.find((tool) => tool.name === name)?.name ?? view.tools[0]?.name;
}

/** A JSON answer: a tool call when tools are supplied and the value is an object, else JSON text. */
export function jsonAnswer(view: LlmRequestView, value: unknown, toolName?: string): LlmAnswer {
  const tool = toolFor(view, toolName);
  if (tool !== undefined && isObject(value)) {
    return { kind: 'tool', name: tool, input: value };
  }
  return { kind: 'text', text: JSON.stringify(value), stop: 'end' };
}

function argmaxLabel(probabilities: Readonly<Record<string, number>>): string {
  let best = '';
  let bestValue = -Infinity;
  for (const [label, value] of Object.entries(probabilities)) {
    if (value > bestValue) {
      best = label;
      bestValue = value;
    }
  }
  return best;
}

function logOf(probability: number): number {
  return probability > 0 ? Math.log(probability) : -9999;
}

/** The answer a scripted response gives, or undefined when the script gives none. */
export function scriptedAnswer(
  view: LlmRequestView,
  response: LlmScriptedResponse | undefined,
): LlmAnswer | undefined {
  if (response === undefined) {
    return undefined;
  }
  if (response.toolUse !== undefined) {
    return jsonAnswer(view, response.toolUse.input, response.toolUse.name);
  }
  if (response.json !== undefined) {
    return jsonAnswer(view, response.json);
  }
  if (response.choiceProbabilities !== undefined) {
    const probabilities = response.choiceProbabilities;
    const label = argmaxLabel(probabilities);
    const top = Object.fromEntries(
      Object.entries(probabilities).map(([key, value]) => [key, logOf(value)]),
    );
    return {
      kind: 'text',
      text: label,
      stop: 'end',
      logprobs: [{ token: label, logprob: logOf(probabilities[label] ?? 0), top }],
    };
  }
  if (response.text !== undefined) {
    return {
      kind: 'text',
      text: response.text,
      stop: 'end',
      ...(response.logprobs === undefined ? {} : { logprobs: response.logprobs }),
    };
  }
  return undefined;
}

function intendedText(answer: LlmAnswer | undefined): string {
  if (answer === undefined) {
    return JSON.stringify(DEFAULT_INTENDED_JSON);
  }
  switch (answer.kind) {
    case 'text':
      return answer.text;
    case 'tool':
      return JSON.stringify(answer.input);
    case 'tool-raw':
      return answer.argumentsText;
  }
}

function schemaFor(view: LlmRequestView, answer: LlmAnswer | undefined): unknown {
  if (answer !== undefined && answer.kind !== 'text') {
    return view.tools.find((tool) => tool.name === answer.name)?.inputSchema;
  }
  return view.tools[0]?.inputSchema ?? view.jsonSchema;
}

/**
 * The answer under a fault, for the faults that still produce a body (timeout and
 * server-error produce none). `malicious` without a planted instruction answers normally.
 */
export function faultAnswer(
  view: LlmRequestView,
  fault: Exclude<LlmFault, 'timeout' | 'server-error'>,
  intended: LlmAnswer | undefined,
  injection: Injection | undefined,
): LlmAnswer | undefined {
  switch (fault) {
    case 'malformed-json': {
      const text = malformJson(intendedText(intended));
      const tool = toolFor(view, intended?.kind === 'text' ? undefined : intended?.name);
      return view.shape === 'openai' && tool !== undefined
        ? { kind: 'tool-raw', name: tool, argumentsText: text }
        : { kind: 'text', text, stop: 'end' };
    }
    case 'schema-invalid':
      return jsonAnswer(
        view,
        schemaViolation(schemaFor(view, intended)),
        intended?.kind === 'text' ? undefined : intended?.name,
      );
    case 'refusal':
      return { kind: 'text', text: REFUSAL_TEXT, stop: 'refusal' };
    case 'over-long':
      return {
        kind: 'text',
        text: overlongText(intendedText(intended), view.maxTokens * 4),
        stop: 'max_tokens',
      };
    case 'malicious':
      return injection === undefined ? intended : jsonAnswer(view, injection.answer);
  }
}

function outputTokens(view: LlmRequestView, answer: LlmAnswer, override?: number): number {
  if (override !== undefined) {
    return override;
  }
  if (answer.kind === 'text' && answer.stop === 'max_tokens') {
    return view.maxTokens;
  }
  return estimateTextTokens(intendedText(answer));
}

function inputTokens(view: LlmRequestView, override?: number): number {
  if (override !== undefined) {
    return override;
  }
  const { messages, tools, system } = view.body;
  return estimateTokens({
    system: system ?? null,
    messages: messages ?? null,
    tools: tools ?? null,
  });
}

export interface ReplyOptions {
  readonly ids: ReplyIds;
  /** Seconds since the epoch, for the OpenAI `created` field. */
  readonly created: number;
  readonly usage?: LlmScriptedResponse['usage'];
  readonly stopReason?: string;
}

export function anthropicReply(
  view: LlmRequestView,
  answer: LlmAnswer,
  options: ReplyOptions,
): Record<string, unknown> {
  const content =
    answer.kind === 'text'
      ? [{ type: 'text', text: answer.text }]
      : [
          {
            type: 'tool_use',
            id: options.ids.tool,
            name: answer.name,
            input: answer.kind === 'tool' ? answer.input : {},
          },
        ];
  const stop =
    answer.kind === 'text'
      ? { end: 'end_turn', max_tokens: 'max_tokens', refusal: 'refusal' }[answer.stop]
      : 'tool_use';
  return {
    id: options.ids.message,
    type: 'message',
    role: 'assistant',
    model: view.model,
    content,
    stop_reason: options.stopReason ?? stop,
    stop_sequence: null,
    ...(answer.kind === 'text' && answer.stop === 'refusal'
      ? {
          stop_details: {
            type: 'refusal',
            category: null,
            explanation: 'The fake LLM refused on demand (fault mode refusal).',
          },
        }
      : {}),
    usage: {
      input_tokens: inputTokens(view, options.usage?.inputTokens),
      output_tokens: outputTokens(view, answer, options.usage?.outputTokens),
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

function tokenEntry(token: string, logprob: number): Record<string, unknown> {
  return { token, logprob, bytes: Array.from(utf8(token)) };
}

function openAiLogprobs(view: LlmRequestView, answer: LlmAnswer): Record<string, unknown> | null {
  if (!view.logprobs || answer.kind !== 'text') {
    return null;
  }
  const entries: readonly LlmLogprob[] =
    answer.logprobs ??
    (answer.text.match(/\S+\s*|\s+/g) ?? []).map((token) => ({ token, logprob: 0 }));
  return {
    content: entries.map((entry) => {
      const alternatives = Object.entries(entry.top ?? { [entry.token]: entry.logprob })
        .sort((a, b) => b[1] - a[1])
        .slice(0, view.topLogprobs)
        .map(([token, logprob]) => tokenEntry(token, logprob));
      return { ...tokenEntry(entry.token, entry.logprob), top_logprobs: alternatives };
    }),
    refusal: null,
  };
}

export function openAiReply(
  view: LlmRequestView,
  answer: LlmAnswer,
  options: ReplyOptions,
): Record<string, unknown> {
  const refusal = answer.kind === 'text' && answer.stop === 'refusal';
  const refusalField = refusal && view.jsonMode === 'schema';
  const message: Record<string, unknown> =
    answer.kind === 'text'
      ? {
          role: 'assistant',
          content: refusalField ? null : answer.text,
          refusal: refusalField ? answer.text : null,
        }
      : {
          role: 'assistant',
          content: null,
          refusal: null,
          tool_calls: [
            {
              id: options.ids.tool,
              type: 'function',
              function: {
                name: answer.name,
                arguments:
                  answer.kind === 'tool' ? JSON.stringify(answer.input) : answer.argumentsText,
              },
            },
          ],
        };
  const finish =
    answer.kind === 'text' ? (answer.stop === 'max_tokens' ? 'length' : 'stop') : 'tool_calls';
  const prompt = inputTokens(view, options.usage?.inputTokens);
  const completion = outputTokens(view, answer, options.usage?.outputTokens);
  return {
    id: options.ids.message,
    object: 'chat.completion',
    created: options.created,
    model: view.model,
    choices: [
      {
        index: 0,
        message,
        logprobs: openAiLogprobs(view, answer),
        finish_reason: options.stopReason ?? finish,
      },
    ],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      total_tokens: prompt + completion,
    },
  };
}

/** Error bodies in each shape. */
export function llmErrorBody(
  shape: 'anthropic' | 'openai',
  status: number,
  message: string,
): Record<string, unknown> {
  if (shape === 'anthropic') {
    const type =
      status === 401
        ? 'authentication_error'
        : status === 403
          ? 'permission_error'
          : status === 404
            ? 'not_found_error'
            : status === 429
              ? 'rate_limit_error'
              : status === 529
                ? 'overloaded_error'
                : status >= 500
                  ? 'api_error'
                  : 'invalid_request_error';
    return { type: 'error', error: { type, message } };
  }
  const type =
    status === 401
      ? 'authentication_error'
      : status === 429
        ? 'rate_limit_exceeded'
        : status >= 500
          ? 'server_error'
          : 'invalid_request_error';
  return {
    error: { message, type, param: null, code: status === 401 ? 'invalid_api_key' : null },
  };
}
