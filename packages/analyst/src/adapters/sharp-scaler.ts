/**
 * `ImageScaler` over sharp: the long edge scaled down to the limit (never up), the media
 * type kept. Images already within the limit pass through unchanged.
 */
import sharp from 'sharp';
import { err, ok, type InlineImage, type Result } from '@argus/contracts';
import type { ImageError, ImageScaler, ScaledImage } from '../ports/images.js';

export class SharpImageScaler implements ImageScaler {
  async fit(image: InlineImage, maxLongEdge: number): Promise<Result<ScaledImage, ImageError>> {
    try {
      const input = Buffer.from(image.data, 'base64');
      const metadata = await sharp(input).metadata();
      const width = metadata.width;
      const height = metadata.height;
      if (!(width > 0 && height > 0)) {
        return err({ code: 'invalid_image', message: 'the image has no dimensions' });
      }
      if (Math.max(width, height) <= maxLongEdge) {
        return ok({ image, width, height });
      }
      const pipeline = sharp(input).resize({
        width: maxLongEdge,
        height: maxLongEdge,
        fit: 'inside',
        withoutEnlargement: true,
      });
      const encoded =
        image.mediaType === 'image/png'
          ? pipeline.png()
          : image.mediaType === 'image/webp'
            ? pipeline.webp({ quality: 80 })
            : pipeline.jpeg({ quality: 80 });
      const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
      return ok({
        image: { mediaType: image.mediaType, data: data.toString('base64') },
        width: info.width,
        height: info.height,
      });
    } catch (error) {
      return err({
        code: 'invalid_image',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
