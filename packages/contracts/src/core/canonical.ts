/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) and content hashes.
 *
 * - Object members are sorted by the UTF-16 code units of their names.
 * - Numbers use the ECMAScript Number-to-String conversion (what JSON.stringify does),
 *   so -0 becomes 0 and 1e21 stays in exponent form.
 * - Strings use the JSON escapes of RFC 8785 section 3.2.2.2: \b \t \n \f \r, other
 *   control characters as lowercase \u00xx, `"` and `\`; everything else is literal.
 * - Values outside the I-JSON data model are rejected with a CanonicalizationError:
 *   undefined (also as a member or array element), non-finite numbers, lone
 *   surrogates, bigint, functions, symbols and objects that are not plain.
 */
import { sha256Hex, utf8 } from './sha256.js';

export class CanonicalizationError extends Error {
  /** JSON Pointer to the offending value. */
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${message} at ${path === '' ? '(root)' : path}`);
    this.name = 'CanonicalizationError';
    this.path = path;
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function pointer(path: string, key: string | number): string {
  return `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;
}

function serializeString(text: string, path: string): string {
  if (LONE_SURROGATE.test(text)) {
    throw new CanonicalizationError('lone surrogate in string', path);
  }
  // JSON.stringify implements exactly the RFC 8785 escaping for well-formed strings.
  return JSON.stringify(text);
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(`non-finite number ${String(value)}`, path);
      }
      return JSON.stringify(value);
    case 'string':
      return serializeString(value, path);
    case 'undefined':
      throw new CanonicalizationError('undefined is not JSON', path);
    case 'object':
      break;
    default:
      throw new CanonicalizationError(`${typeof value} is not JSON`, path);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!(index in value)) {
        throw new CanonicalizationError('sparse array element', pointer(path, index));
      }
      parts.push(serialize(value[index], pointer(path, index)));
    }
    return `[${parts.join(',')}]`;
  }
  if (!isPlainObject(value)) {
    throw new CanonicalizationError('object is not a plain JSON object', path);
  }
  const record = value as Record<string, unknown>;
  const symbols = Object.getOwnPropertySymbols(record).filter((symbol) =>
    Object.prototype.propertyIsEnumerable.call(record, symbol),
  );
  if (symbols.length > 0) {
    throw new CanonicalizationError('symbol-keyed member', path);
  }
  // Default sort compares UTF-16 code units, as RFC 8785 section 3.2.3 requires.
  const keys = Object.keys(record).sort();
  const members = keys.map((key) => {
    const child = pointer(path, key);
    return `${serializeString(key, child)}:${serialize(record[key], child)}`;
  });
  return `{${members.join(',')}}`;
}

/** The RFC 8785 canonical JSON text of `value`. */
export function canonicalize(value: unknown): string {
  return serialize(value, '');
}

/** `sha256:<hex>` of the UTF-8 bytes of the canonical JSON of `value`. */
export function contentHash(value: unknown): string {
  return `sha256:${sha256Hex(utf8(canonicalize(value)))}`;
}

/** `sha256:<hex>` of raw bytes or text (artifacts, plain-language sources). */
export function hashBytes(data: Uint8Array | string): string {
  return `sha256:${sha256Hex(typeof data === 'string' ? utf8(data) : data)}`;
}
