import { MAX_PHOTO_VIEW_BYTES, PHOTO_CROP_REGIONS, sourceCropPixels } from './photo-views';
import type { PhotoDetailCrop, PlanBounds } from './types';

export type PreparedPhoto = {
  mimeType: 'image/jpeg';
  data: string;
  preview: string;
  width: number;
  height: number;
  detailCrops: PhotoDetailCrop[];
};

function encodeView(bitmap: ImageBitmap, bounds: PlanBounds) {
  const source = sourceCropPixels(bitmap.width, bitmap.height, bounds);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the photo. Try another browser.');
  for (const maxEdge of [1600, 1200, 960]) {
    const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      bitmap,
      source.x,
      source.y,
      source.width,
      source.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    for (const quality of [0.86, 0.72, 0.56]) {
      const preview = canvas.toDataURL('image/jpeg', quality);
      const data = preview.startsWith('data:image/jpeg;base64,') ? preview.split(',')[1] : '';
      if (data && Math.ceil((data.length * 3) / 4) <= MAX_PHOTO_VIEW_BYTES)
        return {
          mimeType: 'image/jpeg' as const,
          data,
          preview,
          width: canvas.width,
          height: canvas.height,
        };
    }
  }
  throw new Error('This photo is still too large after preparation. Choose a smaller image.');
}

/** Prepare a context image and four original-resolution crops; nothing is uploaded here. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error(
      'Choose a JPEG, PNG, or WebP photo. Use JPEG/Most Compatible on phones if needed.',
    );
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose a photo smaller than 8 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 50_000_000)
      throw new Error(
        'This photo has invalid dimensions or too many pixels. Choose a smaller image.',
      );
    const full = encodeView(bitmap, [0, 0, 1, 1]);
    const detailCrops = PHOTO_CROP_REGIONS.map(({ id, bounds }) => {
      const crop = encodeView(bitmap, bounds);
      return {
        id,
        bounds: [...bounds] as PlanBounds,
        image: { mimeType: crop.mimeType, data: crop.data },
      };
    });
    return { ...full, detailCrops };
  } finally {
    bitmap.close();
  }
}
