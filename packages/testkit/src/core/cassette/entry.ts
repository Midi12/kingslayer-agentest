/**
 * Cassette entries and their key (ADR M03-cassettes). The key is the `contentHash` of the
 * canonical request `{ method, path, body }`: the method in upper case, the path with its
 * query and without the origin, and the body parsed as JSON when it is JSON (so key order
 * and whitespace do not matter), else its text, else its bytes in base64.
 */
import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { contentHash } from '@argus/contracts';

/** A body as stored: parsed JSON, text, or base64 bytes; null when empty. */
export const CassetteBody = Type.Union([
  Type.Object({ json: Type.Unknown() }, { additionalProperties: false }),
  Type.Object({ text: Type.String() }, { additionalProperties: false }),
  Type.Object({ base64: Type.String() }, { additionalProperties: false }),
  Type.Null(),
]);
export type CassetteBody = Static<typeof CassetteBody>;

export const CassetteEntry = Type.Object(
  {
    version: Type.Literal(1),
    key: Type.String({ pattern: '^sha256:[0-9a-f]{64}$' }),
    recordedAt: Type.String(),
    request: Type.Object(
      {
        method: Type.String(),
        path: Type.String(),
        headers: Type.Record(Type.String(), Type.String()),
        body: CassetteBody,
      },
      { additionalProperties: false },
    ),
    response: Type.Object(
      {
        status: Type.Integer({ minimum: 100, maximum: 599 }),
        headers: Type.Record(Type.String(), Type.String()),
        body: CassetteBody,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
export type CassetteEntry = Static<typeof CassetteEntry>;

export function isCassetteEntry(value: unknown): value is CassetteEntry {
  return Value.Check(CassetteEntry, value);
}

const decoder = new TextDecoder('utf-8', { fatal: true });

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Classifies raw bytes as JSON, text or binary. */
export function encodeBody(bytes: Uint8Array | undefined): CassetteBody {
  if (bytes === undefined || bytes.length === 0) {
    return null;
  }
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    return { base64: toBase64(bytes) };
  }
  try {
    return { json: JSON.parse(text) as unknown };
  } catch {
    return { text };
  }
}

/** The bytes a stored body replays as (JSON is re-serialised compactly). */
export function decodeBody(body: CassetteBody): Uint8Array | undefined {
  if (body === null) {
    return undefined;
  }
  if ('json' in body) {
    return new TextEncoder().encode(JSON.stringify(body.json));
  }
  if ('text' in body) {
    return new TextEncoder().encode(body.text);
  }
  return fromBase64(body.base64);
}

export interface CanonicalRequest {
  readonly method: string;
  /** Path and query, without the origin. */
  readonly path: string;
  readonly body: CassetteBody;
}

/** The cassette key of a request. */
export function cassetteKey(request: CanonicalRequest): string {
  return contentHash({
    method: request.method.toUpperCase(),
    path: request.path,
    body: request.body,
  });
}

/** The file name of an entry: the hex digest of its key. */
export function cassetteFileName(key: string): string {
  return `${key.replace(/^sha256:/, '')}.json`;
}

/** A directory-safe suite name: lower-case letters, digits and single dashes. */
export function suiteSlug(suite: string): string {
  const slug = suite
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug === '') {
    throw new Error(`suite name '${suite}' has no letters or digits`);
  }
  return slug;
}
