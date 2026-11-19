/** Audit signed origins and destinations against the directed visitor graph, including isolated floors. */
import { TopologyStore, topologyEligibility } from '../server/topology';
import { visitorPassages } from '../server/visitor-paths';
import { floorGraphs, sourceBuilding, visitorExclusion } from '../server/floor-graph';
import { FloorSearch, type SearchStop } from '../server/floor-search';
import { CampusJourney } from '../server/campus-journey';
import { pathToFileURL } from 'node:url';
import { importReviewedNetwork } from '../server/topology-import';
import { readConnectionCandidates } from '../server/topology-candidates';
import { reviewedNetwork } from '../server/pilot-network';
import { visualPlans } from '../server/visual-data';

type AuditStore = Pick<TopologyStore,'read'|'plans'|'candidates'>;
export function publishedCoverageStore():AuditStore {
  const candidates=readConnectionCandidates();
  const doc=importReviewedNetwork(reviewedNetwork(),candidates);
  return {plans:visualPlans,candidates,read:()=>doc};
}

export function buildingCoverage(buildingName: string, store: AuditStore = new TopologyStore()) {
  const combined=buildingName==='--network';
  const building = combined?'SE12/SW03/SW01':sourceBuilding(buildingName);
  if (!building) throw Error('Select a supplied Burnaby building.');
  const doc = store.read(),
    eligibility = topologyEligibility(doc, store.plans);
  const network = visitorPassages(doc, eligibility, store.candidates, store.plans);
  const nodes = doc.nodes.filter((n) => eligibility.nodeIds.includes(n.id));
  const map = { doc, plans: store.plans, nodes, network };
  const floorList = floorGraphs().ordered.filter((f) => combined?
    ['SE12','SW3','SW1'].includes(f.plan.building):f.plan.building === building);
  const sheets = new Set(floorList.map((f) => f.plan.id));
  const search = new FloorSearch(map),
    planner = new CampusJourney(map, search);
  const places = floorList.flatMap((f) =>
    f.places.map((place) => ({ place, stops: planner.stops(place).filter((s) => !s.unlinked) })),
  );
  const gateways: SearchStop[] = [];
  const perFloorGates:SearchStop[]=[];
  for (const edge of doc.edges) {
    if (!network.allowed.has(edge.id) || !['outdoor', 'building-link'].includes(edge.kind))
      continue;
    const a = search.reviewed(edge.fromNodeId),
      b = search.reviewed(edge.toNodeId);
    if (!a || !b)continue;
    if(combined) {
      if(a.stop.planId.split('-')[0]===b.stop.planId.split('-')[0])continue;
      perFloorGates.push(a,b);
      // One common hub proves transit between buildings, even if other exits
      // form detached components. A multi-source flood cannot prove this.
      if(edge.kind==='building-link' && edge.direction==='both' &&
         [a.stop.planId,b.stop.planId].sort().join('/')==='SE12-F3-p1/SW3-F3-p1')
        gateways.push(a.stop.planId==='SE12-F3-p1'?a:b);
      continue;
    }
    if(sheets.has(a.stop.planId) === sheets.has(b.stop.planId)) continue;
    gateways.push(sheets.has(a.stop.planId) ? a : b);
  }
  if(combined && gateways.length!==1)throw Error('Expected the confirmed SE12 to SW03 floor 3 passage.');
  const incoming = search.reachable(gateways, sheets),
    outgoing = search.reachable(gateways, sheets, true);
  const records = floorList.flatMap((f) => {
    const one = new Set([f.plan.id]);
    const localGates=combined?perFloorGates:gateways;
    const both = [search.reachable(localGates, one), search.reachable(localGates, one, true)];
    return places
      .filter((p) => p.place.planId === f.plan.id)
      .map(({ place, stops }) => {
        const origin=stops.filter(s=>outgoing.has(s.key));
        const destination=stops.filter(s=>incoming.has(s.key));
        const grade=(list: SearchStop[]) => {
          if(list.some(s=>!s.stop.corridorVicinity && !s.stop.sharedEntrance && !place.sharedEntry))return 'mapped';
          if(list.some(s=>!s.stop.corridorVicinity))return 'shared';
          return list.length?'vicinity':'unreachable';
        };
        return ({
        planId:f.plan.id,
        building:f.plan.building,
        floor: f.plan.floor,
        label: place.label,
        kind: place.kind,
        approach: stops.length > 0,
        staffOnly: visitorExclusion(place) === 'staff-only',
        excluded: visitorExclusion(place) ?? '',
        shared: !!place.sharedEntry,
        roomArea: !!place.roomArea,
        sameFloor: stops.some((s) => both.every((set) => set.has(s.key))),
        fromPassage: stops.some((s) => incoming.has(s.key)),
        toPassage: stops.some((s) => outgoing.has(s.key)),
        originAccess:grade(origin),arrivalAccess:grade(destination),
        publicDoorSymbols: place.doors.length,
        sharedHost: place.sharedHost ?? '',
        status: visitorExclusion(place)==='staff-only'
          ? 'Staff-only; excluded from visitor directions'
          : visitorExclusion(place)==='non-walking'
            ? 'Non-walking source feature'
            : !stops.length
              ? place.doors.length
                ? 'Door identified; walking approach still unresolved'
                : 'Place identified; walking approach still unresolved'
              : stops.some((s) => incoming.has(s.key)) && stops.some((s) => outgoing.has(s.key))
                ? grade(origin)==='vicinity' || grade(destination)==='vicinity' ? 'Round trip using a corridor-side vicinity'
                  : grade(origin)==='shared' || grade(destination)==='shared'
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
      });});
  });
  const summarize = (rows: typeof records) => ({
    places: rows.length,
    visitorPlaces:rows.filter(r=>!r.excluded).length,
    remaining:rows.filter(r=>!r.excluded && !(r.fromPassage && r.toPassage)).length,
    approaches: rows.filter((r) => r.approach).length,
    sameFloor: rows.filter((r) => r.sameFloor).length,
    roundTrip: rows.filter((r) => r.fromPassage && r.toPassage).length,
    mappedRoundTrip:rows.filter(r=>r.originAccess==='mapped' && r.arrivalAccess==='mapped').length,
    vicinityRoundTrip:rows.filter(r=>r.fromPassage&&r.toPassage&&(r.originAccess==='vicinity'||r.arrivalAccess==='vicinity')).length,
    sharedRoundTrip:rows.filter(r=>r.fromPassage&&r.toPassage&&r.originAccess!=='vicinity'&&r.arrivalAccess!=='vicinity'&&(r.originAccess==='shared'||r.arrivalAccess==='shared')).length,
    nonWalking:rows.filter(r=>r.excluded==='non-walking').length,
    sharedEntrances: rows.filter((r) => r.shared).length,
    withoutApproach: rows.filter((r) => !r.approach).length,
    staffOnly: rows.filter((r) => r.staffOnly).length,
  });
  const by = (v: 'floor' | 'kind' | 'planId' | 'building') =>
    Object.fromEntries(
      [...new Set(records.map((r) => r[v]))].map((k) => [
        k,
        summarize(records.filter((r) => r[v] === k)),
      ]),
    );
  return {
    building,
    revision: doc.revision,
    floors: by(combined?'planId':'floor'),
    buildings:by('building'),
    kinds: by('kind'),
    total: summarize(records),
    records,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = buildingCoverage(process.argv[2] ?? 'SW01',process.argv.includes('--network')?publishedCoverageStore():undefined);
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
