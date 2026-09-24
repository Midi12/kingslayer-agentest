/**
 * Key hygiene for cassettes (ADR M03-cassettes). Recorded files never hold credential
 * headers, and every string (and object key) that matches a key pattern is replaced by
 * `[REDACTED]` before it is written. Inline images are replaced by a short description
 * first, so their base64 does not count as a token.
 */
import { hashBytes } from '@argus/contracts';

export const REDACTED = '[REDACTED]';

export interface KeyPattern {
  readonly name: string;
  readonly source: string;
  readonly flags: string;
}

/**
 * What counts as key material. Content digests written `sha256:<hex>` (the ARGUS form of
 * every hash) are not keys and are exempt from the hex rule.
 */
export const KEY_PATTERNS: readonly KeyPattern[] = [
  { name: 'prefixed-key', source: String.raw`\b(?:sk|tsk)-[A-Za-z0-9_-]{8,}`, flags: 'g' },
  {
    name: 'stripe-key',
    source: String.raw`\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{8,}`,
    flags: 'g',
  },
  { name: 'webhook-secret', source: String.raw`\bwhsec_[A-Za-z0-9+/=]{8,}`, flags: 'g' },
  {
    name: 'jwt',
    source: String.raw`\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}`,
    flags: 'g',
  },
  { name: 'bearer-token', source: String.raw`\bBearer\s+[A-Za-z0-9._~+/=-]{8,}`, flags: 'gi' },
  {
    name: 'long-hex',
    source: String.raw`(?<![A-Za-z0-9])(?<!sha256:)[0-9a-fA-F]{32,}(?![A-Za-z0-9])`,
    flags: 'g',
  },
  {
    name: 'long-base64',
    source: String.raw`(?<![A-Za-z0-9+/_-])(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*[a-z])(?=[A-Za-z0-9+/_-]*[0-9])[A-Za-z0-9+/_-]{40,}={0,2}`,
    flags: 'g',
  },
];

/** Headers that are dropped from recorded files whatever their value. */
export const CREDENTIAL_HEADERS: readonly string[] = [
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'x-goog-api-key',
  'cookie',
  'set-cookie',
];

export interface KeyMatch {
  readonly pattern: string;
  readonly match: string;
  readonly index: number;
}

/** Every key-pattern match in `text`. */
export function findKeyMaterial(text: string): KeyMatch[] {
  const found: KeyMatch[] = [];
  for (const pattern of KEY_PATTERNS) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
      found.push({ pattern: pattern.name, match: match[0], index: match.index });
    }
  }
  return found;
}

/** `text` with every key-pattern match replaced by `[REDACTED]`. */
export function redactText(text: string): string {
  let result = text;
  for (const pattern of KEY_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), REDACTED);
  }
  return result;
}

const DATA_URL = /^data:([^;,]*)(?:;[^,]*)?;base64,/;

function describeInline(mediaType: string, base64: string): string {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  return `[inline ${mediaType || 'data'}: ${bytes} bytes, base64 ${hashBytes(base64)}]`;
}

function inlineReplacement(text: string): string | undefined {
  const match = DATA_URL.exec(text);
  if (match === null) {
    return undefined;
  }
  return describeInline(match[1] ?? '', text.slice(match[0].length));
}

/**
 * A deep copy of a JSON value with inline images described and key material redacted:
 * data URLs, `{ type: 'base64', data }` image sources, then every string and key.
 */
export function redactJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactText(inlineReplacement(value) ?? value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJson(item));
  }
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const base64Source = source.type === 'base64' && typeof source.data === 'string';
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(source)) {
      if (base64Source && key === 'data' && typeof item === 'string') {
        const mediaType = typeof source.media_type === 'string' ? source.media_type : '';
        result[key] = describeInline(mediaType, item);
      } else {
        result[redactText(key)] = redactJson(item);
      }
    }
    return result;
  }
  return value;
}

/** Headers for a recorded file: lower-case names, credential headers dropped, values redacted. */
export function sanitizeHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!CREDENTIAL_HEADERS.includes(lower)) {
      result[lower] = redactText(value);
    }
  }
  return result;
}

/** A credential header value for logs and request records: scheme and last four characters. */
export function maskCredential(value: string): string {
  const space = value.indexOf(' ');
  const scheme = space > 0 ? value.slice(0, space + 1) : '';
  const secret = space > 0 ? value.slice(space + 1) : value;
  return `${scheme}***${secret.length > 8 ? secret.slice(-4) : ''}`;
}

/** Request headers for an in-memory record: credential values masked, the rest unchanged. */
export function maskHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    result[lower] = CREDENTIAL_HEADERS.includes(lower) ? maskCredential(value) : value;
  }
  return result;
}
