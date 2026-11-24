/** Escaped, read-only experiment evidence. No inference or approval actions. */
const element = (tag, text, parent) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (parent) parent.append(e);
  return e;
};
const byId = (id) => document.getElementById(id);
const svgElement = (tag, attrs, parent) => {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.append(e);
  return e;
};
try {
  const response = await fetch("/api/model-audit");
  if (!response.ok) throw Error(await response.text());
  const audit = await response.json();
  byId("status").textContent =
    `Published revision ${audit.publishedRevision}; ${audit.graph.connections.length} eligible stair transfers including model-only confirmations. No weights fine-tuned. No routing changes.`;
  element("h2", "Relationships needing review", byId("gaps"));
  for (const gap of audit.graph.gaps) {
    element(
      "p",
      gap.missingDirections.map((d) => `${d.from} → ${d.to}`).join(" and ") +
        ": no eligible stair transfer in this direction. Missing records do not prove there are no physical stairs.",
      byId("gaps"),
    );
  }
  const questionSection = byId("questions");
  element("h2", "Source-linked relationship questions", questionSection);
  element(
    "p",
    "These are review drafts, not new links. Region crops are not landing points. Mark missing landings in Stair review, then confirm identity and permitted direction.",
    questionSection,
  );
  const download = element(
    "button",
    "Download unapproved review drafts",
    questionSection,
  );
  download.addEventListener("click", () => {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            publishedRevision: audit.publishedRevision,
            routeEligible: false,
            questions: audit.relationshipQuestions,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "relationship-review-drafts.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  for (const question of audit.relationshipQuestions) {
    const card = element("article", undefined, questionSection);
    card.className = "card";
    element("h3", question.question, card);
    element(
      "p",
      question.currentSource
        ? "Current source records; answer and additional permitted direction unknown."
        : "STALE — " + question.issues.join("; "),
      card,
    );
    const pair = element("div", undefined, card);
    pair.className = "grid";
    for (const side of ["from", "to"]) {
      const endpoint = question[side];
      const region = element("div", undefined, pair);
      if (!endpoint) {
        element(
          "p",
          "Corresponding landing not identified. A source-linked point is required.",
          region,
        );
        continue;
      }
      element("h4", endpoint.planId + " · " + endpoint.labelReading, region);
      if (question.currentSource && endpoint.cropFile) {
        const img = element("img", undefined, region);
        img.className = "crop";
        img.src = "/local-analysis/" + encodeURIComponent(endpoint.cropFile);
        img.alt =
          endpoint.planId +
          " source region; display rotation " +
          endpoint.rotation +
          " degrees";
      }
      const link = element("a", "Inspect complete source plan", region);
      link.href = "/image?id=" + encodeURIComponent(endpoint.planId);
      link.target = "_blank";
      link.rel = "noopener";
      element(
        "p",
        endpoint.node
          ? "Existing reviewed landing; point/version preserved."
          : "Unconfirmed identifier reading; accessible landing not marked.",
        region,
      );
    }
    const list = element("ul", undefined, card);
    for (const requirement of question.requiredEvidence)
      element("li", requirement, list);
    const detail = element("details", undefined, card);
    element(
      "summary",
      "Source hashes, regions and endpoint references",
      detail,
    );
    element("pre", JSON.stringify(question, null, 2), detail);
  }
  element("h2", "Coverage across all eight sheets", byId("coverage"));
  const table = element("table", undefined, byId("coverage"));
  const head = element("tr", undefined, table);
  for (const text of [
    "Sheet",
    "Reviewed landings",
    "Landings near raw candidate",
    "Raw candidates",
    "Source",
  ])
    element("th", text, head);
  for (const f of audit.floors) {
    const row = element("tr", undefined, table);
    for (const value of [
      f.planId,
      f.referenceLandings,
      f.landingsNearCandidate,
      f.candidates.length,
      f.valid ? "Hash current" : "Stale / withheld",
    ])
      element("td", String(value), row);
  }
  element(
    "p",
    "Nearby-landmark counts measure overlap with a partial reviewed reference set. They are not precision, recall, or proof of access.",
    byId("coverage"),
  );
  if (audit.tiled) {
    element("h2", "Tiled detector compared with current map", byId("tiled"));
    element(
      "p",
      "1024-pixel tiles, 768-pixel stride, rotations 0°/90°, confidence 0.25. Same 100-source-pixel review context as the baseline. Purple boxes below are tiled hypotheses; orange boxes are whole-page hypotheses. Neither establishes a route.",
      byId("tiled"),
    );
    const comparison = element("table", undefined, byId("tiled"));
    const header = element("tr", undefined, comparison);
    for (const label of [
      "Floor",
      "Reviewed landings",
      "Baseline nearby",
      "Tiled nearby",
      "Baseline / tiled candidates",
      "Source",
    ])
      element("th", label, header);
    for (const floor of audit.tiled.floors) {
      const baseline = audit.floors.find((f) => f.planId === floor.planId);
      const row = element("tr", undefined, comparison);
      for (const value of [
        floor.planId,
        floor.referenceLandings,
        baseline.landingsNearCandidate,
        floor.landingsNearCandidate,
        `${baseline.candidates.length} / ${floor.candidates.length}`,
        floor.valid ? "Hash current" : "Stale / withheld",
      ])
        element("td", String(value), row);
    }
  }
  element("h2", "Expanded local-model checks", byId("expanded"));
  element(
    "p",
    `${audit.expandedChecks.length} detector crops reviewed; ${audit.expandedChecks.filter((o) => o.disagreement).length} changed answers under a second prompt. Same model, not independent votes. Disagreements remain unresolved; no candidate is automatically discarded.`,
    byId("expanded"),
  );
  const expandedTable = element("table", undefined, byId("expanded"));
  const expandedHead = element("tr", undefined, expandedTable);
  for (const label of [
    "Crop",
    "Original prompt",
    "Partial-flight prompt",
    "Gemma second opinion",
    "Review status",
  ])
    element("th", label, expandedHead);
  for (const o of audit.expandedChecks) {
    const row = element("tr", undefined, expandedTable);
    const cell = element("td", undefined, row);
    const link = element("a", o.id, cell);
    link.href =
      "/local-analysis/model-shapes-all/" + encodeURIComponent(o.id) + ".png";
    link.target = "_blank";
    link.rel = "noopener";
    element("td", o.output?.classification || "failed", row);
    element("td", o.secondOutput?.classification || "not retested", row);
    element("td", o.gemmaOutput?.classification || "not tested", row);
    element(
      "td",
      !o.currentSource
        ? "STALE"
        : o.disagreement
          ? "Disagreement — review required"
          : "Unverified model observation",
      row,
    );
  }
  for (const o of audit.shapes.observations) {
    const card = element("article", undefined, byId("shapes"));
    card.className = "card";
    element("h3", o.planId, card);
    const image = element("img", undefined, card);
    image.className = "crop";
    image.src =
      "/local-analysis/model-shapes/" + encodeURIComponent(o.id) + ".png";
    image.alt = "Original source crop for " + o.planId;
    element(
      "p",
      `Raw detector: ${o.rawDetectorClass}. Local shape check: ${o.currentSource ? o.output?.classification || "failed" : "STALE — withheld"}`,
      card,
    );
    element("p", o.output?.visibleEvidence || o.error, card);
    element(
      "small",
      `Local model: ${audit.shapes.model}. No connection inference.`,
      card,
    );
  }
  for (const f of audit.floors) {
    const card = element("article", undefined, byId("floors"));
    card.className = "card";
    element("h3", f.planId, card);
    const link = element("a", "Open source image", card);
    link.href = "/image?id=" + encodeURIComponent(f.planId);
    link.target = "_blank";
    link.rel = "noopener";
    const sheet = element("div", undefined, card);
    sheet.className = "sheet";
    const img = element("img", undefined, sheet);
    img.src = link.href;
    img.alt = f.planId + " official source plan";
    const svg = svgElement(
      "svg",
      { viewBox: "0 0 1 1", preserveAspectRatio: "none" },
      sheet,
    );
    for (const c of f.candidates) {
      const [x, y, r, b] = c.bounds;
      svgElement(
        "rect",
        {
          x,
          y,
          width: r - x,
          height: b - y,
          fill: "none",
          stroke: "#ed8b23",
          "stroke-width": 2,
          "vector-effect": "non-scaling-stroke",
        },
        svg,
      );
    }
    const tiledCandidates =
      audit.tiled?.floors.find((t) => t.planId === f.planId)?.candidates || [];
    const tiledLayer = svgElement("g", {}, svg);
    for (const c of tiledCandidates) {
      const [x, y, r, b] = c.bounds;
      const rect = svgElement(
        "rect",
        {
          x,
          y,
          width: r - x,
          height: b - y,
          fill: "none",
          stroke: "#b04fe0",
          "stroke-width": 2,
          "vector-effect": "non-scaling-stroke",
        },
        tiledLayer,
      );
      svgElement("title", {}, rect).textContent =
        `Tiled ${c.rawClass}: ${c.confidence.toFixed(2)}`;
    }
    if (audit.tiled) {
      const toggle = element("button", "Hide tiled boxes", card);
      toggle.onclick = () => {
        const hidden = tiledLayer.getAttribute("display") === "none";
        tiledLayer.setAttribute("display", hidden ? "inline" : "none");
        toggle.textContent = hidden ? "Hide tiled boxes" : "Show tiled boxes";
      };
      const detail = element("details", undefined, card);
      element(
        "summary",
        `${tiledCandidates.length} tiled hypotheses (raw labels)`,
        detail,
      );
      const list = element("ul", undefined, detail);
      for (const c of tiledCandidates)
        element(
          "li",
          `${c.rawClass} ${c.confidence.toFixed(2)}; nearby reviewed landings: ${c.nearbyLandings.length}; source labels: ${c.sourceLabels.join(", ") || "none"}`,
          list,
        );
    }
    for (const n of audit.graph.nodes.filter((n) => n.planId === f.planId))
      svgElement(
        "circle",
        { cx: n.point.x, cy: n.point.y, r: 0.005, fill: "#00a6bd" },
        svg,
      );
    const list = element("ul", undefined, card);
    for (const c of f.candidates)
      element(
        "li",
        `${c.rawClass} ${c.confidence.toFixed(2)} — source labels in context: ${c.sourceLabels.join(", ") || "none"}; reviewed landings nearby: ${c.nearbyLandings.length}. ${c.status}`,
        list,
      );
    if (!f.candidates.length)
      element("p", "No usable raw candidates at this setting.", card);
  }
  byId("reject").textContent =
    "Rejected unknown floor references: " +
    (audit.rejectedModelFloors.join(", ") || "none") +
    ". The direction checks above are computed from eligible records, not from this local-model text.";
  byId("raw").textContent = audit.localGraphAudit;
  for (const limit of audit.limitations) element("li", limit, byId("limits"));
} catch (error) {
  byId("status").textContent = "Review unavailable: " + String(error);
}
