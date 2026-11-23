/** Orthographic 3D inspection of original sheets; display coordinates never become routing data. */
import {
  relationshipColors,
  rotatePoint,
  wrapAngle,
  zoomPan,
  matchesFloorPair,
} from "./view-math.ts";
import { sourceOrientation } from "./sheet-orientation.ts";
type Point = { x: number; y: number };
type Plan = {
  id: string;
  building: string;
  floor: string;
  width: number;
  height: number;
  sourceUrl: string;
  sourceSha256: string;
};
type Node = {
  id: string;
  planId: string;
  label: string;
  point: Point;
  kind: string;
  version: number;
  evidence: unknown;
};
type Edge = {
  path?: Point[];
  id: string;
  fromNodeId: string;
  toNodeId: string;
  direction: string;
  kind: string;
  evidence: unknown;
};
type Place = {
  label: string;
  kind: string;
  bounds: number[];
  cells: number[];
  doors: unknown[];
};
type Floor = {
  width: number;
  height: number;
  runs: number[][];
  places: Place[];
};
type Snapshot = {
  source: string;
  publishedRevision: number;
  modelConnections?: { added: string[]; skipped: string[] };
  plans: Plan[];
  document: { revision: number; nodes: Node[]; edges: Edge[] };
  eligibility: {
    nodeIds: string[];
    edgeIds: string[];
    issues: { id: string; reason: string }[];
  };
  coverage: {
    planId: string;
    placeOccurrences: number;
    withFloorApproach: number;
    missingFloorApproach: { kind: string }[];
  }[];
  candidates: { title?: string; state: string; [key: string]: unknown }[];
};
const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const control = (id: string) => element<HTMLInputElement>(id);
const select = (id: string) => element<HTMLSelectElement>(id);
const value = (id: string) => Number(control(id).value);
const canvas = element<HTMLCanvasElement>("scene"),
  ctx = canvas.getContext("2d")!;
let data: Snapshot,
  selected = "",
  pan = { x: 0, y: 0 },
  labelPin: { planId: string; point: Point } | undefined;
const images = new Map<string, HTMLImageElement>(),
  floors = new Map<string, Floor>(),
  overlays = new Map<string, HTMLCanvasElement>();
let hits: { node: Node; point: Point }[] = [],
  generation = 0;
