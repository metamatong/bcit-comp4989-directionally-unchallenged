/** Materialize the original-image crop before rotation: sharp otherwise reorders these operations. */
export async function cropSource(
  sharp,
  bytes,
  bounds,
  rotation,
  maximum = 1000,
) {
  if (
    !Array.isArray(bounds) ||
    bounds.length !== 4 ||
    !bounds.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) ||
    bounds[2] <= bounds[0] ||
    bounds[3] <= bounds[1]
  )
    throw Error("Invalid crop bounds");
  if (![0, 90, 180, 270].includes(rotation))
    throw Error("Invalid crop rotation");
  const metadata = await sharp(bytes).metadata();
  const [l, t, r, b] = bounds;
  const left = Math.floor(l * metadata.width),
    top = Math.floor(t * metadata.height);
  const width = Math.floor(r * metadata.width) - left,
    height = Math.floor(b * metadata.height) - top;
  if (width < 1 || height < 1) throw Error("Empty crop");
  const extracted = await sharp(bytes)
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  const image = await sharp(extracted)
    .rotate(rotation)
    .resize({ width: maximum, height: maximum, fit: "inside" })
    .png()
    .toBuffer();
  return {
    image,
    bounds: [
      left / metadata.width,
      top / metadata.height,
      (left + width) / metadata.width,
      (top + height) / metadata.height,
    ],
  };
}
