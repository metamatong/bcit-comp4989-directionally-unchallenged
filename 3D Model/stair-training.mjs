/** Generate source-linked patches and review overlays; export only explicitly checked boxes. */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { cropSource } from "./crop-source.mjs";
export function validateBox(box) {
  if (
    !Array.isArray(box) ||
    box.length !== 4 ||
    !box.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) ||
    box[0] >= box[2] ||
    box[1] >= box[3]
  )
    throw Error("Invalid normalized box");
}
export function yoloBox(box, crop) {
  validateBox(box);
  validateBox(crop);
  if (
    box[0] < crop[0] ||
    box[1] < crop[1] ||
    box[2] > crop[2] ||
    box[3] > crop[3]
  )
    throw Error("Clipped annotation");
  const w = crop[2] - crop[0],
    h = crop[3] - crop[1];
  return [
    ((box[0] + box[2]) / 2 - crop[0]) / w,
    ((box[1] + box[3]) / 2 - crop[1]) / h,
    (box[2] - box[0]) / w,
    (box[3] - box[1]) / h,
  ];
}
export function validateRecord(record, plan) {
  validateBox(record.bounds);
  for (const bounds of record.additionalBounds ?? []) validateBox(bounds);
  if (
    record.sourcePdfSha256 !== plan.sourceSha256 ||
    record.imageSha256 !== plan.full.sha256
  )
    throw Error("Stale source");
  const split = { 1: "train", 2: "train", 3: "validation", 4: "heldout" }[
    plan.floor
  ];
  if (record.split !== split) throw Error("Floor split mismatch");
  if (
    record.status !== "source-geometry-checked" ||
    record.cropComplete !== true
  )
    throw Error("Unverified or incomplete annotation");
}
async function main() {
  const here = import.meta.dirname,
    root = resolve(here, "..");
  const sharp = createRequire(resolve(root, "package.json"))("sharp");
  const directory = resolve(here, "local-analysis/stair-training-review");
  const input = JSON.parse(
    readFileSync(resolve(directory, "checked-objects.json"), "utf8"),
  );
  const index = JSON.parse(
    readFileSync(resolve(root, "data/campus/visual/index.json"), "utf8"),
  );
  const exporting = process.argv.includes("--export");
  const output = resolve(directory, exporting ? "dataset" : "box-review");
  if (exporting) {
    const expected = new Set(
      [...input.objects, ...(input.negatives ?? [])].map(
        (o) => o.split + "/" + o.id,
      ),
    );
    for (const kind of ["images", "labels"])
      for (const split of ["train", "validation", "heldout"]) {
        const folder = resolve(output, kind, split);
        if (existsSync(folder))
          for (const name of readdirSync(folder)) {
            const extension = kind === "images" ? ".png" : ".txt";
            if (
              !name.endsWith(extension) ||
              !expected.has(split + "/" + name.slice(0, -extension.length))
            )
              throw Error(
                "Unexpected stale dataset artifact: " +
                  name +
                  ". Export to a reviewed clean directory before training.",
              );
          }
      }
  }
  mkdirSync(output, { recursive: true });
  const patches = [];
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  for (const object of input.objects) {
    const plan = index.plans.find((p) => p.id === object.planId);
    if (!plan) throw Error("Unknown plan");
    validateBox(object.bounds);
    if (
      object.sourcePdfSha256 !== plan.sourceSha256 ||
      object.imageSha256 !== plan.full.sha256
    )
      throw Error("Stale source");
    if (exporting) validateRecord(object, plan);
    const bytes = readFileSync(resolve(root, plan.full.file));
    if (hash(bytes) !== plan.full.sha256) throw Error("Image hash mismatch");
    const sourceBoxes = [object.bounds, ...(object.additionalBounds ?? [])];
    const union = [
      Math.min(...sourceBoxes.map((b) => b[0])),
      Math.min(...sourceBoxes.map((b) => b[1])),
      Math.max(...sourceBoxes.map((b) => b[2])),
      Math.max(...sourceBoxes.map((b) => b[3])),
    ];
    const [l, t, r, b] = union,
      dx = 15 / plan.full.width,
      dy = 15 / plan.full.height;
    const crop = await cropSource(
      sharp,
      bytes,
      [
        Math.max(0, l - dx),
        Math.max(0, t - dy),
        Math.min(1, r + dx),
        Math.min(1, b + dy),
      ],
      0,
      640,
    );
    const boxes = sourceBoxes.map((b) => yoloBox(b, crop.bounds));
    const box = boxes[0];
    const imageName = object.id + ".png";
    const imagesDir = exporting
      ? resolve(output, "images", object.split)
      : output;
    mkdirSync(imagesDir, { recursive: true });
    writeFileSync(resolve(imagesDir, imageName), crop.image);
    if (exporting) {
      const labelsDir = resolve(output, "labels", object.split);
      mkdirSync(labelsDir, { recursive: true });
      writeFileSync(
        resolve(labelsDir, object.id + ".txt"),
        boxes
          .map((b) => "0 " + b.map((v) => v.toFixed(8)).join(" "))
          .join("\n") + "\n",
      );
    }
    const info = {
      ...object,
      cropBounds: crop.bounds,
      cropSha256: hash(crop.image),
      yoloBox: box,
      yoloBoxes: boxes,
      image: exporting ? "images/" + object.split + "/" + imageName : imageName,
    };
    patches.push(info);
    if (!exporting) {
      const tile = await sharp(crop.image)
        .resize(360, 320, { fit: "contain", background: "#fff" })
        .png()
        .toBuffer();
      const meta = await sharp(crop.image).metadata(),
        scale = Math.min(360 / meta.width, 320 / meta.height),
        w = meta.width * scale,
        h = meta.height * scale;
      const rects = boxes
        .map((box) => {
          const x = (360 - w) / 2 + (box[0] - box[2] / 2) * w,
            y = (320 - h) / 2 + (box[1] - box[3] / 2) * h;
          return (
            '<rect x="' +
            x +
            '" y="' +
            (y + 30) +
            '" width="' +
            box[2] * w +
            '" height="' +
            box[3] * h +
            '" fill="none" stroke="red" stroke-width="1.5"/>'
          );
        })
        .join("");
      const svg = Buffer.from(
        '<svg width="360" height="350">' +
          rects +
          '<text x="4" y="20" font-size="15">' +
          object.id +
          "</text></svg>",
      );
      info.tile = await sharp({
        create: { width: 360, height: 350, channels: 4, background: "#fff" },
      })
        .composite([
          { input: tile, left: 0, top: 30 },
          { input: svg, left: 0, top: 0 },
        ])
        .png()
        .toBuffer();
    }
  }
  if (!exporting)
    for (let i = 0; i < patches.length; i += 8) {
      const group = patches.slice(i, i + 8);
      await sharp({
        create: { width: 1440, height: 700, channels: 4, background: "#fff" },
      })
        .composite(
          group.map((p, j) => ({
            input: p.tile,
            left: (j % 4) * 360,
            top: Math.floor(j / 4) * 350,
          })),
        )
        .png()
        .toFile(resolve(output, "sheet-" + (i / 8 + 1) + ".png"));
    }
  if (exporting)
    for (const negative of input.negatives ?? []) {
      const plan = index.plans.find((p) => p.id === negative.planId);
      validateRecord(negative, plan);
      const source = readFileSync(resolve(root, plan.full.file));
      if (hash(source) !== plan.full.sha256)
        throw Error("Negative source hash mismatch");
      const bytes = readFileSync(resolve(directory, negative.cropFile));
      if (hash(bytes) !== negative.cropSha256)
        throw Error("Negative crop hash mismatch");
      const imagesDir = resolve(output, "images", negative.split),
        labelsDir = resolve(output, "labels", negative.split);
      mkdirSync(imagesDir, { recursive: true });
      mkdirSync(labelsDir, { recursive: true });
      writeFileSync(resolve(imagesDir, negative.id + ".png"), bytes);
      writeFileSync(resolve(labelsDir, negative.id + ".txt"), "");
      patches.push({
        ...negative,
        image: "images/" + negative.split + "/" + negative.id + ".png",
        cropBounds: negative.bounds,
        yoloBox: null,
      });
    }
  for (const p of patches) delete p.tile;
  writeFileSync(
    resolve(output, "manifest.json"),
    JSON.stringify(
      {
        taxonomy: input.taxonomy,
        reviewer: "Codex source-image review (AI)",
        humanVerified: false,
        fieldVerified: false,
        sourceComplete: false,
        scope: "Selected complete patches only, not whole-floor ground truth",
        objects: patches,
      },
      null,
      2,
    ),
  );
  if (exporting)
    writeFileSync(
      resolve(output, "data.yaml"),
      "# Single-class transfer learning; NOT a remapping of FloorCAD class 26.\ntrain: images/train\nval: images/validation\ntest: images/heldout\nnames:\n  0: stair-assembly\n",
    );
  if (exporting) {
    const counts = index.plans
      .filter((p) => patches.some((r) => r.planId === p.id))
      .map((p) => ({
        planId: p.id,
        positive: patches.filter((r) => r.planId === p.id && r.yoloBox).length,
        negative: patches.filter((r) => r.planId === p.id && !r.yoloBox).length,
      }));
    const cards = patches
      .map((p) => {
        const box = p.yoloBox;
        const rect = (p.yoloBoxes ?? [])
          .map(
            (box) =>
              '<span style="position:absolute;border:2px solid #ff5f57;left:' +
              100 * (box[0] - box[2] / 2) +
              "%;top:" +
              100 * (box[1] - box[3] / 2) +
              "%;width:" +
              100 * box[2] +
              "%;height:" +
              100 * box[3] +
              '%"></span>',
          )
          .join("");
        return (
          "<article><h3>" +
          p.id +
          "</h3><p>" +
          p.split +
          " · " +
          (box ? "stair assembly" : "negative: no stairs") +
          '</p><div style="position:relative"><img style="display:block;width:100%" src="data:image/png;base64,' +
          readFileSync(resolve(output, p.image)).toString("base64") +
          '">' +
          rect +
          "</div></article>"
        );
      })
      .join("");
    const reconciliationPath = resolve(directory, "reconciled-review.json");
    const reconciliation = existsSync(reconciliationPath)
      ? JSON.parse(readFileSync(reconciliationPath, "utf8"))
      : null;
    const candidates = JSON.parse(
      readFileSync(resolve(directory, "candidates-manifest.json"), "utf8"),
    ).candidates;
    const excluded = (reconciliation?.records ?? [])
      .filter((r) => r.needsHumanReview)
      .map((r) => {
        const c = candidates.find((c) => c.stableId === r.id),
          box = yoloBox(c.rawPrediction.xyxyNormalized, c.cropBoundsNormalized);
        const rect =
          '<span style="position:absolute;border:2px solid orange;left:' +
          100 * (box[0] - box[2] / 2) +
          "%;top:" +
          100 * (box[1] - box[3] / 2) +
          "%;width:" +
          100 * box[2] +
          "%;height:" +
          100 * box[3] +
          '%"></span>';
        return (
          "<article><h3>" +
          r.id +
          "</h3><p>Excluded · Neon: " +
          r.neon +
          " · Codex: " +
          r.codex +
          '</p><div style="position:relative"><img style="display:block;width:100%" src="data:image/png;base64,' +
          readFileSync(resolve(directory, r.cropFile)).toString("base64") +
          '">' +
          rect +
          "</div></article>"
        );
      })
      .join("");
    writeFileSync(
      resolve(directory, "review.html"),
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Stair training label review</title><style>body{font:16px system-ui;background:#101822;color:#edf2f7;margin:32px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px}article{background:#223344;padding:15px}h3{font-size:15px}table{border-collapse:collapse}td,th{padding:7px;border:1px solid #789}a{color:#8eeaff}</style><h1>Source-checked stair labels</h1><p>33 stair boxes in 32 positive patches and 21 negative patches across eight supplied SE12/SW3 floors. Red boxes show visible stair assemblies. Checked visually by Codex (AI); not human or field verified. These selected patches are completely annotated for the single stair class; whole floors are NOT completely annotated. No routes or weights changed.</p><p>F1/F2: train; F3: validation; F4: reserved evaluation. Earlier diagnostic exposure means evaluation is not a pristine unseen-building benchmark. Shared stair layouts across floors can inflate results.</p><table><tr><th>Plan</th><th>Positive</th><th>Negative</th></tr>' +
        counts
          .map(
            (c) =>
              "<tr><td>" +
              c.planId +
              "</td><td>" +
              c.positive +
              "</td><td>" +
              c.negative +
              "</td></tr>",
          )
          .join("") +
        "</table><p>Inspect boxes and exclusions before fine-tuning. Dataset class 0 is stair-assembly: a new single-class transfer-learning task, not a blanket parking-to-stair correction to the original 35 classes.</p><main>" +
        cards +
        "</main><h2>Excluded disagreements — please review</h2><p>These five detections are excluded from training. Orange boxes are original detector proposals, not accepted annotations. Two are theatre tiers; two contain landing-only fragments; one may show steps into the control room. They need a labeling decision or clearer evidence. No connection is inferred.</p><main>" +
        excluded +
        "</main></html>",
    );
  }
  console.log(JSON.stringify({ exporting, objects: patches.length, output }));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