const manualOrientations = new Map<string, number>();
function sheetAngle(plan: Plan) {
  return (
    manualOrientations.get(plan.id) ??
    (control("north-up").checked ? (sourceOrientation(plan)?.degrees ?? 0) : 0)
  );
}
function orientationControls() {
  const plan = data.plans.find(
    (p) => p.id === select("orientation-sheet").value,
  );
  if (!plan) return;
  control("sheet-angle").value = String(sheetAngle(plan));
  const source = sourceOrientation(plan);
  element("orientation-note").textContent = manualOrientations.has(plan.id)
    ? "Manual display rotation; not verified geographic alignment."
    : control("north-up").checked && source
      ? source.note
      : source
        ? "Original sheet orientation."
        : "No reviewed north-symbol reading for this sheet. Original orientation retained.";
}
async function json(url: string) {
  const r = await fetch(url);
  const body = await r.json();
  if (!r.ok) throw Error(body.error || r.statusText);
  return body;
}
function option(parent: HTMLSelectElement, label: string, value: string) {
  parent.add(new Option(label, value));
}
function shownPlans() {
  const buildings = select("building").value.split(",");
  return data.plans.filter(
    (p) =>
      buildings.includes(p.building) &&
      matchesFloorPair(
        p.id,
        select("floor").value,
        select("compare-floor").value,
      ),
  );
}
function point3(plan: Plan, point: Point) {
  const buildings = select("building").value.split(",");
  const rotated = rotatePoint(
    {
      x: (point.x - 0.5) * 720,
      y: ((point.y - 0.5) * 720 * plan.height) / plan.width,
      z: 0,
    },
    sheetAngle(plan),
    0,
    0,
  );
  // Separate sheets by arbitrary display units. Neither this spacing nor equal sheet widths imply metric alignment.
  return {
    x:
      (buildings.indexOf(plan.building) - (buildings.length - 1) / 2) * 850 +
      rotated.x,
    y: rotated.y,
    z:
      (Number(plan.floor) -
        shownPlans().reduce((sum, p) => sum + Number(p.floor), 0) /
          Math.max(1, shownPlans().length)) *
      value("gap"),
  };
}
function project(plan: Plan, point: Point): Point {
  const p = rotatePoint(
    point3(plan, point),
    value("orbit"),
    value("tilt"),
    value("roll"),
  );
  const scale =
    (Math.min(
      canvas.clientWidth /
        (select("building").value.includes(",") ? 1900 : 1100),
      canvas.clientHeight / 1150,
    ) *
      value("zoom")) /
    90;
  return {
    x: canvas.clientWidth / 2 + pan.x + p.x * scale,
    y: canvas.clientHeight / 2 + pan.y + p.y * scale,
  };
}
function sheet(plan: Plan) {
  const a = project(plan, { x: 0, y: 0 }),
    b = project(plan, { x: 1, y: 0 }),
    c = project(plan, { x: 0, y: 1 });
  ctx.save();
  ctx.transform(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y, a.x, a.y);
  ctx.globalAlpha = value("opacity") / 100;
  const image = images.get(plan.id);
  if (image) ctx.drawImage(image, 0, 0, 1, 1);
  else {
    ctx.fillStyle = "#b7c7cf";
    ctx.fillRect(0, 0, 1, 1);
  }
  ctx.globalAlpha = 0.65;
  if (control("grid").checked && overlays.has(plan.id))
    ctx.drawImage(overlays.get(plan.id)!, 0, 0, 1, 1);
  ctx.restore();
  ctx.fillStyle = "#d5e5f5";
  ctx.font = "12px system-ui";
  const aligned =
    control("north-up").checked &&
    sourceOrientation(plan) &&
    !manualOrientations.has(plan.id);
  ctx.fillText(
    plan.building +
      " · floor " +
      plan.floor +
      (aligned ? " · N ↑ in sheet plane" : " · orientation unaligned"),
    a.x,
    a.y - 7,
  );
}
function line(from: Point, to: Point, both: boolean, bends: Point[] = []) {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  for (const p of bends) ctx.lineTo(p.x, p.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  const arrow = (a: Point, b: Point) => {
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - 9 * Math.cos(angle - 0.4),
      b.y - 9 * Math.sin(angle - 0.4),
    );
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - 9 * Math.cos(angle + 0.4),
      b.y - 9 * Math.sin(angle + 0.4),
    );
    ctx.stroke();
  };
  arrow(bends.at(-1) ?? from, to);
  if (both) arrow(bends[0] ?? to, from);
}
function draw() {
  if (!data) return;
  const ratio = devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * ratio;
  canvas.height = canvas.clientHeight * ratio;
  ctx.scale(ratio, ratio);
  hits = [];
  // Reorder translucent sheets when viewing the stack from underneath.
  const depth = (plan: Plan) =>
    rotatePoint(
      point3(plan, { x: 0.5, y: 0.5 }),
      value("orbit"),
      value("tilt"),
      value("roll"),
    ).depth;
  const plans = shownPlans().sort((a, b) => depth(a) - depth(b));
  plans.forEach(sheet);
  const map = new Map(plans.map((p) => [p.id, p])),
    nodes = new Map(data.document.nodes.map((n) => [n.id, n]));
  for (const edge of data.document.edges) {
    const approved = data.eligibility.edgeIds.includes(edge.id);
    if (!approved && !control("unapproved").checked) continue;
    const a = nodes.get(edge.fromNodeId),
      b = nodes.get(edge.toNodeId);
    if (!a || !b || !map.has(a.planId) || !map.has(b.planId)) continue;
    ctx.strokeStyle = relationshipColors[edge.kind]?.color ?? "#c7d1df";
    ctx.shadowColor = selected === edge.id ? "#ffffff" : "transparent";
    ctx.shadowBlur = selected === edge.id ? 8 : 0;
    ctx.lineWidth = selected === edge.id ? 4 : 2;
    ctx.setLineDash(approved ? [] : [5, 6]);
    line(
      project(map.get(a.planId)!, a.point),
      project(map.get(b.planId)!, b.point),
      edge.direction === "both",
      edge.path?.slice(1, -1).map((p) => project(map.get(a.planId)!, p)),
    );
  }
  ctx.shadowBlur = 0;
  ctx.setLineDash([]);
  for (const node of data.document.nodes) {
    if (!map.has(node.planId)) continue;
    const approved = data.eligibility.nodeIds.includes(node.id);
    if (!approved && !control("unapproved").checked) continue;
    const point = project(map.get(node.planId)!, node.point);
    hits.push({ node, point });
    ctx.fillStyle = approved ? "#67dfef" : "#edb967";
    ctx.beginPath();
    ctx.arc(point.x, point.y, selected === node.id ? 7 : 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (labelPin && map.has(labelPin.planId)) {
    const p = project(map.get(labelPin.planId)!, labelPin.point);
    ctx.strokeStyle = "#ff86d1";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
    ctx.stroke();
  }
}
function inspect(record: Node | Edge) {
  selected = record.id;
  const issue = data.eligibility.issues.find((i) => i.id === record.id);
  const nodes =
    "fromNodeId" in record
      ? data.document.nodes.filter(
          (n) => n.id === record.fromNodeId || n.id === record.toNodeId,
        )
      : [record];
  const details = {
    status:
      issue?.reason ||
      "Current eligible approval (not necessarily a field visit)",
    ...record,
    sources: nodes.map((n) => {
      const p = data.plans.find((p) => p.id === n.planId)!;
      return {
        label: n.label,
        planId: n.planId,
        point: n.point,
        sourceSha256: p.sourceSha256,
        sourceUrl: p.sourceUrl,
      };
    }),
  };
  element("detail").textContent = JSON.stringify(details, null, 2);
  draw();
}
function coverage() {
  const ids = new Set(shownPlans().map((p) => p.id));
  const rows = data.coverage.filter((c) => ids.has(c.planId));
  element("coverage").replaceChildren();
  for (const row of rows) {
    const p = document.createElement("p");
    const nodeIds = data.document.nodes
      .filter((n) => n.planId === row.planId)
      .map((n) => n.id);
    const count = data.document.edges.filter(
      (e) =>
        data.eligibility.edgeIds.includes(e.id) &&
        (nodeIds.includes(e.fromNodeId) || nodeIds.includes(e.toNodeId)),
    ).length;
    const missing = Object.entries(
      row.missingFloorApproach.reduce((out: Record<string, number>, p) => {
        out[p.kind] = (out[p.kind] || 0) + 1;
        return out;
      }, {}),
    )
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    p.textContent = `${row.planId}: ${row.withFloorApproach}/${row.placeOccurrences} source occurrences with floor approaches; ${count} eligible connections. Missing approaches: ${missing || "none"}.`;
    element("coverage").append(p);
  }
  element("totals").textContent =
    `Inventory: ${data.plans.length} plans in ${new Set(data.plans.map((p) => p.building)).size} buildings. A floor approach does not prove a complete connected route.`;
  select("connections").replaceChildren(
    new Option("Select a saved connection", ""),
  );
  for (const edge of data.document.edges) {
    const a = data.document.nodes.find((n) => n.id === edge.fromNodeId)!,
      b = data.document.nodes.find((n) => n.id === edge.toNodeId)!;
    if (!ids.has(a.planId) && !ids.has(b.planId)) continue;
    option(
      select("connections"),
      `${data.eligibility.edgeIds.includes(edge.id) ? "✓" : "?"} ${a.planId} ${a.label} ${edge.direction === "both" ? "↔" : "→"} ${b.planId} ${b.label} · ${edge.kind}`,
      edge.id,
    );
  }
  element("questions").replaceChildren();
  for (const candidate of data.candidates) {
    if (candidate.state === "confirmed") continue;
    const p = document.createElement("p");
    p.textContent = JSON.stringify(candidate, null, 2);
    element("questions").append(p);
  }
}
async function loadSheets() {
  const current = ++generation;
  coverage();
  draw();
  try {
    await Promise.all(
      shownPlans().map(async (plan) => {
        if (!images.has(plan.id)) {
          const img = new Image();
          img.src = "/image?id=" + encodeURIComponent(plan.id);
          await img.decode();
          images.set(plan.id, img);
        }
        if (!floors.has(plan.id)) {
          const floor: Floor = await json(
            "/api/floor?id=" + encodeURIComponent(plan.id),
          );
          floors.set(plan.id, floor);
          const overlay = document.createElement("canvas");
          overlay.width = floor.width;
          overlay.height = floor.height;
          const c = overlay.getContext("2d")!;
          c.fillStyle = "#15b883";
          for (const [y, l, r] of floor.runs) c.fillRect(l, y, r - l + 1, 1);
          overlays.set(plan.id, overlay);
        }
        if (current === generation) draw();
      }),
    );
    if (current === generation)
      element("status").textContent =
        `${shownPlans().length} source sheets · schematic spacing · records loaded on demand`;
  } catch (e) {
    element("status").textContent = String(e);
  }
}
function buildingChanged() {
  select("floor").replaceChildren(new Option("All floors · exploded", "all"));
  for (const p of data.plans.filter((p) =>
    select("building").value.split(",").includes(p.building),
  ))
    option(select("floor"), p.id, p.id);
  select("compare-floor").replaceChildren(new Option("No second floor", ""));
  for (const p of data.plans.filter((p) =>
    select("building").value.split(",").includes(p.building),
  ))
    option(select("compare-floor"), p.id, p.id);
  select("orientation-sheet").replaceChildren();
  for (const p of data.plans.filter((p) =>
    select("building").value.split(",").includes(p.building),
  ))
    option(select("orientation-sheet"), p.id, p.id);
  orientationControls();
  labelPin = undefined;
  void loadSheets();
}
async function reload() {
  element("status").textContent = "Loading source records…";
  try {
    const next: Snapshot = await json(
      "/api/snapshot?source=" + select("source").value,
    );
    data = next;
    images.clear();
    floors.clear();
    overlays.clear();
    selected = "";
    element("revision").textContent = data.source.endsWith("navigation") ? `Navigation revision ${data.document.revision} · ${data.document.edges.length} visitor passages · ${data.document.nodes.length} checkpoints` :
      `${data.source} revision ${data.document.revision} · published revision ${data.publishedRevision} · ${data.modelConnections?.added.length ?? 0} model-only stair links${data.modelConnections?.skipped.length ? " · review needed: " + data.modelConnections.skipped.join("; ") : ""}`;
    select("building").replaceChildren(new Option("SW03 + SE12 + SW01", "SW3,SE12,SW1"), new Option("SW03 + SE12", "SW3,SE12"));
    for (const b of [...new Set(data.plans.map((p) => p.building))].sort())
      option(select("building"), b, b);
    buildingChanged();
  } catch (e) {
    element("status").textContent = String(e);
    element("revision").textContent =
      "Load failed — previously loaded view, if any, is unchanged.";
  }
}
element("search").onsubmit = async (event) => {
  event.preventDefault();
  const query = control("query").value.trim().toUpperCase();
  element("matches").replaceChildren();
  for (const plan of shownPlans()) {
    if (!floors.has(plan.id)) continue;
    for (const place of floors
      .get(plan.id)!
      .places.filter((p) => p.label.toUpperCase() === query)) {
      const button = document.createElement("button");
      button.textContent = `${plan.id} · ${place.label} · ${place.kind}`;
      button.onclick = () => {
        labelPin = {
          planId: plan.id,
          point: {
            x: (place.bounds[0] + place.bounds[2]) / 2,
            y: (place.bounds[1] + place.bounds[3]) / 2,
          },
        };
        element("detail").textContent = JSON.stringify(
          {
            notice: "Printed text location only; not a camera or route origin.",
            planId: plan.id,
            sourceSha256: plan.sourceSha256,
            ...place,
          },
          null,
          2,
        );
        draw();
      };
      element("matches").append(button);
    }
  }
  if (!element("matches").children.length)
    element("matches").textContent =
      "No exact match on the loaded visible sheets.";
};
for (const [kind, style] of Object.entries(relationshipColors)) {
  const row = document.createElement("div");
  row.textContent = `━ ${style.label}`;
  row.style.color = style.color;
  row.dataset.kind = kind;
  element("relationship-legend").append(row);
}
for (const id of [
  "gap",
  "orbit",
  "tilt",
  "roll",
  "zoom",
  "opacity",
  "grid",
  "unapproved",
])
  control(id).oninput = draw;
select("building").onchange = buildingChanged;
select("orientation-sheet").onchange = orientationControls;
control("sheet-angle").oninput = () => {
  manualOrientations.set(
    select("orientation-sheet").value,
    value("sheet-angle"),
  );
  orientationControls();
  draw();
};
control("north-up").onchange = () => {
  manualOrientations.clear();
  orientationControls();
  draw();
};
element("restore-orientation").onclick = () => {
  manualOrientations.delete(select("orientation-sheet").value);
  orientationControls();
  draw();
};
element("top-view").onclick = () => {
  control("orbit").value = "0";
  control("tilt").value = "0";
  control("roll").value = "0";
  pan = { x: 0, y: 0 };
  draw();
};
select("floor").onchange = () => {
  if (select("floor").value === "all") select("compare-floor").value = "";
  pan = { x: 0, y: 0 };
  void loadSheets();
};
select("compare-floor").onchange = () => {
  if (select("floor").value === "all" && select("compare-floor").value) {
    const other = Array.from(select("floor").options).find(
      (o) => o.value !== "all" && o.value !== select("compare-floor").value,
    );
    if (other) select("floor").value = other.value;
  }
  pan = { x: 0, y: 0 };
  void loadSheets();
};
function zoomAt(
  next: number,
  x = canvas.clientWidth / 2,
  y = canvas.clientHeight / 2,
) {
  const old = value("zoom");
  control("zoom").value = String(Math.max(25, Math.min(1200, next)));
  pan = zoomPan(
    pan,
    { x: x - canvas.clientWidth / 2, y: y - canvas.clientHeight / 2 },
    old,
    value("zoom"),
  );
  draw();
}
function fitPoints(points: Point[]) {
  if (!points.length) return;
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  const center = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const factor = Math.min(
    (canvas.clientWidth * 0.72) / Math.max(30, right - left),
    (canvas.clientHeight * 0.65) / Math.max(30, bottom - top),
  );
  zoomAt(value("zoom") * factor, center.x, center.y);
  pan.x += canvas.clientWidth / 2 - center.x;
  pan.y += canvas.clientHeight / 2 - center.y;
  draw();
}
element("fit-floors").onclick = () => {
  if (!data) return;
  fitPoints(
    shownPlans().flatMap((p) =>
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ].map((q) => project(p, q)),
    ),
  );
};
element("zoom-in").onclick = () => zoomAt(value("zoom") * 1.3);
element("zoom-out").onclick = () => zoomAt(value("zoom") / 1.3);
element("focus-link").onclick = async () => {
  if (!data) return;
  const edge = data.document.edges.find(
    (e) => e.id === selected || e.id === select("connections").value,
  );
  if (!edge) {
    element("status").textContent = "Select a connection, then focus it.";
    return;
  }
  const nodes = [edge.fromNodeId, edge.toNodeId].map((id) =>
    data.document.nodes.find((n) => n.id === id)!,
  );
  const plans = nodes.map((n) => data.plans.find((p) => p.id === n.planId)!);
  const buildings = [...new Set(plans.map((p) => p.building))].join(",");
  if (
    !Array.from(select("building").options).some((o) => o.value === buildings)
  )
    option(select("building"), buildings, buildings);
  select("building").value = buildings;
  buildingChanged();
  select("floor").value = plans[0].id;
  select("compare-floor").value =
    plans[1].id === plans[0].id ? "" : plans[1].id;
  control("tilt").value = "55";
  control("gap").value = "180";
  control("zoom").value = "90";
  pan = { x: 0, y: 0 };
  const loading = loadSheets();
  const request = generation;
  await loading;
  if (request !== generation) return;
  select("connections").value = edge.id;
  inspect(edge);
  fitPoints(nodes.map((n, i) => project(plans[i], n.point)));
};
select("source").onchange = reload;
element("reload").onclick = reload;
select("connections").onchange = () => {
  const edge = data.document.edges.find(
    (e) => e.id === select("connections").value,
  );
  if (edge) inspect(edge);
};
element("reset").onclick = () => {
  pan = { x: 0, y: 0 };
  control("orbit").value = "-18";
  control("tilt").value = "48";
  control("roll").value = "0";
  control("zoom").value = "90";
  draw();
};
let drag: { x: number; y: number; distance: number } | undefined;
canvas.onpointerdown = (e) => {
  drag = { x: e.clientX, y: e.clientY, distance: 0 };
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x,
    dy = e.clientY - drag.y;
  drag.distance += Math.abs(dx) + Math.abs(dy);
  if (e.shiftKey) {
    pan.x += dx;
    pan.y += dy;
  } else if (e.altKey) {
    control("roll").value = String(wrapAngle(value("roll") + dx * 0.3));
  } else {
    control("orbit").value = String(wrapAngle(value("orbit") + dx * 0.3));
    control("tilt").value = String(wrapAngle(value("tilt") + dy * 0.3));
  }
  drag.x = e.clientX;
  drag.y = e.clientY;
  draw();
};
canvas.onpointerup = (e) => {
  if (drag && drag.distance < 5) {
    const r = canvas.getBoundingClientRect();
    const hit = [...hits]
      .reverse()
      .find(
        (h) =>
          Math.hypot(
            h.point.x - e.clientX + r.left,
            h.point.y - e.clientY + r.top,
          ) < 12,
      );
    if (hit) inspect(hit.node);
  }
  drag = undefined;
};
canvas.onpointercancel = () => {
  drag = undefined;
};
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const delta =
      e.deltaY *
      (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? canvas.clientHeight : 1);
    zoomAt(
      value("zoom") * Math.exp(-Math.max(-400, Math.min(400, delta)) * 0.002),
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  },
  { passive: false },
);
new ResizeObserver(draw).observe(canvas);
void reload();
