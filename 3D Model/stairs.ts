/** Floor-by-floor stair evidence board. Pair drafts deliberately do not mutate routable topology. */
import { pairProblem, type StairMarker } from "./stair-review.ts";
type Plan = {
  id: string;
  building: string;
  floor: string;
  sourceSha256: string;
  sourceUrl: string;
  width: number;
  height: number;
};
type Node = {
  id: string;
  planId: string;
  sourceSha256: string;
  label: string;
  kind: string;
  version: number;
  point: { x: number; y: number };
};
type Endpoint = Omit<Node, "id" | "version">;
type Data = {
  plans: Plan[];
  document: {
    revision: number;
    nodes: Node[];
    edges: {
      id: string;
      kind: string;
      direction: string;
      fromNodeId: string;
      toNodeId: string;
    }[];
  };
  eligibility: { nodeIds: string[]; edgeIds: string[] };
  candidates: {
    id: string;
    title: string;
    kind: string;
    state: string;
    from: Endpoint;
    to: Endpoint;
  }[];
  stairPlaces: {
    planId: string;
    places: { id: string; label: string; bounds: number[]; method: string }[];
  }[];
};
const el = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const select = (id: string) => el<HTMLSelectElement>(id);
let data: Data,
  markers: StairMarker[] = [],
  pair: StairMarker[] = [];
