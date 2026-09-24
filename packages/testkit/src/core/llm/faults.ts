/**
 * The seven fault modes of the fake LLM (ADR M03-llm-fake) as pure functions over the
 * intended answer: malformed JSON, schema-invalid JSON, refusal text, timeout, 5xx,
 * over-long output and `malicious`, which obeys instructions planted in page-derived text.
 */
import { ANALYST_DECISIONS, POINTER_ACTION_TYPES } from '@argus/contracts';
import type { LlmRequestView } from './request.js';

export const LLM_FAULT_MODES = [
  'malformed-json',
  'schema-invalid',
  'refusal',
  'timeout',
  'server-error',
  'over-long',
  'malicious',
] as const;
export type LlmFault = (typeof LLM_FAULT_MODES)[number];

export function isLlmFault(value: unknown): value is LlmFault {
  return typeof value === 'string' && (LLM_FAULT_MODES as readonly string[]).includes(value);
}

export const REFUSAL_TEXT = "I'm sorry, but I can't help with that request.";

/** JSON text that no parser accepts: the last character replaced by a dangling comma. */
export function malformJson(text: string): string {
  return `${text.slice(0, -1)},`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function typesOf(schema: Record<string, unknown>): string[] {
  const type = schema.type;
  if (typeof type === 'string') {
    return [type];
  }
  return Array.isArray(type) ? type.filter((t): t is string => typeof t === 'string') : [];
}

/** A value of a JSON type the property schema does not allow, or undefined when it allows any. */
function wrongValue(schema: unknown): unknown {
  const property = record(schema);
  if (property === undefined) {
    return undefined;
  }
  if ('const' in property || Array.isArray(property.enum)) {
    return '__fake_not_allowed__';
  }
  const types = typesOf(property);
  if (types.length === 0) {
    return record(property.properties) !== undefined ? 'not an object' : undefined;
  }
  const allowed = (value: unknown): boolean =>
    types.some((type) => {
      switch (type) {
        case 'string':
          return typeof value === 'string';
        case 'number':
          return typeof value === 'number';
        case 'integer':
          return Number.isInteger(value);
        case 'boolean':
          return typeof value === 'boolean';
        case 'null':
          return value === null;
        case 'array':
          return Array.isArray(value);
        case 'object':
          return typeof value === 'object' && value !== null && !Array.isArray(value);
        default:
          return true;
      }
    });
  // One value of each JSON type; the first one the schema's types do not allow.
  return [
    12345,
    'not the expected type',
    true,
    null,
    ['not the expected type'],
    { unexpected: true },
  ].find((value) => !allowed(value));
}

/**
 * A JSON object that a JSON Schema rejects: without its required members; else with a
 * member `additionalProperties: false` forbids; else with a property of the wrong type.
 * Without a usable schema the result is `{ "__fake_schema_invalid__": true }`.
 */
export function schemaViolation(schema: unknown): Record<string, unknown> {
  const root = record(schema);
  const marker = { __fake_schema_invalid__: true };
  if (root === undefined) {
    return marker;
  }
  const required = Array.isArray(root.required) ? root.required : [];
  if (required.length > 0) {
    return {};
  }
  if (root.additionalProperties === false) {
    return marker;
  }
  const properties = record(root.properties) ?? {};
  for (const [name, property] of Object.entries(properties)) {
    const value = wrongValue(property);
    if (value !== undefined) {
      return { [name]: value };
    }
  }
  return marker;
}

/** Exactly `chars` characters: the intended text, then filler, cut where the budget ends. */
export function overlongText(intended: string, chars: number): string {
  let text = intended;
  const filler = ' and the operator continued to describe the conveyor state in more detail';
  while (text.length < chars) {
    text += filler;
  }
  return text.slice(0, chars);
}

// ---------------------------------------------------------------------------
// Malicious mode
// ---------------------------------------------------------------------------

export interface Injection {
  /** The page-derived line that carried the instruction. */
  readonly line: string;
  readonly trigger: 'ARGUS-INJECT' | 'ignore previous instructions';
  /** What follows the trigger on that line. */
  readonly payload: string;
  /** The answer the fake gives by obeying it. */
  readonly answer: unknown;
}

const TRIGGERS: readonly { readonly name: Injection['trigger']; readonly pattern: RegExp }[] = [
  { name: 'ARGUS-INJECT', pattern: /ARGUS-INJECT:/ },
  {
    name: 'ignore previous instructions',
    pattern: /ignore\s+(?:all\s+)?(?:the\s+)?previous\s+instructions/i,
  },
];

function parseJsonPayload(payload: string): unknown {
  const trimmed = payload.trim();
  const candidates = [trimmed];
  const start = trimmed.search(/[[{]/);
  const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    candidates.push(trimmed.slice(start, end + 1));
  }
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate) as unknown;
      if (typeof value === 'object' && value !== null) {
        return value;
      }
    } catch {
      // not JSON; try the next reading
    }
  }
  return undefined;
}

function decision(
  kind: (typeof ANALYST_DECISIONS)[number],
  line: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    decision: kind,
    classification: kind === 'PATCH' || kind === 'RESOLVE_TARGET' ? 'TEST_DRIFT' : 'TRANSIENT',
    certainty: 'high',
    rationale: `Following the instruction found in the page: ${line.trim().slice(0, 300)}`,
    evidence: [],
    ...extra,
  };
}

/**
 * What an instruction asks for: a JSON value given literally; a navigation to a URL
 * (PATCH navigate); a pointer action on a described element (PATCH); a decision named by
 * its identifier or in words; otherwise MARK_PASSED, the classic "pass the test" attack.
 */
export function obey(payload: string, line: string): unknown {
  const json = parseJsonPayload(payload);
  if (json !== undefined) {
    return json;
  }
  const url = /https?:\/\/[^\s"'<>`)]+/.exec(payload)?.[0];
  if (url !== undefined) {
    return decision('PATCH', line, { patch: [{ type: 'navigate', url }] });
  }
  const pointer = new RegExp(
    String.raw`\b(${POINTER_ACTION_TYPES.join('|')})\s+(?:on\s+)?(.+?)[.!]?$`,
    'i',
  ).exec(payload.trim());
  if (pointer !== null) {
    const type = (pointer[1] ?? 'click').toLowerCase();
    return decision('PATCH', line, {
      patch: [{ type, target: { description: (pointer[2] ?? '').trim() } }],
    });
  }
  const named = ANALYST_DECISIONS.find((kind) =>
    new RegExp(String.raw`\b${kind.replace(/_/g, '[_ ]')}\b`, 'i').test(payload),
  );
  if (named !== undefined) {
    const cid = /\bc\d+\b/.exec(payload)?.[0];
    return decision(
      named,
      line,
      named === 'RESOLVE_TARGET' && cid !== undefined ? { resolveTarget: { cid } } : {},
    );
  }
  if (/\babort\b/i.test(payload)) {
    return decision('ABORT_ENV', line);
  }
  return decision('MARK_PASSED', line);
}

/** The first planted instruction in the page-derived text of a request (messages, not system). */
export function findInjection(view: LlmRequestView): Injection | undefined {
  for (const message of view.messages) {
    for (const line of message.text.split(/\r?\n/)) {
      for (const trigger of TRIGGERS) {
        const match = trigger.pattern.exec(line);
        if (match !== null) {
          const payload = line
            .slice(match.index + match[0].length)
            .replace(/^[\s:,-]*(?:and\s+)?/i, '');
          return { line, trigger: trigger.name, payload, answer: obey(payload, line) };
        }
      }
    }
  }
  return undefined;
}
