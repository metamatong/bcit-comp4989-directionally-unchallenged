import assert from "node:assert/strict";
import test from "node:test";
import { validateBox, validateRecord, yoloBox } from "./stair-training.mjs";
const plan = { floor: "2", sourceSha256: "pdf", full: { sha256: "png" } };
const good = {
  bounds: [0.1, 0.2, 0.3, 0.4],
  sourcePdfSha256: "pdf",
  imageSha256: "png",
  split: "train",
  status: "source-geometry-checked",
  cropComplete: true,
};
test("training export rejects proposals, partial annotations, stale sources and floor leakage", () => {
  assert.doesNotThrow(() => validateRecord(good, plan));
  for (const change of [
    { status: "neon-proposed" },
    { cropComplete: false },
    { sourcePdfSha256: "stale" },
    { imageSha256: "stale" },
    { split: "heldout" },
  ])
    assert.throws(() => validateRecord({ ...good, ...change }, plan));
});
test("YOLO conversion uses crop coordinates and rejects clipped or malformed boxes", () => {
  const result = yoloBox([0.2, 0.3, 0.4, 0.5], [0.1, 0.2, 0.5, 0.6]);
  result.forEach((n, i) =>
    assert.ok(Math.abs(n - [0.5, 0.5, 0.5, 0.5][i]) < 1e-10),
  );
  assert.throws(() => yoloBox([0.1, 0.2, 0.4, 0.5], [0.2, 0.2, 0.5, 0.6]));
  for (const b of [
    [0, 0, 0, 1],
    [0, 0, 2, 1],
    [0, NaN, 1, 1],
    [0, 0, 1],
  ])
    assert.throws(() => validateBox(b));
});
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
test("exported dataset images, labels and floor splits match their reviewed source manifests", () => {
  const root = resolve(
    import.meta.dirname,
    "local-analysis/stair-training-review",
  );
  const dataset = JSON.parse(
    readFileSync(resolve(root, "dataset/manifest.json")),
  );
  const sources = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        "../data/campus/visual/index.json",
      ),
    ),
  );
  const byId = new Map(sources.plans.map((p) => [p.id, p]));
  assert.equal(
    dataset.objects.reduce((sum, o) => sum + (o.yoloBoxes?.length ?? 0), 0),
    33,
  );
  const seen = new Set();
  assert.equal(dataset.objects.length, 53);
  assert.equal(dataset.objects.filter((o) => o.yoloBox).length, 32);
  for (const item of dataset.objects) {
    assert.ok(!seen.has(item.id));
    seen.add(item.id);
    validateRecord(item, byId.get(item.planId));
    const bytes = readFileSync(resolve(root, "dataset", item.image));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      item.cropSha256,
    );
    const label = readFileSync(
      resolve(root, "dataset/labels", item.split, item.id + ".txt"),
      "utf8",
    ).trim();
    if (item.yoloBox) {
      const rows = label
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number));
      assert.equal(rows.length, item.yoloBoxes.length);
      rows.forEach((values, j) => {
        assert.equal(values[0], 0);
        assert.equal(values.length, 5);
        values
          .slice(1)
          .forEach((v, k) =>
            assert.ok(Math.abs(v - item.yoloBoxes[j][k]) < 1e-7),
          );
      });
    } else assert.equal(label, "");
  }
  assert.equal(new Set(dataset.objects.map((o) => o.planId)).size, 8);
});
