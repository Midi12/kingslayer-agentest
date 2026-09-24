/**
 * The two request shapes the fake LLM serves, reduced to one view: Anthropic Messages
 * (`POST /v1/messages`) and OpenAI-compatible chat completions (`POST /v1/chat/completions`).
 * The view keeps what matchers, faults and responses need; the raw body stays available.
 */

export type LlmShape = 'anthropic' | 'openai';

export interface LlmToolSpec {
  readonly name: string;
  readonly inputSchema: unknown;
}

export interface LlmMessageView {
  readonly role: string;
  /** Every text of the message (text blocks, tool results, tool inputs), joined by newlines. */
  readonly text: string;
  readonly images: number;
}

export interface LlmRequestView {
  readonly shape: LlmShape;
  readonly model: string;
  readonly system: string;
  readonly messages: readonly LlmMessageView[];
  readonly tools: readonly LlmToolSpec[];
  /** `schema` with `jsonSchema`, `object` for plain JSON mode, `none` otherwise. */
  readonly jsonMode: 'schema' | 'object' | 'none';
  readonly jsonSchema: unknown;
  readonly maxTokens: number;
  /** OpenAI shape: log-probabilities requested, and how many alternatives per token. */
  readonly logprobs: boolean;
  readonly topLogprobs: number;
  readonly body: Readonly<Record<string, unknown>>;
}

export type LlmParse =
  | { readonly ok: true; readonly view: LlmRequestView }
  | { readonly ok: false; readonly message: string };

/** max_tokens of an OpenAI request that names none. */
export const OPENAI_DEFAULT_MAX_TOKENS = 4096;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function blockTexts(content: unknown): { texts: string[]; images: number } {
  if (typeof content === 'string') {
    return { texts: [content], images: 0 };
  }
  const texts: string[] = [];
  let images = 0;
  if (!Array.isArray(content)) {
    return { texts, images };
  }
  for (const item of content as unknown[]) {
    const block = record(item);
    switch (block?.type) {
      case 'text':
        if (typeof block.text === 'string') {
          texts.push(block.text);
        }
        break;
      case 'image':
      case 'image_url':
        images += 1;
        break;
      case 'tool_result': {
        const inner = blockTexts(block.content);
        texts.push(...inner.texts);
        images += inner.images;
        break;
      }
      case 'tool_use':
        texts.push(JSON.stringify(block.input ?? null));
        break;
      default:
        break;
    }
  }
  return { texts, images };
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function parseAnthropicRequest(body: unknown): LlmParse {
  const request = record(body);
  if (request === undefined) {
    return { ok: false, message: 'request body must be a JSON object' };
  }
  if (typeof request.model !== 'string' || request.model === '') {
    return { ok: false, message: 'model: Field required' };
  }
  if (!positiveInteger(request.max_tokens)) {
    return { ok: false, message: 'max_tokens: Field required, a positive integer' };
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    return { ok: false, message: 'messages: at least one message is required' };
  }
  if (request.stream === true) {
    return { ok: false, message: 'stream: the fake LLM answers non-streaming requests only' };
  }
  const messages: LlmMessageView[] = [];
  for (const [index, item] of (request.messages as unknown[]).entries()) {
    const message = record(item);
    if (message?.role !== 'user' && message?.role !== 'assistant') {
      return { ok: false, message: `messages.${index}.role: must be user or assistant` };
    }
    const content = blockTexts(message.content);
    messages.push({ role: message.role, text: content.texts.join('\n'), images: content.images });
  }
  const tools = Array.isArray(request.tools)
    ? (request.tools as unknown[]).flatMap((item) => {
        const tool = record(item);
        return typeof tool?.name === 'string'
          ? [{ name: tool.name, inputSchema: tool.input_schema }]
          : [];
      })
    : [];
  const format = record(record(request.output_config)?.format) ?? record(request.output_format);
  const jsonSchema = format?.type === 'json_schema' ? format.schema : undefined;
  return {
    ok: true,
    view: {
      shape: 'anthropic',
      model: request.model,
      system: blockTexts(request.system).texts.join('\n'),
      messages,
      tools,
      jsonMode: jsonSchema === undefined ? 'none' : 'schema',
      jsonSchema,
      maxTokens: request.max_tokens,
      logprobs: false,
      topLogprobs: 0,
      body: request,
    },
  };
}

export function parseOpenAiRequest(body: unknown): LlmParse {
  const request = record(body);
  if (request === undefined) {
    return { ok: false, message: 'request body must be a JSON object' };
  }
  if (typeof request.model !== 'string' || request.model === '') {
    return { ok: false, message: 'you must provide a model parameter' };
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    return { ok: false, message: "'messages' must contain at least one message" };
  }
  if (request.stream === true) {
    return { ok: false, message: 'stream: the fake LLM answers non-streaming requests only' };
  }
  const system: string[] = [];
  const messages: LlmMessageView[] = [];
  for (const [index, item] of (request.messages as unknown[]).entries()) {
    const message = record(item);
    const role = message?.role;
    if (
      typeof role !== 'string' ||
      !['system', 'developer', 'user', 'assistant', 'tool'].includes(role)
    ) {
      return { ok: false, message: `messages[${index}].role is invalid` };
    }
    const content = blockTexts(message?.content);
    if (role === 'system' || role === 'developer') {
      system.push(...content.texts);
    } else {
      messages.push({ role, text: content.texts.join('\n'), images: content.images });
    }
  }
  const tools = Array.isArray(request.tools)
    ? (request.tools as unknown[]).flatMap((item) => {
        const fn = record(record(item)?.function);
        return typeof fn?.name === 'string' ? [{ name: fn.name, inputSchema: fn.parameters }] : [];
      })
    : [];
  const format = record(request.response_format);
  const jsonSchema =
    format?.type === 'json_schema' ? record(format.json_schema)?.schema : undefined;
  const jsonMode =
    format?.type === 'json_schema' ? 'schema' : format?.type === 'json_object' ? 'object' : 'none';
  const maxTokens = positiveInteger(request.max_completion_tokens)
    ? request.max_completion_tokens
    : positiveInteger(request.max_tokens)
      ? request.max_tokens
      : OPENAI_DEFAULT_MAX_TOKENS;
  const top = request.top_logprobs;
  return {
    ok: true,
    view: {
      shape: 'openai',
      model: request.model,
      system: system.join('\n'),
      messages,
      tools,
      jsonMode,
      jsonSchema,
      maxTokens,
      logprobs: request.logprobs === true,
      topLogprobs:
        typeof top === 'number' && Number.isInteger(top) ? Math.min(Math.max(top, 0), 20) : 0,
      body: request,
    },
  };
}

/** All message text (not the system text), the page-derived part of a request. */
export function messageText(view: LlmRequestView): string {
  return view.messages.map((message) => message.text).join('\n');
}
