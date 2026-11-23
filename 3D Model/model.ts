/** Read existing records without initializing, migrating or writing the topology journal. */
import { readFileSync } from "node:fs";
import { addModelConnections } from "./model-connections.ts";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
export const root = process.env.BCIT_PROJECT!;
const moduleAt = (name: string) =>
  import(pathToFileURL(resolve(root, "server", name + ".ts")).href);
const [topology, visual, network, importer, candidates, floors, coverage] =
  await Promise.all(
    [
      "topology",
      "visual-data",
      "pilot-network",
      "topology-import",
      "topology-candidates",
      "floor-graph",
      "floor-coverage",
    ].map(moduleAt),
  );
export const plans = visual.visualPlans;
export const verifiedImage = visual.verifiedVisualBytes;
export function stairPlaces() {
  return floors.floorGraphs().ordered.map((floor: any) => ({
    planId: floor.plan.id,
    places: floor.places.filter((place: any) => place.kind === "stairs"),
  }));
}
const visitor = await moduleAt("visitor-paths");
const evidence = await moduleAt("pilot-evidence");
export function snapshot(source = "navigation") {
  if (!["navigation", "local-navigation", "published", "local"].includes(source))
    throw Error("Unknown network source");
  const definitions = candidates.readConnectionCandidates();
  const published = source === "navigation"
    ? network.validateNetworkExport(evidence.checkedSpatialJson("reviewed-network"), plans)
    : network.reviewedNetwork();
  const document =
    source === "local" || source === "local-navigation"
      ? topology.validateTopologyDocument(
          JSON.parse(
            readFileSync(resolve(root, "data/campus/topology.json"), "utf8"),
          ),
        )
      : importer.importReviewedNetwork(published, definitions);
  if (source === "navigation" || source === "local-navigation") {
    const eligibility = topology.topologyEligibility(document, plans);
    const passages = visitor.visitorPassages(document, eligibility, definitions, plans);
    const edges = document.edges.filter((edge: any) => passages.allowed.has(edge.id)).map((edge: any) => {
      const trace = passages.traces.get(edge.id);
      return trace ? { ...edge, path: trace.fromId === edge.fromNodeId ? trace.path : [...trace.path].reverse() } : edge;
    });
    return {
      source, publishedRevision: published.revision, plans, candidates: [], coverage: coverage.floorCoverage(),
      document: { ...document, nodes: document.nodes.filter((node: any) => eligibility.nodeIds.includes(node.id)), edges },
      eligibility: { ...eligibility, edgeIds: edges.map((edge: any) => edge.id) },
    };
  }
  const modelConnections = addModelConnections(
    document,
    plans,
    topology.topologyRecordHash,
  );
  const eligibility = topology.topologyEligibility(document, plans);
  return {
    source,
    publishedRevision: published.revision,
    modelConnections,
    document,
    eligibility,
    plans,
    candidates: candidates.connectionCandidateViews(
      document,
      definitions,
      plans,
      eligibility,
    ),
    coverage: coverage.floorCoverage(),
  };
}
export function floorData(id: string) {
  // The shared loader verifies floor hashes, inputs and place approach cells first.
  const floor = floors.floorGraphs().byId.get(id);
  if (!floor) throw Error("Unknown floor");
  const raw = JSON.parse(
    readFileSync(
      resolve(root, "data/campus/spatial/floor-graphs.json"),
      "utf8",
    ),
  );
  const grid = raw.floors.find((item: { id: string }) => item.id === id);
  return {
    width: grid.width,
    height: grid.height,
    runs: grid.runs,
    places: floor.places,
  };
}
