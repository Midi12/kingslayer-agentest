/**
 * Deterministic token estimates of the fakes: a quarter of the UTF-8 bytes, rounded up,
 * of the canonical JSON of a value (or of a text). Real tokenisers differ; the fakes only
 * need a stable, monotone count.
 */
import { canonicalize, utf8 } from '@argus/contracts';

export function estimateTokens(value: unknown): number {
  return Math.ceil(utf8(canonicalize(value)).length / 4);
}

export function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(utf8(text).length / 4));
}
