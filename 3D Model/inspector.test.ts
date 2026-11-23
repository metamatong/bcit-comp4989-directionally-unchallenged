/** Data regression checks run without browser, provider calls or source mutations. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { snapshot, floorData, root, stairPlaces } from "./model.ts";
import { pairProblem, type StairMarker } from "./stair-review.ts";
test("stair review retains zero-label floors and rejects same-floor or cross-building pairs", () => {
  const inventory = stairPlaces();
  assert.equal(inventory.length, 89);
  assert.ok(inventory.some((floor: any) => floor.places.length === 0));
  const s = snapshot();
  const nodes = s.document.nodes.filter((n: any) => n.kind === "stair-landing");
  const marker = (n: any): StairMarker => ({
    ...n,
    category: "proposed",
    reference: n.id,
  });
  const a = marker(nodes.find((n: any) => n.planId === "SW3-F1-p1"));
  const b = marker(nodes.find((n: any) => n.planId === "SW3-F2-p1"));
  assert.equal(pairProblem(a, b, s.plans), null);
  assert.match(pairProblem(a, a, s.plans)!, /same floor/);
  const other = marker(nodes.find((n: any) => n.planId === "SE12-F2-p1"));
  assert.match(pairProblem(a, other, s.plans)!, /same building/);
  assert.match(pairProblem(a, undefined, s.plans)!, /both endpoints/);
});
import { relationshipColors, rotatePoint, wrapAngle } from "./view-math.ts";
import { sourceOrientation } from "./sheet-orientation.ts";
test("north-up rotations bind to each source and keep overlays on the same sheet", () => {
  const s = snapshot();
  for (const p of s.plans.filter((p: any) =>
    ["SW3", "SE12"].includes(p.building),
  )) {
    const orientation = sourceOrientation(p);
    assert.ok(orientation);
    assert.equal(
      orientation.degrees,
      p.building === "SE12" && p.floor !== "1" ? 90 : 0,
    );
    const north =
      orientation.degrees === 90
        ? { x: -1, y: 0, z: 0 }
        : { x: 0, y: -1, z: 0 };
    const rotated = rotatePoint(north, orientation.degrees, 0, 0);
    assert.ok(Math.abs(rotated.x) < 1e-10 && Math.abs(rotated.y + 1) < 1e-10);
    assert.equal(sourceOrientation({ ...p, sourceSha256: "stale" }), null);
  }
  assert.equal(
    sourceOrientation({ id: "unreviewed", sourceSha256: "unknown" }),
    null,
  );
});
test("camera wraps seamlessly in both directions and rotates beneath the floors", () => {
  assert.equal(wrapAngle(181), -179);
  assert.equal(wrapAngle(-181), 179);
  assert.equal(wrapAngle(1081), 1);
  const p = { x: 2, y: 3, z: 4 };
  const front = rotatePoint(p, 0, 0, 0),
    back = rotatePoint(p, 0, 180, 0);
  assert.ok(Math.abs(front.depth + back.depth) < 1e-10);
  const fullTurn = rotatePoint(p, 360, 360, 360);
  assert.ok(
    Math.abs(fullTurn.x - p.x) < 1e-10 && Math.abs(fullTurn.y - p.y) < 1e-10,
  );
  const rolled = rotatePoint(p, 0, 0, 90);
  assert.ok(
    Math.abs(rolled.x + p.y) < 1e-10 && Math.abs(rolled.y - p.x) < 1e-10,
  );
  assert.equal(
    new Set(Object.values(relationshipColors).map((s) => s.color)).size,
    5,
  );
});
test("all supplied sheets and zero-coverage floors remain visible", () => {
  const s = snapshot();
  assert.equal(s.plans.length, 89);
  assert.equal(s.coverage.length, 89);
  assert.equal(new Set(s.plans.map((p: any) => p.building)).size, 45);
  for (const p of s.plans)
    assert.ok(s.coverage.some((c: any) => c.planId === p.id));
});
test("local inspection does not migrate or overwrite the journal", () => {
  const file = resolve(root, "data/campus/topology.json");
  const before = readFileSync(file);
  const local = snapshot("local");
  assert.ok(local.document.revision >= 0);
  assert.deepEqual(readFileSync(file), before);
});
test("stale endpoints and source hashes disable incident edges", async () => {
  const { topologyEligibility } = await import(
    pathToFileURL(resolve(root, "server/topology.ts")).href
  );
  const s = snapshot();
  const edge = s.document.edges.find((e: any) =>
    s.eligibility.edgeIds.includes(e.id),
  );
  assert.ok(edge);
  const node = s.document.nodes.find((n: any) => n.id === edge.fromNodeId);
  node.version++;
  assert.ok(
    !topologyEligibility(s.document, s.plans).edgeIds.includes(edge.id),
  );
  node.sourceSha256 = "0".repeat(64);
  assert.ok(
    !topologyEligibility(s.document, s.plans).nodeIds.includes(node.id),
  );
});
test("floor grid retains exact source occurrences and bounds", () => {
  const f = floorData("SW3-F2-p1");
  assert.ok(f.places.some((p: any) => p.label === "2605"));
  assert.ok(f.runs.length > 0);
  for (const p of f.places) assert.equal(p.bounds.length, 4);
  assert.throws(() => floorData("../private"));
  assert.throws(() => snapshot("invented"));
});

test("four confirmed model-only transfers remain bidirectional and source-bound", async () => {
  const { addModelConnections } = await import("./model-connections.ts");
  const { topologyRecordHash, validateTopologyDocument } = await import(
    pathToFileURL(resolve(root, "server/topology.ts")).href
  );
  const paths = [
    "data/campus/topology.json",
    "data/campus/spatial/reviewed-network.json",
    "data/campus/connection-candidates.json",
  ];
  const before = paths.map((p) => readFileSync(resolve(root, p)));
  for (const source of ["published", "local"]) {
    const s = snapshot(source);
    validateTopologyDocument(s.document);
    assert.equal(s.modelConnections.added.length, 4);
    for (const id of s.modelConnections.added) {
      const e = s.document.edges.find((e: any) => e.id === id);
      assert.equal(e.direction, "both");
      assert.equal(e.kind, "stairs");
      assert.ok(s.eligibility.edgeIds.includes(id));
      const a = s.document.nodes.find((n: any) => n.id === e.fromNodeId);
      const b = s.document.nodes.find((n: any) => n.id === e.toNodeId);
      assert.equal(a.planId, "SE12-F3-p1");
      assert.equal(b.planId, "SE12-F4-p1");
      assert.equal(e.evidence.observedOn, null);
    }
    assert.equal(
      addModelConnections(s.document, s.plans, topologyRecordHash).added.length,
      0,
    );
  }
  const s = snapshot();
  const base = structuredClone(s.document);
  base.nodes = base.nodes.filter((n: any) => !n.id.startsWith("3d000004"));
  base.edges = base.edges.filter((e: any) => !e.id.startsWith("3d000034"));
  const changedPlans = s.plans.map((p: any) =>
    p.id === "SE12-F4-p1" ? { ...p, sourceSha256: "stale" } : p,
  );
  assert.equal(
    addModelConnections(base, changedPlans, topologyRecordHash).added.length,
    0,
  );
  base.nodes.find((n: any) => n.id === "9e4d3f61-332e-4d27-8838-65a7596cb304")
    .version++;
  assert.equal(
    addModelConnections(base, s.plans, topologyRecordHash).added.length,
    3,
  );
  paths.forEach((p, i) =>
    assert.deepEqual(readFileSync(resolve(root, p)), before[i]),
  );
});

test("local preprocessing crops before rotating and rejects invalid source regions", async () => {
  const { createRequire } = await import("node:module");
  const require = createRequire(resolve(root, "package.json"));
  const sharp = require("sharp");
  const { cropSource } = await import("./crop-source.mjs");
  const pixels = Buffer.from([
    255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 255,
    0, 0, 255,
  ]);
  const input = await sharp(pixels, {
    raw: { width: 4, height: 2, channels: 3 },
  })
    .png()
    .toBuffer();
  const crop = await cropSource(sharp, input, [0, 0, 0.5, 1], 270, 2);
  assert.deepEqual(crop.bounds, [0, 0, 0.5, 1]);
  const output = await sharp(crop.image).removeAlpha().raw().toBuffer();
  for (let i = 0; i < output.length; i += 3)
    assert.deepEqual([...output.subarray(i, i + 3)], [255, 0, 0]);
  await assert.rejects(
    cropSource(sharp, input, [0.8, 0, 0.2, 1], 0),
    /Invalid crop bounds/,
  );
  await assert.rejects(
    cropSource(sharp, input, [0, 0, 1, 1], 42),
    /Invalid crop rotation/,
  );
});

test("floor pair inspection isolates requested sheets and zoom preserves the pointer anchor", async () => {
  const { matchesFloorPair, zoomPan } = await import("./view-math.ts");
  const ids = ["SE12-F1-p1", "SE12-F2-p1", "SE12-F3-p1", "SE12-F4-p1"];
  assert.deepEqual(
    ids.filter((id) => matchesFloorPair(id, ids[2], ids[3])),
    ids.slice(2),
  );
  assert.deepEqual(
    ids.filter((id) => matchesFloorPair(id, ids[0], "")),
    [ids[0]],
  );
  assert.equal(ids.filter((id) => matchesFloorPair(id, "all", "")).length, 4);
  const pan = { x: 35, y: -17 },
    anchor = { x: 120, y: 90 };
  const next = zoomPan(pan, anchor, 90, 900);
  assert.equal(next.x + (anchor.x - pan.x) * 10, anchor.x);
  assert.equal(next.y + (anchor.y - pan.y) * 10, anchor.y);
  const back = zoomPan(next, anchor, 900, 90);
  assert.ok(
    Math.abs(back.x - pan.x) < 1e-10 && Math.abs(back.y - pan.y) < 1e-10,
  );
});
