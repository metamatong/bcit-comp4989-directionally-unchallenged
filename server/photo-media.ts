import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MAX_PHOTO_BUNDLE_BYTES, PHOTO_CROP_REGIONS } from '../src/photo-views';
import type { ModelPart } from './provider';
import { boundsSchema } from './visual-data';

const imageSchema = z
  .object({
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    data: z
      .string()
      .min(24)
      .max(3_500_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict();
const detailCropSchema = z
  .object({
    id: z.enum(['nw', 'ne', 'sw', 'se']),
    bounds: boundsSchema,
    image: imageSchema,
  })
  .strict()
  .refine(
    (crop) =>
      PHOTO_CROP_REGIONS.find((region) => region.id === crop.id)!.bounds.every(
        (value, index) => crop.bounds[index] === value,
      ),
    'Unexpected photo crop bounds',
  );

export const photoEvidenceRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    revision: z.number().int().nonnegative(),
    consent: z.literal(true),
    description: z.string().max(1000).default(''),
    buildingHint: z.string().max(8).nullable().optional(),
    image: imageSchema,
    detailCrops: z
      .array(detailCropSchema)
      .length(4)
      .refine(
        (crops) => new Set(crops.map((crop) => crop.id)).size === 4,
        'Each detail crop must appear once',
      ),
  })
  .strict();
export const photoRequestSchema = photoEvidenceRequestSchema.extend({
  evidenceId: z.string().uuid(),
});
export type PhotoEvidenceRequest = z.infer<typeof photoEvidenceRequestSchema>;
export type PhotoRequest = z.infer<typeof photoRequestSchema>;

export function validatePhotoBytes(image: PhotoEvidenceRequest['image']): number {
  if (image.data.length % 4 !== 0)
    throw new Error('Invalid image encoding. Choose a JPEG, PNG, or WebP photo.');
  const bytes = Buffer.from(image.data, 'base64');
  if (bytes.length > MAX_PHOTO_BUNDLE_BYTES || bytes.toString('base64') !== image.data)
    throw new Error('The photo is too large or incorrectly encoded.');
  const isPng = bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
  const isJpeg =
    bytes.subarray(0, 3).toString('hex') === 'ffd8ff' &&
    bytes.subarray(-2).toString('hex') === 'ffd9';
  const isWebp =
    bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (!(
    (image.mimeType === 'image/png' && isPng) ||
    (image.mimeType === 'image/jpeg' && isJpeg) ||
    (image.mimeType === 'image/webp' && isWebp)
  ))
    throw new Error('The image format does not match its contents.');
  return bytes.length;
}
export function validatePhotoBundle(input: PhotoEvidenceRequest) {
  const size =
    validatePhotoBytes(input.image) +
    input.detailCrops.reduce((sum, crop) => sum + validatePhotoBytes(crop.image), 0);
  if (size > MAX_PHOTO_BUNDLE_BYTES)
    throw new Error('The photo and detail crops exceed the 2.5 MB image limit.');
}

/** Fingerprint only; no image bytes survive between API stages on the server. */
export function photoFingerprint(input: PhotoEvidenceRequest): string {
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify({ description: input.description, buildingHint: input.buildingHint ?? null }),
  );
  hash.update(input.image.mimeType).update('\0').update(input.image.data);
  for (const crop of [...input.detailCrops].sort((a, b) => a.id.localeCompare(b.id)))
    hash
      .update(JSON.stringify({ id: crop.id, bounds: crop.bounds, mimeType: crop.image.mimeType }))
      .update('\0')
      .update(crop.image.data);
  return hash.digest('hex');
}
export function photoImageParts(input: PhotoEvidenceRequest): ModelPart[] {
  return [
    {
      text: 'USER PHOTO: full view. The following detail crops come from the same original image.',
    },
    { inlineData: input.image },
    ...input.detailCrops.flatMap((crop) => [
      {
        text: `USER PHOTO DETAIL ${crop.id}. Bounds in the full photo [left,top,right,bottom]: ${JSON.stringify(crop.bounds)}. These are photo coordinates, not floor-plan coordinates.`,
      },
      { inlineData: crop.image },
    ]),
  ];
}
export function releasePhotoBytes(input: Pick<PhotoEvidenceRequest, 'image' | 'detailCrops'>) {
  input.image.data = '';
  for (const crop of input.detailCrops) crop.image.data = '';
}
