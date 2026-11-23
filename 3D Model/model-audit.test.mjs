import { test } from "node:test";
import assert from "node:assert/strict";
import { directedFloorGaps, buildModelAudit } from "./model-audit.mjs";
const node = (id, planId) => ({
  id,
  planId,
  kind: "stair-landing",
  point: { x: 0.5, y: 0.5 },
  version: 1,
});
function fixture() {
  return {
    publishedRevision: 1,
    modelConnections: {},
    plans: [{ id: "SW3-F1-p1", sourceSha256: "pdf", full: { sha256: "png" } }],
    stairPlaces: [],
    eligibility: { nodeIds: ["a", "b"], edgeIds: ["e"] },
    document: {
      nodes: [node("a", "SW3-F1-p1"), node("b", "SW3-F2-p1")],
      edges: [
        {
          id: "e",
          kind: "stairs",
          fromNodeId: "b",
          toNodeId: "a",
          direction: "forward",
          version: 1,
        },
      ],
    },
  };
}
test("one-way reviewed stairs do not silently become bidirectional", () => {
  const s = fixture();
  const gap = directedFloorGaps(s).gaps.find((g) => g.from === "SW3-F1-p1");
  assert.deepEqual(gap.missingDirections, [
    { from: "SW3-F1-p1", to: "SW3-F2-p1" },
  ]);
  assert.ok(directedFloorGaps(s).gaps.every((g) => !g.to.includes("F5")));
});
test("ineligible edges cannot satisfy missing directions", () => {
  const s = fixture();
  s.eligibility.edgeIds = [];
  assert.equal(
    directedFloorGaps(s).gaps.find((g) => g.from === "SW3-F1-p1")
      .missingDirections.length,
    2,
  );
});
test("stale image detections are withheld and audit never mutates the map", () => {
  const s = fixture();
  const before = JSON.stringify(s);
  const baseline = {
    plans: [
      {
        planId: "SW3-F1-p1",
        imageSize: 1280,
        sourceSha256: "stale",
        detections: [
          {
            class: "parking",
            xyxyNormalized: [0.4, 0.4, 0.6, 0.6],
            confidence: 0.9,
          },
        ],
        width: 1000,
        height: 1000,
      },
    ],
  };
  const audit = buildModelAudit(s, baseline, {}, {});
  assert.equal(audit.floors[4].valid, false);
  assert.equal(audit.floors[4].candidates.length, 0);
  assert.equal(audit.routingChanges, 0);
  assert.equal(JSON.stringify(s), before);
});

test("unknown local-model floors are rejected without creating new graph scope", () => {
  const audit = buildModelAudit(
    fixture(),
    { plans: [] },
    {},
    { message: { content: "Review SW3-F5 and SE12-F1." } },
  );
  assert.deepEqual(audit.rejectedModelFloors, ["SW3-F5-p1"]);
  assert.equal(audit.floors.length, 8);
});

test("secondary model answers must bind to the same source crop", () => {
  const s = fixture();
  const o = {
    id: "case",
    planId: "SW3-F1-p1",
    sourceSha256: "pdf",
    imageSha256: "png",
    bounds: [0.1, 0.1, 0.2, 0.2],
    output: { classification: "stair-flight" },
  };
  const stale = {
    ...o,
    sourceSha256: "old",
    output: { classification: "not-stair-flight" },
  };
  const audit = buildModelAudit(
    s,
    { plans: [] },
    {},
    {},
    { observations: [o] },
    { observations: [stale] },
    { observations: [stale] },
    {},
  );
  assert.equal(audit.expandedChecks[0].secondOutput, null);
  assert.equal(audit.expandedChecks[0].gemmaOutput, null);
  assert.equal(audit.expandedChecks[0].disagreement, false);
});

import { buildRelationshipQuestions } from "./relationship-questions.mjs";
test("relationship drafts never adopt answers and suppress stale source eligibility", () => {
  const s = fixture();
  const definitions = {
    sourceRevision: 1,
    questions: [
      {
        id: "q",
        from: {
          planId: "SW3-F1-p1",
          sourceSha256: "pdf",
          point: null,
          node: null,
        },
        to: null,
        answer: true,
        permittedDirection: "both",
      },
    ],
  };
  const current = buildRelationshipQuestions(s, definitions)[0];
  assert.equal(current.currentSource, true);
  assert.equal(current.answer, null);
  assert.equal(current.permittedDirection, null);
  assert.equal(current.routeEligible, false);
  assert.equal(current.from.point, null);
  s.plans[0].sourceSha256 = "changed";
  assert.equal(
    buildRelationshipQuestions(s, definitions)[0].currentSource,
    false,
  );
});
test("changed endpoint positions invalidate direction review even if version is unchanged", () => {
  const s = fixture();
  s.document.nodes[0].sourceSha256 = "pdf";
  const definitions = {
    sourceRevision: 1,
    questions: [
      {
        id: "q",
        from: {
          planId: "SW3-F1-p1",
          sourceSha256: "pdf",
          point: { x: 0.5, y: 0.5 },
          node: { id: "a", version: 1, point: { x: 0.5, y: 0.5 } },
        },
        to: null,
      },
    ],
  };
  assert.equal(
    buildRelationshipQuestions(s, definitions)[0].currentSource,
    true,
  );
  s.document.nodes[0].point.x = 0.6;
  assert.equal(
    buildRelationshipQuestions(s, definitions)[0].currentSource,
    false,
  );
});

test("tiled comparisons use explicit resolution and reject stale source images", () => {
  const snapshot = fixture();
  const before = JSON.stringify(snapshot);
  const report = {
    plans: [
      {
        planId: "SW3-F1-p1",
        imageSize: 1024,
        width: 2000,
        height: 2000,
        sourceSha256: "png",
        detections: [
          {
            class: "parking",
            confidence: 0.8,
            xyxyNormalized: [0.45, 0.45, 0.55, 0.55],
          },
        ],
      },
    ],
  };
  const compare = () =>
    buildModelAudit(snapshot, report, {}, {}, {}, {}, {}, {}, 1024).floors[4];
  assert.equal(
    buildModelAudit(snapshot, report, {}, {}).floors[4].valid,
    false,
  );
  assert.equal(compare().landingsNearCandidate, 1);
  assert.equal(compare().candidates[0].rawClass, "parking");
  report.plans[0].sourceSha256 = "stale";
  assert.equal(compare().candidates.length, 0);
  assert.equal(JSON.stringify(snapshot), before);
});
