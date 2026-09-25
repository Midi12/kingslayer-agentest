/**
 * Token estimates used to enforce budgets before a call (ADR M07-budgets). They are
 * deliberately conservative: a third of the UTF-8 bytes of text (real tokenisers give
 * about a quarter for English prose, less for JSON), and for an image the larger of the
 * Anthropic (w·h/750) and OpenAI high-detail (85 + 170 per 512 px tile) counts.
 */
import { utf8 } from '@argus/contracts';

/** Tokens one message adds beyond its content (role markers and separators). */
export const MESSAGE_OVERHEAD_TOKENS = 8;

export function estimateTextTokens(text: string): number {
  return Math.ceil(utf8(text).length / 3);
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
