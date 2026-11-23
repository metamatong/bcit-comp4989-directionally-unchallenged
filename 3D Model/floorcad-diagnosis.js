/** Read-only local diagnostic evidence, rendered as text rather than trusted markup. */
const add = (tag, text, parent) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  parent.append(e);
  return e;
};
try {
  const report = await fetch(
    "/local-analysis/floorcad-diagnosis/report.json",
  ).then((r) => r.json());
  const neon = await fetch(
    "/local-analysis/floorcad-diagnosis/neon-trial.json",
  ).then((r) => r.json());
  const section = document.getElementById("neon");
  add("h2", "Gemini 4 Neon comparison", section);
  add(
    "p",
    `${neon.selectedModelInOfficialApp}. ${neon.transport}. ${neon.capture}`,
    section,
  );
  add("p", neon.conclusion, section);
  for (const observation of neon.observations) {
    const sample = neon.samples.find((s) => s.sample === observation.sample);
    const card = add("article", undefined, section);
    add(
      "h3",
      `${observation.sample}: ${observation.readablePrimaryText.join(" ")} � ${observation.classification}`,
      card,
    );
    const image = add("img", undefined, card);
    image.src = "/" + sample.image;
    image.alt = sample.planId + " source crop reviewed by Neon";
    add("p", observation.visibleEvidence, card);
    const list = add("ul", undefined, card);
    for (const limit of observation.uncertainties) add("li", limit, list);
  }
  add("p", neon.limitations.join(" "), section);
  const root = document.getElementById("results");
  for (const id of [
    "s280-tight",
    "s280-context",
    "s280-rotated",
    "s270-control",
  ]) {
    const card = add("article", undefined, root);
    add("h2", id, card);
    const img = add("img", undefined, card);
    img.src = "/local-analysis/floorcad-diagnosis/" + id + ".png";
    img.alt = id + " source drawing crop";
    for (const o of report.observations.filter((o) => o.id === id)) {
      add("h3", o.model, card);
      add("pre", JSON.stringify(o.output || o.error, null, 2), card);
    }
  }
  document.getElementById("geometry").textContent = JSON.stringify(
    await fetch("/local-analysis/floorcad-diagnosis/geometry.json").then((r) =>
      r.json(),
    ),
    null,
    2,
  );
} catch (error) {
  add("p", "Diagnostic unavailable: " + error, document.body);
}
