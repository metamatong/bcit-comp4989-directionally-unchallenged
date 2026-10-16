import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparePhoto } from '../src/photo';
import { MAX_PHOTO_VIEW_BYTES, PHOTO_CROP_REGIONS, sourceCropPixels } from '../src/photo-views';

afterEach(() => vi.unstubAllGlobals());
function browserImage(
  width = 5888,
  height = 4416,
  encode: (_type: string, _quality: number) => string = () =>
    'data:image/jpeg;base64,/9j/AAAAAAAAAAAAAAAA/9k=',
) {
  const bitmap = { width, height, close: vi.fn() };
  const context = { fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() };
  const canvases: { width: number; height: number; toDataURL: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => bitmap),
  );
  vi.stubGlobal('document', {
    createElement: vi.fn(() => {
      const canvas = { width: 0, height: 0, getContext: () => context, toDataURL: vi.fn(encode) };
      canvases.push(canvas);
      return canvas;
    }),
  });
  return { bitmap, context, canvases };
}
const photoFile = { type: 'image/jpeg', size: 1_000_000 } as File;
describe('local photo preparation without browser/screen tests', () => {
  it('renders every crop directly from the original image, preserving detail beyond the preview', async () => {
    const { bitmap, context, canvases } = browserImage();
    const result = await preparePhoto(photoFile);
    expect(result.width).toBe(1600);
    expect(result.height).toBe(1200);
    expect(result.detailCrops).toHaveLength(4);
    expect(context.drawImage).toHaveBeenCalledTimes(5);
    for (const [index, crop] of PHOTO_CROP_REGIONS.entries()) {
      const pixels = sourceCropPixels(5888, 4416, crop.bounds);
      expect(context.drawImage.mock.calls[index + 1]).toEqual([
        bitmap,
        pixels.x,
        pixels.y,
        pixels.width,
        pixels.height,
        0,
        0,
        canvases[index + 1].width,
        canvases[index + 1].height,
      ]);
      expect(pixels.width).toBeGreaterThan(result.width);
      expect(result.detailCrops[index].bounds).toEqual(crop.bounds);
    }
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('does not upscale small source views', async () => {
    const { canvases } = browserImage(400, 300);
    const result = await preparePhoto(photoFile);
    expect(result.width).toBe(400);
    expect(canvases[1].width).toBe(220);
  });
  it('reduces JPEG quality to keep each view inside the shared upload budget', async () => {
    let count = 0;
    const large =
      'data:image/jpeg;base64,' + 'A'.repeat(Math.ceil((MAX_PHOTO_VIEW_BYTES * 4) / 3) + 4);
    const { canvases } = browserImage(5888, 4416, () =>
      ++count % 2 ? large : 'data:image/jpeg;base64,/9j/AAAAAAAAAAAAAAAA/9k=',
    );
    await preparePhoto(photoFile);
    expect(canvases[0].toDataURL.mock.calls.map((call) => call[1])).toEqual([0.86, 0.72]);
  });
  it('releases decoded images on errors and rejects unsupported originals', async () => {
    const { bitmap } = browserImage(10000, 10000);
    await expect(preparePhoto(photoFile)).rejects.toThrow('too many pixels');
    expect(bitmap.close).toHaveBeenCalledOnce();
    await expect(preparePhoto({ type: 'text/plain', size: 1 } as File)).rejects.toThrow('JPEG');
    await expect(
      preparePhoto({ type: 'image/jpeg', size: 9 * 1024 * 1024 } as File),
    ).rejects.toThrow('8 MB');
  });
});
