/**
 * Token estimates used to enforce budgets before a call (ADR M07-budgets). The base text
 * estimate is a third of the UTF-8 bytes, which is roughly what earlier tokenisers give
 * for mixed prose and JSON; newer tokenisers give up to about 30% more, and hex digests
 * tokenise densely. Until M19-G5 calibrates the estimate against billed tokens, text is
 * counted with an explicit safety factor of 1.5 over that base (half a token per byte),
 * and every run of 16 or more hex digits at one token per 1.5 digits. Images count the
 * larger of the Anthropic (w·h/750) and OpenAI high-detail (85 + 170 per 512 px tile)
 * counts, which are published formulas and need no factor.
 */
import { utf8 } from '@argus/contracts';

/** Tokens one message adds beyond its content (role markers and separators). */
export const MESSAGE_OVERHEAD_TOKENS = 8;

/** Bytes per token of the base estimate. */
export const BASE_BYTES_PER_TOKEN = 3;
/** Safety factor over the base estimate, kept until M19-G5 calibrates it. */
export const TEXT_SAFETY_FACTOR = 1.5;
/** Hex digits per token inside long hex runs (sha256 digests, ids). */
export const HEX_CHARS_PER_TOKEN = 1.5;

const HEX_RUN = /[0-9a-fA-F]{16,}/g;

export function estimateTextTokens(text: string): number {
  let hexChars = 0;
  let hexTokens = 0;
  for (const match of text.matchAll(HEX_RUN)) {
    hexChars += match[0].length;
    hexTokens += Math.ceil(match[0].length / HEX_CHARS_PER_TOKEN);
  }
  const otherBytes = utf8(text).length - hexChars;
  return Math.ceil((otherBytes * TEXT_SAFETY_FACTOR) / BASE_BYTES_PER_TOKEN) + hexTokens;
}

export function estimateImageTokens(width: number, height: number): number {
  const anthropic = Math.ceil((width * height) / 750);
  // OpenAI high detail: fit within 2048 x 2048, then scale the short side to 768.
  let w = width;
  let h = height;
  const fit = Math.min(1, 2048 / Math.max(w, h));
  w *= fit;
  h *= fit;
  const shortSide = Math.min(w, h);
  if (shortSide > 768) {
    const scale = 768 / shortSide;
    w *= scale;
    h *= scale;
  }
  const tiles = Math.ceil(w / 512) * Math.ceil(h / 512);
  const openai = 85 + 170 * tiles;
  return Math.max(anthropic, openai);
}

/** A request's content as the estimator sees it. */
export interface EstimatedContent {
  readonly system: string;
  readonly messages: readonly {
    readonly texts: readonly string[];
    readonly images: readonly { readonly width: number; readonly height: number }[];
  }[];
  readonly schema?: unknown;
}

export function estimateRequestTokens(content: EstimatedContent): number {
  let total = estimateTextTokens(content.system) + MESSAGE_OVERHEAD_TOKENS;
  for (const message of content.messages) {
    total += MESSAGE_OVERHEAD_TOKENS;
    for (const text of message.texts) {
      total += estimateTextTokens(text);
    }
    for (const image of message.images) {
      total += estimateImageTokens(image.width, image.height);
    }
  }
  if (content.schema !== undefined) {
    total += estimateTextTokens(JSON.stringify(content.schema));
  }
  return total;
}
