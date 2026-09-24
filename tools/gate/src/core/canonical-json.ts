/**
 * JSON Canonicalization Scheme, RFC 8785 (JCS).
 *
 * Object members are sorted by the UTF-16 code units of their names, numbers use the
 * ECMAScript shortest round-trip form, strings use JSON escaping, and no whitespace is
 * emitted. Values outside I-JSON (non-finite numbers, lone surrogates, non-plain objects)
 * are rejected. Object members whose value is `undefined` are omitted, as JSON.stringify
 * does, so the canonical form hashes exactly what is written to disk.
 */
import { createHash } from 'node:crypto';

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function serializeString(text: string, where: string): string {
  if (loneSurrogate.test(text)) {
    throw new CanonicalizationError(`lone surrogate in string at ${where}`);
  }
  return JSON.stringify(text);
}

function serializeNumber(value: number, where: string): string {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(`non-finite number at ${where}`);
  }
  return Object.is(value, -0) ? '0' : JSON.stringify(value);
}

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serialize(value: unknown, where: string): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      return serializeNumber(value, where);
    case 'string':
      return serializeString(value, where);
    case 'object':
      return serializeObject(value, where);
    default:
      throw new CanonicalizationError(`unsupported ${typeof value} at ${where}`);
  }
}

function serializeObject(value: object, where: string): string {
  if (Array.isArray(value)) {
    const items = (value as unknown[]).map((item, index) => serialize(item, `${where}[${index}]`));
    return `[${items.join(',')}]`;
  }
  if (!isPlainObject(value)) {
    throw new CanonicalizationError(`unsupported object at ${where}`);
  }
  const record = value as Record<string, unknown>;
  const members: string[] = [];
  for (const key of Object.keys(record).sort()) {
    const member = record[key];
    if (member === undefined) {
      continue;
    }
    members.push(`${serializeString(key, where)}:${serialize(member, `${where}.${key}`)}`);
  }
  return `{${members.join(',')}}`;
}

/** The RFC 8785 canonical JSON text of `value`. */
export function canonicalize(value: unknown): string {
  return serialize(value, '$');
}

/** `sha256:` followed by the hex SHA-256 of the canonical JSON of `value`. */
export function canonicalHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalize(value), 'utf8').digest('hex')}`;
}
