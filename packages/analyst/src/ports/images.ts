/**
 * Image scaling port: frames and screenshots are scaled before they reach a provider
 * (long edge at most 1,280 px). The adapter is `SharpImageScaler`.
 */
import type { InlineImage, Result } from '@argus/contracts';

export interface ScaledImage {
  readonly image: InlineImage;
  readonly width: number;
  readonly height: number;
}

export interface ImageError {
  readonly code: 'invalid_image';
  readonly message: string;
}

export interface ImageScaler {
  /** The image with its long edge scaled down to `maxLongEdge` (never up), same media type. */
  fit(image: InlineImage, maxLongEdge: number): Promise<Result<ScaledImage, ImageError>>;
}
