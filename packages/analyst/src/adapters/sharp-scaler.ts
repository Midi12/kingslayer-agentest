/**
 * `ImageScaler` over sharp: the long edge scaled down to the limit (never up), the media
 * type kept. An image already within the limit passes through unchanged only when its
 * data is in the format its media type declares; otherwise it is re-encoded to the
 * declared type, so a provider never receives a mislabelled image.
 */
import sharp from 'sharp';
import { err, ok, type InlineImage, type Result } from '@argus/contracts';
import type { ImageError, ImageScaler, ScaledImage } from '../ports/images.js';

/** The sharp format of each media type an image may declare. */
const FORMAT_OF: Readonly<Record<InlineImage['mediaType'], string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};

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
      const fits = Math.max(width, height) <= maxLongEdge;
      if (fits && metadata.format === FORMAT_OF[image.mediaType]) {
        return ok({ image, width, height });
      }
      const pipeline = fits
        ? sharp(input)
        : sharp(input).resize({
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
