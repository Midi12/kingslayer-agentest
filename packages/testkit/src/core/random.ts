/**
 * Seeded pseudo-random numbers for the fakes. The same seed always gives the same
 * sequence, on every platform, so an oracle answer or a noisy probability replays exactly.
 */
import { contentHash } from '@argus/contracts';

/** A generator of floats in [0, 1). */
export type Random = () => number;

/**
 * sfc32 (Chris Doty-Humphrey's small fast counter), seeded from the SHA-256 of the
 * canonical JSON of `seed`, so any JSON value (a seed number plus a request) is a seed.
 */
export function seededRandom(seed: unknown): Random {
  const hex = contentHash(seed).slice('sha256:'.length);
  const word = (index: number): number => Number.parseInt(hex.slice(index * 8, index * 8 + 8), 16);
  let a = word(0);
  let b = word(1);
  let c = word(2);
  let d = word(3) | 1;
  const next = (): number => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4_294_967_296;
  };
  // Discard the first outputs: sfc32 mixes its state during the first rounds.
  for (let i = 0; i < 12; i += 1) {
    next();
  }
  return next;
}
