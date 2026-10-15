export type PreparedPhoto = {
  mimeType: 'image/jpeg';
  data: string;
  preview: string;
  width: number;
  height: number;
};

/** Resize and strip original metadata locally; this does not run OCR or upload anything. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error(
      'Choose a JPEG, PNG, or WebP photo. Use JPEG/Most Compatible on phones if needed.',
    );
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose a photo smaller than 8 MB.');
  const bitmap = await createImageBitmap(file);
  if (bitmap.width * bitmap.height > 50000000) {
    bitmap.close();
    throw new Error('This photo has too many pixels. Choose a smaller image.');
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) {
    bitmap.close();
    throw new Error('This browser cannot prepare the photo. Try another browser.');
  }
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const preview = canvas.toDataURL('image/jpeg', 0.82);
  const data = preview.split(',')[1];
  if (!data || data.length > 3_300_000)
    throw new Error('This photo is still too large after resizing. Choose a smaller image.');
  return { mimeType: 'image/jpeg', data, preview, width: canvas.width, height: canvas.height };
}
