/** User-confirmed display-only transfers. Never writes to the sibling routing project. */
const source3 =
  "521d90e70cda6b4fd58c0e00219fdcefb8ff605787b36bf383d124a129e794f1";
const source4 =
  "d73872a56148fc1e6ac5592277e8ffb0b575ced1c501a1f5c939f7fa9bae88fb";
const confirmations = [
  {
    from: "9e4d3f61-332e-4d27-8838-65a7596cb304",
    labels: "S300 ↔ S400",
    to: "S400",
    expected: [0.085294, 0.491667],
    point: { x: 0.0752, y: 0.492 },
    note: "Door between S400 and corridor 402C on the fourth-floor drawing.",
  },
  {
    from: "92a95623-7e31-42e9-8228-2b6a77874045",
    labels: "S313 ↔ S413",
    to: "S413",
    expected: [0.388725, 0.325],
    point: { x: 0.3814, y: 0.3222 },
    note: "Door from corridor 407C into S413, west of shaft 413Z on the fourth-floor drawing.",
  },
  {
    from: "7a8b0223-e542-45a2-970a-f6be66765db4",
    labels: "S327 ↔ S418",
    to: "S418",
    expected: [0.735294, 0.369697],
    point: { x: 0.738, y: 0.474 },
    note: "Lower drawn end of S418 at corridor 418T on the fourth-floor drawing; approximate display anchor.",
  },
  {
    from: "f9d700f2-9e8b-4bcb-93a0-055cf1c585cb",
    labels: "S328 ↔ S428",
    to: "S428",
    expected: [0.773529, 0.607576],
    point: { x: 0.7745, y: 0.6126 },
    note: "Door from corridor 429A into S428 beside 418G ELEC on the fourth-floor drawing.",
  },
];
export function addModelConnections(
  document: any,
  plans: any[],
  recordHash: (record: any) => string,
) {
  const report = {
    scope: "3D Model only",
    confirmedOn: "2026-11-18",
    added: [] as string[],
    skipped: [] as string[],
  };
  const current = (id: string, hash: string) =>
    plans.some((p) => p.id === id && p.sourceSha256 === hash);
  const timestamp = "2026-11-18T00:00:00.000Z"; // Date-only confirmation, not an asserted field visit time.
  function reviewed(record: any) {
    const review = {
      status: "verified",
      reviewer: "User confirmation in 3D Model chat",
      note: record.evidence.note,
      reviewedAt: timestamp,
      recordVersion: record.version,
      contentHash: recordHash(record),
      evidence: { ...record.evidence },
    };
    return { ...record, review, reviewHistory: [review] };
  }
  for (const [index, c] of confirmations.entries()) {
    const from = document.nodes.find((n: any) => n.id === c.from);
    if (
      !current("SE12-F3-p1", source3) ||
      !current("SE12-F4-p1", source4) ||
      !from ||
      from.sourceSha256 !== source3 ||
      from.version !== 1 ||
      from.point.x !== c.expected[0] ||
      from.point.y !== c.expected[1]
    ) {
      report.skipped.push(
        c.labels + ": source or third-floor endpoint changed; review required.",
      );
      continue;
    }
    const suffix = String(index + 1).padStart(12, "0");
    const nodeId = "3d000004-0000-4000-8000-" + suffix;
    const edgeId = "3d000034-0000-4000-8000-" + suffix;
    if (document.edges.some((e: any) => e.id === edgeId)) continue;
    const evidence = {
      basis: "user-confirmation",
      observedOn: null,
      note:
        "3D Model only. User explicitly confirmed " +
        c.labels +
        " connects in both directions on 2026-11-18. Fourth-floor marker independently read from its source drawing; approximate display position, not field-verified. " +
        c.note,
    };
    const fields = {
      version: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      notes: "Display-only overlay; excluded from main application routing.",
      evidence,
      review: null,
      reviewHistory: [],
    };
    document.nodes.push(
      reviewed({
        ...fields,
        id: nodeId,
        planId: "SE12-F4-p1",
        sourceSha256: source4,
        label: c.to + " · fourth-floor stair landing (3D Model)",
        kind: "stair-landing",
        point: c.point,
      }),
    );
    document.edges.push(
      reviewed({
        ...fields,
        id: edgeId,
        fromNodeId: from.id,
        toNodeId: nodeId,
        kind: "stairs",
        direction: "both",
        endpointVersions: { from: from.version, to: 1 },
        distanceMeters: null,
        distanceEvidence: "",
      }),
    );
    report.added.push(edgeId);
  }
  return report;
}
