/** Audit signed origins and destinations against the directed visitor graph, including isolated floors. */
import { TopologyStore, topologyEligibility } from '../server/topology';
import { visitorPassages } from '../server/visitor-paths';
import { floorGraphs, sourceBuilding } from '../server/floor-graph';
import { FloorSearch, type SearchStop } from '../server/floor-search';
import { CampusJourney } from '../server/campus-journey';
import { pathToFileURL } from 'node:url';

export function buildingCoverage(buildingName: string, store = new TopologyStore()) {
  const building = sourceBuilding(buildingName);
  if (!building) throw Error('Select a supplied Burnaby building.');
  const doc = store.read(),
    eligibility = topologyEligibility(doc, store.plans);
  const network = visitorPassages(doc, eligibility, store.candidates, store.plans);
  const nodes = doc.nodes.filter((n) => eligibility.nodeIds.includes(n.id));
  const map = { doc, plans: store.plans, nodes, network };
  const floorList = floorGraphs().ordered.filter((f) => f.plan.building === building);
  const sheets = new Set(floorList.map((f) => f.plan.id));
  const search = new FloorSearch(map),
    planner = new CampusJourney(map, search);
  const places = floorList.flatMap((f) =>
    f.places.map((place) => ({ place, stops: planner.stops(place).filter((s) => !s.unlinked) })),
  );
  const gateways: SearchStop[] = [];
  for (const edge of doc.edges) {
    if (!network.allowed.has(edge.id) || !['outdoor', 'building-link'].includes(edge.kind))
      continue;
    const a = search.reviewed(edge.fromNodeId),
      b = search.reviewed(edge.toNodeId);
    if (!a || !b || sheets.has(a.stop.planId) === sheets.has(b.stop.planId)) continue;
    gateways.push(sheets.has(a.stop.planId) ? a : b);
  }
  const incoming = search.reachable(gateways, sheets),
    outgoing = search.reachable(gateways, sheets, true);
  const records = floorList.flatMap((f) => {
    const one = new Set([f.plan.id]);
    const both = [search.reachable(gateways, one), search.reachable(gateways, one, true)];
    return places
      .filter((p) => p.place.planId === f.plan.id)
      .map(({ place, stops }) => ({
        floor: f.plan.floor,
        label: place.label,
        kind: place.kind,
        approach: stops.length > 0,
        staffOnly: place.visitorAccess === 'staff-only',
        shared: !!place.sharedEntry,
        roomArea: !!place.roomArea,
        sameFloor: stops.some((s) => both.every((set) => set.has(s.key))),
        fromPassage: stops.some((s) => incoming.has(s.key)),
        toPassage: stops.some((s) => outgoing.has(s.key)),
        publicDoorSymbols: place.doors.length,
        sharedHost: place.sharedHost ?? '',
        status: place.visitorAccess
          ? 'Staff-only; excluded from visitor directions'
          : place.kind === 'shaft' || place.kind === 'void'
            ? 'Non-walking source feature'
            : !stops.length
              ? place.doors.length
                ? 'Door identified; walking approach still unresolved'
                : 'Place identified; walking approach still unresolved'
              : stops.some((s) => incoming.has(s.key)) && stops.some((s) => outgoing.has(s.key))
                ? place.sharedEntry
                  ? 'Round trip to a shared entrance'
                  : 'Round trip to a building passage'
                : 'Local approach; building passage not reachable both ways',
        sourceUrl: f.plan.sourceUrl,
        sourceSha256: f.plan.sourceSha256,
        labelLeft: place.bounds[0],
        labelTop: place.bounds[1],
        labelRight: place.bounds[2],
        labelBottom: place.bounds[3],
        id: place.id,
      }));
  });
  const summarize = (rows: typeof records) => ({
    places: rows.length,
    approaches: rows.filter((r) => r.approach).length,
    sameFloor: rows.filter((r) => r.sameFloor).length,
    roundTrip: rows.filter((r) => r.fromPassage && r.toPassage).length,
    sharedEntrances: rows.filter((r) => r.shared).length,
    withoutApproach: rows.filter((r) => !r.approach).length,
    staffOnly: rows.filter((r) => r.staffOnly).length,
  });
  const by = (v: 'floor' | 'kind') =>
    Object.fromEntries(
      [...new Set(records.map((r) => r[v]))].map((k) => [
        k,
        summarize(records.filter((r) => r[v] === k)),
      ]),
    );
  return {
    building,
    revision: doc.revision,
    floors: by('floor'),
    kinds: by('kind'),
    total: summarize(records),
    records,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = buildingCoverage(process.argv[2] ?? 'SW01');
  if (process.argv.includes('--csv')) {
    const keys = Object.keys(report.records[0] ?? {}) as (keyof (typeof report.records)[number])[];
    const escape = (v: unknown) => '"' + String(v).replaceAll('"', '""') + '"';
    console.log(keys.join(','));
    for (const r of report.records) console.log(keys.map((k) => escape(r[k])).join(','));
  } else {
    const { records, ...summary } = report;
    console.log(JSON.stringify(summary, null, 2));
  }
}