const text = (tag: string, value: string) => {
  const e = document.createElement(tag);
  e.textContent = value;
  return e;
};
function visiblePlans() {
  const selected = select("buildings").value;
  return data.plans
    .filter(
      (p) => selected === "all" || selected.split(",").includes(p.building),
    )
    .sort(
      (a, b) =>
        a.building.localeCompare(b.building) ||
        Number(a.floor) - Number(b.floor),
    );
}
function choose(marker: StairMarker) {
  if (pair.length === 2) pair = [];
  pair.push(marker);
  renderPair();
  document.querySelectorAll(".mark").forEach((e) =>
    e.classList.toggle(
      "chosen",
      pair.some((p) => p.id === (e as HTMLElement).dataset.id),
    ),
  );
}
function renderPair() {
  const area = el("selection");
  area.replaceChildren();
  for (const [i, marker] of pair.entries()) {
    const plan = data.plans.find((p) => p.id === marker.planId)!;
    const card = document.createElement("article");
    card.append(
      text(
        "h3",
        `${i === 0 ? "A" : "B"} · ${plan.id} · #${marker.number} ${marker.label}`,
      ),
    );
    const crop = document.createElement("div");
    crop.className = "crop";
    const img = document.createElement("img");
    img.src = "/image?id=" + encodeURIComponent(plan.id);
    img.alt = `Detail around ${marker.label}`;
    // A fixed pixel-size detail preserves the page aspect ratio and uses the original image.
    const width = 1800,
      height = (width * plan.height) / plan.width;
    img.style.width = width + "px";
    img.style.left = `calc(50% - ${marker.point.x * width}px)`;
    img.style.top = `calc(50% - ${marker.point.y * height}px)`;
    const cross = text("span", "⊕");
    cross.className = "cross";
    crop.append(img, cross);
    card.append(
      crop,
      text(
        "p",
        `${marker.category === "label" ? "Printed label only; landing unresolved" : marker.category + " landing"} · normalized (${marker.point.x.toFixed(6)}, ${marker.point.y.toFixed(6)})`,
      ),
      text("p", "Source SHA-256: " + marker.sourceSha256),
    );
    area.append(card);
  }
  const problem = pairProblem(pair[0], pair[1], data.plans);
  el("pair-message").textContent =
    problem ??
    "Review draft only: no connection inferred. Confirm the marked landing positions and permitted direction.";
  el<HTMLButtonElement>("download").disabled = !!problem;
}
function collectMarkers() {
  markers = [];
  for (const plan of data.plans) {
    const list: StairMarker[] = [];
    for (const node of data.document.nodes.filter(
      (n) => n.planId === plan.id && n.kind === "stair-landing",
    ))
      list.push({
        ...node,
        category: data.eligibility.nodeIds.includes(node.id)
          ? "reviewed"
          : "proposed",
        reference: "node:" + node.id,
      });
    for (const candidate of data.candidates.filter((c) => c.kind === "stairs"))
      for (const side of ["from", "to"] as const) {
        const p = candidate[side];
        if (
          p.planId !== plan.id ||
          !p.point ||
          p.sourceSha256 !== plan.sourceSha256
        )
          continue;
        if (
          list.some((n) => n.point.x === p.point.x && n.point.y === p.point.y)
        )
          continue;
        list.push({
          ...p,
          id: candidate.id + ":" + side,
          category: "proposed",
          reference: "candidate:" + candidate.id + ":" + side,
        });
      }
    for (const p of data.stairPlaces.find((f) => f.planId === plan.id)
      ?.places ?? [])
      list.push({
        id: p.id,
        planId: plan.id,
        sourceSha256: plan.sourceSha256,
        label: p.label,
        point: {
          x: (p.bounds[0] + p.bounds[2]) / 2,
          y: (p.bounds[1] + p.bounds[3]) / 2,
        },
        category: "label",
        reference: "source-place:" + p.id,
      });
    list.forEach((m, i) => (m.number = i + 1));
    markers.push(...list);
  }
}
function floorCard(plan: Plan) {
  const card = document.createElement("article");
  card.className = "floor";
  card.append(text("h2", plan.id));
  const full = document.createElement("a");
  full.href = "/image?id=" + encodeURIComponent(plan.id);
  full.target = "_blank";
  full.rel = "noopener";
  full.textContent = "Open full-resolution source plan";
  card.append(full);
  const note = text("p", "Source SHA-256: " + plan.sourceSha256);
  note.className = "source";
  card.append(note);
  const controls = document.createElement("label");
  controls.className = "marking";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "Exact stair label, or Unlabelled stair";
  controls.append(
    enabled,
    document.createTextNode("Mark missing landing"),
    name,
  );
  card.append(controls);
  const frame = document.createElement("div");
  frame.className = "plan";
  const img = document.createElement("img");
  img.src = full.href;
  img.alt = plan.id + " official floor plan";
  img.loading = "lazy";
  frame.append(img);
  card.append(frame);
  const list = document.createElement("div");
  list.className = "marker-list";
  card.append(list);
  const entries = markers.filter((m) => m.planId === plan.id);
  const display = (marker: StairMarker) => {
    const dot = document.createElement("button");
    dot.className = "mark " + marker.category;
    dot.dataset.id = marker.id;
    dot.style.left = marker.point.x * 100 + "%";
    dot.style.top = marker.point.y * 100 + "%";
    dot.textContent = String(marker.number);
    dot.title = `#${marker.number} ${marker.label} · ${marker.category}`;
    dot.setAttribute("aria-label", dot.title);
    dot.onclick = (e) => {
      e.stopPropagation();
      choose(marker);
    };
    frame.append(dot);
    const item = document.createElement("button");
    item.className = marker.category;
    item.textContent = `#${marker.number} · ${marker.label} — ${marker.category === "label" ? "printed text; landing unresolved" : marker.category + " landing"}`;
    item.onclick = () => choose(marker);
    list.append(item);
  };
  for (const m of entries) {
    const layer = select("layer").value;
    if (
      (layer === "landing" && m.category === "label") ||
      (layer === "label" && m.category !== "label")
    )
      continue;
    display(m);
  }
  frame.onclick = (e) => {
    if (!enabled.checked) return;
    const rect = frame.getBoundingClientRect();
    const marker: StairMarker = {
      id: crypto.randomUUID(),
      planId: plan.id,
      sourceSha256: plan.sourceSha256,
      label: name.value.trim() || "Unlabelled stair",
      point: {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      },
      category: "proposed",
      reference: "manual-unconfirmed",
      number: entries.length + 1,
    };
    entries.push(marker);
    markers.push(marker);
    display(marker);
    choose(marker);
    enabled.checked = false;
  };
  const warning = text(
    "p",
    `${entries.filter((m) => m.category !== "label").length} marked landing records; ${entries.filter((m) => m.category === "label").length} extracted stair-label occurrences. Not a complete stair census: missing, duplicate and misread labels need review.`,
  );
  warning.className = "missing";
  card.append(warning);
  return card;
}
function relationships() {
  const area = el("relationships");
  area.replaceChildren();
  const ids = new Set(visiblePlans().map((p) => p.id));
  for (const e of data.document.edges.filter((e) => e.kind === "stairs")) {
    const a = markers.find((m) => m.id === e.fromNodeId),
      b = markers.find((m) => m.id === e.toNodeId);
    if (!a || !b || (!ids.has(a.planId) && !ids.has(b.planId))) continue;
    const button = document.createElement("button");
    button.textContent = `${data.eligibility.edgeIds.includes(e.id) ? "Eligible saved connection" : "Ineligible saved record"}: ${a.planId} #${a.number} ${a.label} ${e.direction === "both" ? "↔" : "→"} ${b.planId} #${b.number} ${b.label}`;
    button.onclick = () => {
      pair = [a, b];
      renderPair();
      el("selection").scrollIntoView({ behavior: "smooth", block: "center" });
    };
    area.append(button);
  }
  for (const c of data.candidates.filter(
    (c) =>
      c.kind === "stairs" &&
      c.state !== "confirmed" &&
      (ids.has(c.from.planId) || ids.has(c.to.planId)),
  ))
    area.append(
      text(
        "p",
        `Open question (${c.state}): ${c.title}. No connection inferred.`,
      ),
    );
}
function render() {
  el("floors").replaceChildren(...visiblePlans().map(floorCard));
  relationships();
  const count = visiblePlans().length;
  el("status").textContent =
    `${count} / ${data.plans.length} source sheets shown · ${select("records").value} revision ${data.document.revision}. No same-floor corridor arrows on this board.`;
}
async function load() {
  try {
    const response = await fetch(
      "/api/stairs?source=" + select("records").value,
    );
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    data = result;
    pair = [];
    collectMarkers();
    const current = select("buildings").value;
    select("buildings").replaceChildren(
      new Option("SW03 + SE12", "SW3,SE12"),
      new Option("All supplied buildings", "all"),
    );
    for (const b of [...new Set(data.plans.map((p) => p.building))].sort())
      select("buildings").add(new Option(b, b));
    select("buildings").value = current;
    render();
    renderPair();
  } catch (e) {
    el("status").textContent = String(e);
  }
}
el("download").onclick = () => {
  if (pairProblem(pair[0], pair[1], data.plans)) return;
  const draft = {
    schemaVersion: 1,
    kind: "stairs",
    status: "unanswered-review-draft",
    answer: null,
    direction: null,
    recordSource: select("records").value,
    revision: data.document.revision,
    preparedAt: new Date().toISOString(),
    from: pair[0],
    to: pair[1],
    notice:
      "Not a confirmation, field visit, approved edge or route. Printed label points require separately marked landings.",
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "stair-review-draft.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
el("clear").onclick = () => {
  pair = [];
  renderPair();
  render();
};
select("buildings").onchange = () => {
  pair = [];
  renderPair();
  render();
};
select("layer").onchange = render;
select("records").onchange = load;
el("reload").onclick = load;
el<HTMLInputElement>("size").oninput = () =>
  document.documentElement.style.setProperty(
    "--plan-size",
    el<HTMLInputElement>("size").value + "px",
  );
void load();
