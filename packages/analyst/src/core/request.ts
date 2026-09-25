/**
 * Shared request plumbing: turning prompt text and scaled images into an `LlmRequest`,
 * and estimating it.
 */
import type { LlmContent, LlmJsonSchema, LlmMessage, LlmRequest } from '../ports/llm.js';
import type { ScaledImage } from '../ports/images.js';
import { dataBlock } from './data-block.js';
import { estimateRequestTokens } from './tokens.js';

/** One labelled image: a small data block naming it, then the image. */
export interface LabelledImage {
  readonly label: Readonly<Record<string, unknown>>;
  readonly scaled: ScaledImage;
}

export function userMessage(text: string, images: readonly LabelledImage[]): LlmMessage {
  const content: LlmContent[] = [{ type: 'text', text }];
  for (const image of images) {
    content.push({ type: 'text', text: dataBlock('image', image.label) });
    content.push({ type: 'image', image: image.scaled.image });
  }
  return { role: 'user', content };
}

export interface RequestShape {
  readonly model: string;
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly jsonSchema: LlmJsonSchema;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  readonly temperature?: number | undefined;
}

export function toRequest(shape: RequestShape): LlmRequest {
  return {
    model: shape.model,
    system: shape.system,
    messages: shape.messages,
    jsonSchema: shape.jsonSchema,
    maxTokens: shape.maxTokens,
    timeoutMs: shape.timeoutMs,
    ...(shape.temperature === undefined ? {} : { temperature: shape.temperature }),
  };
}

/** Image sizes of a request, recorded when the images were scaled. */
export type ImageSizes = ReadonlyMap<string, { readonly width: number; readonly height: number }>;

/** The estimated input tokens of a request (ADR M07-budgets). */
export function estimateLlmRequest(request: LlmRequest, sizes: ImageSizes): number {
  return estimateRequestTokens({
    system: request.system,
    messages: request.messages.map((message) => ({
      texts: message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
      images: message.content.flatMap((part) => {
        if (part.type !== 'image') return [];
        const size = sizes.get(part.image.data);
        // An image of unknown size counts as the largest one the scaler produces.
        return [size ?? { width: 1280, height: 1280 }];
      }),
    })),
    schema: request.jsonSchema?.schema,
  });
}

export function sizesOf(
  images: readonly ScaledImage[],
): Map<string, { width: number; height: number }> {
  return new Map(
    images.map((image) => [image.image.data, { width: image.width, height: image.height }]),
  );
}
