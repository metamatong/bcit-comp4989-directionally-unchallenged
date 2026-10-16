import type { PlanBounds } from './types';

/** Overlapping detail views are cut from the original decoded image, never its resized preview. */
export const PHOTO_CROP_REGIONS: { id: 'nw' | 'ne' | 'sw' | 'se'; bounds: PlanBounds }[] = [
  { id: 'nw', bounds: [0, 0, 0.55, 0.55] },
  { id: 'ne', bounds: [0.45, 0, 1, 0.55] },
  { id: 'sw', bounds: [0, 0.45, 0.55, 1] },
  { id: 'se', bounds: [0.45, 0.45, 1, 1] },
];
export type PhotoCropId = (typeof PHOTO_CROP_REGIONS)[number]['id'];
export const MAX_PHOTO_VIEW_BYTES = 450_000;
export const MAX_PHOTO_BUNDLE_BYTES = 2_500_000;

export function sourceCropPixels(width: number, height: number, bounds: PlanBounds) {
  const x = Math.round(bounds[0] * width),
    y = Math.round(bounds[1] * height);
  return {
    x,
    y,
    width: Math.max(1, Math.round(bounds[2] * width) - x),
    height: Math.max(1, Math.round(bounds[3] * height) - y),
  };
}
