/** HMAC-SHA256 (RFC 2104) over the pure SHA-256 of @argus/contracts, for the payments fake. */
import { sha256Hex, utf8 } from '@argus/contracts';

const BLOCK = 64;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function hmacSha256Hex(key: string | Uint8Array, message: string | Uint8Array): string {
  let keyBytes = typeof key === 'string' ? utf8(key) : key;
  if (keyBytes.length > BLOCK) {
    keyBytes = hexToBytes(sha256Hex(keyBytes));
  }
  const padded = new Uint8Array(BLOCK);
  padded.set(keyBytes);
  const inner = padded.map((byte) => byte ^ 0x36);
  const outer = padded.map((byte) => byte ^ 0x5c);
  const data = typeof message === 'string' ? utf8(message) : message;
  const innerHash = hexToBytes(sha256Hex(concat(inner, data)));
  return sha256Hex(concat(outer, innerHash));
}

/** Compares two strings in time independent of where they first differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
