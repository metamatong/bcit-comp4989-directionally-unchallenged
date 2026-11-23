/** Read-only experiment audit. Page geometry and model suggestions never approve edges. */
export const experimentFloorIds = ["SE12", "SW3"].flatMap((b) =>
  [1, 2, 3, 4].map((f) => `${b}-F${f}-p1`),
);
export function directedFloorGaps(snapshot) {
  const eligibleNodes = new Set(snapshot.eligibility.nodeIds);
  const eligibleEdges = new Set(snapshot.eligibility.edgeIds);
  const nodes = snapshot.document.nodes.filter(
    (n) =>
      eligibleNodes.has(n.id) &&
      n.kind === "stair-landing" &&
      experimentFloorIds.includes(n.planId),
  );
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const arcs = new Set();
  const connections = [];
  for (const edge of snapshot.document.edges) {
    if (!eligibleEdges.has(edge.id) || edge.kind !== "stairs") continue;
    const a = byId.get(edge.fromNodeId),
      b = byId.get(edge.toNodeId);
    if (!a || !b) continue;
    if (["forward", "both"].includes(edge.direction))
      arcs.add(`${a.planId}>${b.planId}`);
    if (["reverse", "both"].includes(edge.direction))
      arcs.add(`${b.planId}>${a.planId}`);
    connections.push({
      id: edge.id,
      from: a,
      to: b,
      direction: edge.direction,
      version: edge.version,
    });
  }
  const gaps = [];
  for (const building of ["SE12", "SW3"])
    for (let floor = 1; floor < 4; floor++) {
      const a = `${building}-F${floor}-p1`,
        b = `${building}-F${floor + 1}-p1`;
      const missingDirections = [];
      if (!arcs.has(`${a}>${b}`)) missingDirections.push({ from: a, to: b });
      if (!arcs.has(`${b}>${a}`)) missingDirections.push({ from: b, to: a });
      if (missingDirections.length)
        gaps.push({
          from: a,
          to: b,
          missingDirections,
          status:
            "Missing reviewed records, not proof of absent physical stairs",
        });
    }
  return { nodes, connections, gaps };
}
function finiteBox(bounds) {
  return (
    Array.isArray(bounds) &&
    bounds.length === 4 &&
    bounds.every((v) => Number.isFinite(v) && v >= 0 && v <= 1) &&
    bounds[0] < bounds[2] &&
    bounds[1] < bounds[3]
  );
}
function overlaps(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}
export function buildModelAudit(
  snapshot,
  baseline,
  shapes,
  localAudit,
  allShapes = {},
  recheck = {},
  gemmaDiagnostic = {},
  gemmaRecheck = {},
  detectorImageSize = 1280,
) {
  const graph = directedFloorGaps(snapshot);
  const floors = experimentFloorIds.map((planId) => {
    const plan = snapshot.plans.find((p) => p.id === planId);
    const raw = baseline.plans.find(
      (p) => p.planId === planId && p.imageSize === detectorImageSize,
    );
    const valid = !!plan && !!raw && raw.sourceSha256 === plan.full.sha256;
    const places =
      snapshot.stairPlaces.find((p) => p.planId === planId)?.places || [];
    const landings = graph.nodes.filter((n) => n.planId === planId);
    const candidates = valid
      ? raw.detections
          .filter(
            (d) =>
              ["parking", "stair", "elevator", "escalator"].includes(d.class) &&
              finiteBox(d.xyxyNormalized),
          )
          .map((d, index) => {
            const bounds = d.xyxyNormalized;
            // 100 source pixels are a review-context window, never physical distance or a doorway claim.
            const context = [
              Math.max(0, bounds[0] - 100 / raw.width),
              Math.max(0, bounds[1] - 100 / raw.height),
              Math.min(1, bounds[2] + 100 / raw.width),
              Math.min(1, bounds[3] + 100 / raw.height),
            ];
            const sourceLabels = [
              ...new Set(
                places
                  .filter(
                    (p) =>
                      /^S\d+[A-Z]?$/.test(p.label) &&
                      finiteBox(p.bounds) &&
                      overlaps(context, p.bounds),
                  )
                  .map((p) => p.label),
              ),
            ];
            const nearbyLandings = landings
              .filter(
                (n) =>
                  n.point.x >= context[0] &&
                  n.point.x <= context[2] &&
                  n.point.y >= context[1] &&
                  n.point.y <= context[3],
              )
              .map((n) => n.id);
            return {
              id: `${planId}:${index}`,
              rawClass: d.class,
              confidence: d.confidence,
              bounds,
              context,
              sourceLabels,
              nearbyLandings,
              status:
                d.class === "parking"
                  ? "Stair-shape hypothesis only; class mapping unresolved"
                  : "Raw detector output; unverified",
            };
          })
      : [];
    const matched = new Set(candidates.flatMap((c) => c.nearbyLandings));
    return {
      planId,
      sourceSha256: plan?.sourceSha256,
      imageSha256: plan?.full.sha256,
      valid,
      candidates,
      referenceLandings: landings.length,
      landingsNearCandidate: matched.size,
      zeroReference: landings.length === 0,
      sourceStairLabels: places.length,
    };
  });
  const validShapes = (shapes?.observations || []).map((o) => ({
    ...o,
    currentSource: snapshot.plans.some(
      (p) =>
        p.id === o.planId &&
        p.sourceSha256 === o.sourceSha256 &&
        p.full.sha256 === o.imageSha256,
    ),
  }));
  const sameEvidence = (a, b) =>
    a &&
    b &&
    a.id === b.id &&
    a.sourceSha256 === b.sourceSha256 &&
    a.imageSha256 === b.imageSha256 &&
    JSON.stringify(a.bounds) === JSON.stringify(b.bounds);
  const expandedChecks = (allShapes.observations || []).map((o) => {
    const second = (recheck.observations || []).find((r) => sameEvidence(r, o));
    const gemma = [
      ...(gemmaRecheck.observations || []),
      ...(gemmaDiagnostic.observations || []),
    ].find((r) => sameEvidence(r, o));
    const currentSource = snapshot.plans.some(
      (p) =>
        p.id === o.planId &&
        p.sourceSha256 === o.sourceSha256 &&
        p.full.sha256 === o.imageSha256,
    );
    return {
      ...o,
      currentSource,
      secondOutput: second?.output || null,
      gemmaOutput: gemma?.output || null,
      disagreement:
        !!second?.output &&
        second.output.classification !== o.output?.classification,
    };
  });
  return {
    expandedChecks,
    comparisonModel: gemmaDiagnostic.model,
    comparisonDigest: gemmaDiagnostic.modelDigest,
    createdAt: new Date().toISOString(),
    publishedRevision: snapshot.publishedRevision,
    modelConnections: snapshot.modelConnections,
    graph,
    floors,
    shapes: {
      model: shapes?.model,
      digest: shapes?.modelDigest,
      observations: validShapes,
    },
    localGraphAudit: localAudit?.message?.content || "",
    limitations: [
      "No model weights were fine-tuned. This is evidence filtering and model evaluation.",
      "Reviewed landings are a partial reference set, not a complete stair census or held-out accuracy benchmark.",
      "Nearby printed labels and detection boxes do not establish accessible landings or inter-floor identity.",
      "Missing directions require source review and explicit confirmation. No approved graph was changed.",
    ],
    rejectedModelFloors: [
      ...new Set(
        (localAudit?.message?.content || "").match(
          /(?:SE12|SW3)-F\d+(?:-p1)?/g,
        ) || [],
      ),
    ]
      .map((id) => (id.endsWith("-p1") ? id : id + "-p1"))
      .filter((id) => !experimentFloorIds.includes(id)),
    routingChanges: 0,
  };
}
