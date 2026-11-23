/** Per-sheet north-symbol readings from the eight official SW03 / SE12 source images. */
const orientations: Record<
  string,
  { sourceSha256: string; degrees: number; note: string }
> = {
  "SW3-F2-p1": {
    sourceSha256:
      "39b1a81a2706f7254b3175859e94348839385f0afed3b785561f6bad1e2b9fcc",
    degrees: 0,
    note: "Source north symbol points toward the top of this sheet; no rotation needed.",
  },
  "SW3-F3-p1": {
    sourceSha256:
      "a34945534dd978027a28f5f2fbd0f018a03846360f9c36dc43c24f72d68a8874",
    degrees: 0,
    note: "Source north symbol points toward the top of this sheet; no rotation needed.",
  },
  "SE12-F2-p1": {
    sourceSha256:
      "9cbb10dee2e102cb05baec386bae3b7dc51f43276f30c1807063015dbc41f545",
    degrees: 90,
    note: "Source north symbol points left; rotate sheet 90 degrees clockwise for north-up.",
  },
  "SW3-F4-p1": {
    sourceSha256:
      "ec9b5c3ae80da356b78dc7ea89e3228e6cd6b5e882d9c20a6b7e10bbd5ec034a",
    degrees: 0,
    note: "Source north symbol points toward the top of this sheet; no rotation needed.",
  },
  "SW3-F1-p1": {
    sourceSha256:
      "768da55d04f76d0d33ad2ff9822aac2d1ddc57c2c29cbc7c88890ca7ffac20b0",
    degrees: 0,
    note: "Source north symbol points toward the top of this sheet; no rotation needed.",
  },
  "SE12-F1-p1": {
    sourceSha256:
      "b87581c2dce2d170f90a0512267803567026395948ab381dcbd70a1f0c437f72",
    degrees: 0,
    note: "Source north symbol points toward the top of this sheet; no rotation needed.",
  },
  "SE12-F3-p1": {
    sourceSha256:
      "521d90e70cda6b4fd58c0e00219fdcefb8ff605787b36bf383d124a129e794f1",
    degrees: 90,
    note: "Source north symbol points left; rotate sheet 90 degrees clockwise for north-up.",
  },
  "SE12-F4-p1": {
    sourceSha256:
      "d73872a56148fc1e6ac5592277e8ffb0b575ced1c501a1f5c939f7fa9bae88fb",
    degrees: 90,
    note: "Source north symbol points left; rotate sheet 90 degrees clockwise for north-up.",
  },
};
export function sourceOrientation(plan: { id: string; sourceSha256: string }) {
  const record = orientations[plan.id];
  return record?.sourceSha256 === plan.sourceSha256 ? record : null;
}
