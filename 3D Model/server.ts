/** Loopback-only, read-only inspector. No provider keys or application APIs are exposed. */
import { buildRelationshipQuestions } from "./relationship-questions.mjs";
import { buildModelAudit } from "./model-audit.mjs";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  snapshot,
  floorData,
  plans,
  verifiedImage,
  stairPlaces,
} from "./model.ts";
const files: Record<string, [string, string]> = {
  "/": ["three.html", "text/html"],
  "/inspector": ["index.html", "text/html"],
  "/three": ["three.html", "text/html"],
  "/three-view.js": ["three-view.js", "text/javascript"],
  "/viewer.js": ["viewer.js", "text/javascript"],
  "/style.css": ["style.css", "text/css"],
  "/stairs": ["stairs.html", "text/html"],
  "/stairs.js": ["stairs.js", "text/javascript"],
  "/stairs.css": ["stairs.css", "text/css"],
};
files["/local-review"] = ["local-review.html", "text/html"];
files["/local-review.js"] = ["local-review.js", "text/javascript"];
for (const name of [
  "overview-trial.json",
  "qwen-focused-trial.json",
  "focused-trial.json",
])
  files["/local-analysis/" + name] = [
    "local-analysis/" + name,
    "application/json",
  ];
for (const name of [
  "F1-A",
  "F1-B",
  "F1-C",
  "F1-D",
  "F2-A",
  "F2-B",
  "F2-C",
  "F2-D",
  "F2-E",
])
  files["/local-analysis/" + name + ".png"] = [
    "local-analysis/" + name + ".png",
    "image/png",
  ];
files["/training-review"] = [
  "local-analysis/stair-training-review/review.html",
  "text/html",
];
files["/model-review"] = ["model-review.html", "text/html"];
files["/model-review.js"] = ["model-review.js", "text/javascript"];
for (const name of [
  "SE12-F3-p1-parking-0",
  "SE12-F3-p1-stair-0",
  "SW3-F2-p1-parking-0",
  "SW3-F2-p1-stair-0",
])
  files["/local-analysis/model-shapes/" + name + ".png"] = [
    "local-analysis/model-shapes/" + name + ".png",
    "image/png",
  ];
for (const observation of JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, "local-analysis/model-shapes-all/report.json"),
    "utf8",
  ),
).observations) {
  if (
    !/^(SE12|SW3)-F[1-4]-p1-(parking|stair|elevator|escalator)-\d{1,2}$/.test(
      observation.id,
    )
  )
    throw Error("Invalid source crop identifier");
  files["/local-analysis/model-shapes-all/" + observation.id + ".png"] = [
    "local-analysis/model-shapes-all/" + observation.id + ".png",
    "image/png",
  ];
}
files["/floorcad-diagnosis"] = ["floorcad-diagnosis.html", "text/html"];
files["/floorcad-diagnosis.js"] = ["floorcad-diagnosis.js", "text/javascript"];
for (const name of [
  "report.json",
  "geometry.json",
  "neon-trial.json",
  "s280-tight.png",
  "s280-context.png",
  "s280-rotated.png",
  "s270-control.png",
]) {
  files["/local-analysis/floorcad-diagnosis/" + name] = [
    "local-analysis/floorcad-diagnosis/" + name,
    name.endsWith(".png") ? "image/png" : "application/json",
  ];
}
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  try {
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    const url = new URL(request.url!, "http://127.0.0.1");
    if (url.pathname === "/api/model-audit") {
      const read = (name: string) =>
        JSON.parse(
          readFileSync(
            resolve(import.meta.dirname, "local-analysis", name),
            "utf8",
          ).replace(/^\uFEFF/, ""),
        );
      const current = { ...snapshot("published"), stairPlaces: stairPlaces() };
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          ...buildModelAudit(
            current,
            read("floorcad-baseline.json"),
            read("model-shapes/report.json"),
            read("relation-audit-qwen.json"),
            read("model-shapes-all/report.json"),
            read("model-shapes-recheck/report.json"),
            read("model-shapes-gemma/report.json"),
            read("model-shapes-gemma-recheck/report.json"),
          ),
          tiled: existsSync(
            resolve(import.meta.dirname, "local-analysis/floorcad-tiled.json"),
          )
            ? buildModelAudit(
                current,
                read("floorcad-tiled.json"),
                {},
                {},
                {},
                {},
                {},
                {},
                1024,
              )
            : null,
          relationshipQuestions: buildRelationshipQuestions(
            current,
            read("relationship-questions.json"),
          ),
        }),
      );
      return;
    }
    if (url.pathname === "/api/stairs") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          ...snapshot(url.searchParams.get("source") ?? "navigation"),
          stairPlaces: stairPlaces(),
        }),
      );
      return;
    }
    if (url.pathname === "/api/snapshot" || url.pathname === "/api/floor") {
      const data =
        url.pathname === "/api/snapshot"
          ? snapshot(url.searchParams.get("source") ?? "navigation")
          : floorData(url.searchParams.get("id") ?? "");
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(data));
      return;
    }
    if (url.pathname === "/image") {
      const plan = plans.find(
        (p: { id: string }) => p.id === url.searchParams.get("id"),
      );
      if (!plan) {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("Content-Type", "image/png");
      response.end(verifiedImage(plan.full));
      return;
    }
    const file = files[url.pathname];
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", file[1]);
    response.end(readFileSync(resolve(import.meta.dirname, file[0])));
  } catch (error) {
    response
      .writeHead(503, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: String(error) }));
  }
});
server.listen(Number(process.env.SPATIAL_PORT || 3210), "127.0.0.1", () =>
  console.log(
    "Spatial inspector: http://127.0.0.1:" + (process.env.SPATIAL_PORT || 3210),
  ),
);
