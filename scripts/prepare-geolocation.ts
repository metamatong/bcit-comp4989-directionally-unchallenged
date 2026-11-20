/** Compile visitor alignments from reviewed correspondences on archived BCIT sources. */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson, root } from '../server/data';
import { archivedBuildingFootprints } from '../server/geolocation';
import { verifiedVisualBytes, visualPlans } from '../server/visual-data';
import { fitCalibration } from '../src/location/geometry';
import type {
  CalibrationControl,
  FloorCalibration,
  LocationCatalogue,
} from '../src/location/types';
import type { VisualPlan } from '../src/types';

type Pair = [number, number];
type Segment = { coordinates: [number, number, number, number] };
type CornerEvidence = { vertex: number } & ({ lines: Pair } | { page: Pair });
type FloorEvidence = { sourceSha256: string } & (
  | { issue: string }
  | { geometrySha256: string; rasterSha256?: string; corners: CornerEvidence[] }
  | {
      geometrySha256: string;
      sourcePlanId: string;
      sourceGeometrySha256: string;
      sharedFeatures: { label: string; source: Pair; target: Pair }[];
    }
);

const evidenceFile = 'data/campus/geolocation/floor-alignment-evidence.json';
const catalogueFile = 'data/campus/geolocation/calibrations.json';
const version = 'bcit-2026-11-19-source-correspondence';
const maxFitResidualMetres = 1.5;
const maxHeldOutMetres = 2;

function drawingCorner(segments: Segment[], indexes: Pair, plan: VisualPlan) {
  const [first, second] = indexes.map((index) => segments[index]);
  if (!first || !second || indexes[0] === indexes[1])
    throw Error(`Invalid source corner lines on ${plan.id}: ${indexes.join(', ')}`);
  const [x, y, endX, endY] = first.coordinates;
  const [otherX, otherY, otherEndX, otherEndY] = second.coordinates;
  const dx = endX - x;
  const dy = endY - y;
  const otherDx = otherEndX - otherX;
  const otherDy = otherEndY - otherY;
  const determinant = dx * otherDy - dy * otherDx;
  if (Math.abs(determinant) < 1e-8) throw Error(`Parallel source corner lines on ${plan.id}.`);
  const firstFraction = ((otherX - x) * otherDy - (otherY - y) * otherDx) / determinant;
  const secondFraction = ((otherX - x) * dy - (otherY - y) * dx) / determinant;
  // CAD wall strokes may stop a little short of their corner at a jamb or join.
  const extension = (fraction: number, deltaX: number, deltaY: number) =>
    Math.max(0, -fraction, fraction - 1) * Math.hypot(deltaX * plan.width, deltaY * plan.height);
  if (extension(firstFraction, dx, dy) > 8 || extension(secondFraction, otherDx, otherDy) > 8)
    throw Error(`Source corner extends too far from its wall strokes on ${plan.id}.`);
  return { x: x + firstFraction * dx, y: y + firstFraction * dy };
}

function normalize(point: Pair, plan: VisualPlan) {
  if (
    point.some((value) => !Number.isFinite(value)) ||
    point[0] < 0 ||
    point[0] > plan.width ||
    point[1] < 0 ||
    point[1] > plan.height
  )
    throw Error(`Measured point is outside ${plan.id}.`);
  return { x: point[0] / plan.width, y: point[1] / plan.height };
}

export function compileLocationCatalogue(): LocationCatalogue {
  const { geographicSource, plans: evidence } = readJson<{
    geographicSource: LocationCatalogue['geographicSource'];
    plans: Record<string, FloorEvidence>;
  }>(evidenceFile);
  const buildings = archivedBuildingFootprints(geographicSource);
  if (Object.keys(evidence).length !== visualPlans.length)
    throw Error('Expected alignment evidence or a coverage reason for every supplied plan.');

  const reviewed = new Map<string, FloorCalibration>();
  const compiling = new Set<string>();
  function compileFloor(plan: VisualPlan): FloorCalibration {
    const previous = reviewed.get(plan.id);
    if (previous) return previous;
    if (compiling.has(plan.id)) throw Error(`Circular floor alignment dependency: ${plan.id}`);
    compiling.add(plan.id);
    const record = evidence[plan.id];
    if (!record || record.sourceSha256 !== plan.sourceSha256)
      throw Error(`Floor evidence no longer matches source PDF: ${plan.id}`);
    const floor = compileRecord(plan, record);
    compiling.delete(plan.id);
    reviewed.set(plan.id, floor);
    return floor;
  }

  function compileRecord(plan: VisualPlan, record: FloorEvidence): FloorCalibration {
    const identity = { planId: plan.id, sourceSha256: plan.sourceSha256, version };
    if ('issue' in record)
      return {
        ...identity,
        status: 'unavailable',
        reason: record.issue,
        controls: [],
        residualsMetres: [],
        heldOutMetres: null,
      };
    const footprint = buildings.find((building) => building.building === plan.building);
    if (!footprint) throw Error(`Missing official footprint for ${plan.id}.`);
    if (record.geometrySha256 !== plan.geometry.sha256)
      throw Error(`Drawing geometry changed: ${plan.id}`);

    let controls: CalibrationControl[];
    let method: FloorCalibration['method'];
    let reason: string;
    if ('corners' in record) {
      const longSegments = record.corners.some((corner) => 'lines' in corner)
        ? (
            JSON.parse(verifiedVisualBytes(plan.geometry).toString('utf8')) as {
              longSegments: Segment[];
            }
          ).longSegments
        : [];
      if (
        record.corners.some((corner) => 'page' in corner) &&
        record.rasterSha256 !== plan.full.sha256
      )
        throw Error(`Raster evidence changed: ${plan.id}.`);
      const ring = footprint.rings[0];
      if (new Set(record.corners.map((corner) => corner.vertex)).size !== record.corners.length)
        throw Error(`Repeated GIS control vertex: ${plan.id}`);
      controls = record.corners.map((corner) => {
        const { vertex } = corner;
        if (!ring[vertex] || vertex >= ring.length - 1)
          throw Error(`Invalid GIS control vertex: ${plan.id} #${vertex}`);
        const [longitude, latitude] = ring[vertex];
        const point =
          'lines' in corner
            ? drawingCorner(longSegments, corner.lines, plan)
            : normalize(corner.page, plan);
        return {
          ...point,
          longitude,
          latitude,
          label: `Matched exterior corner, GIS vertex ${vertex}`,
        };
      });
      method = 'manual-corners';
      reason =
        'Approximate alignment from corresponding wall corners on the archived drawing and BCIT footprint.';
    } else {
      const sourcePlan = visualPlans.find((candidate) => candidate.id === record.sourcePlanId);
      if (
        !sourcePlan ||
        sourcePlan.building !== plan.building ||
        sourcePlan.geometry.sha256 !== record.sourceGeometrySha256
      )
        throw Error(`Stacked source geometry changed: ${plan.id}`);
      const sourceCalibration = compileFloor(sourcePlan);
      if (sourceCalibration.status !== 'approximate')
        throw Error(`Stacked source alignment is unavailable: ${sourcePlan.id}`);
      const fit = fitCalibration(sourceCalibration.controls, sourcePlan.width, sourcePlan.height);
      controls = record.sharedFeatures.map((feature) => ({
        ...normalize(feature.target, plan),
        ...fit.unproject(normalize(feature.source, sourcePlan)),
        label: feature.label,
      }));
      method = 'stacked-features';
      reason = `Approximate alignment from shared structural features on ${sourcePlan.id}. It inherits the source floor's geographic uncertainty.`;
    }
    const { residuals } = fitCalibration(controls, plan.width, plan.height);
    const residualsMetres = residuals.slice(0, -1);
    const heldOutMetres = residuals.at(-1)!;
    if (Math.max(...residualsMetres) > maxFitResidualMetres || heldOutMetres > maxHeldOutMetres)
      throw Error(
        `Alignment exceeds the drawing correspondence limits on ${plan.id}: ${residuals.map((value) => value.toFixed(2)).join(', ')} m.`,
      );
    return {
      ...identity,
      status: 'approximate',
      method,
      reason,
      controls,
      residualsMetres,
      heldOutMetres,
    };
  }

  return { geographicSource, buildings, floors: visualPlans.map(compileFloor) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const catalogue = compileLocationCatalogue();
  writeFileSync(resolve(root, catalogueFile), JSON.stringify(catalogue, null, 2) + '\n');
  const approximate = catalogue.floors.filter((floor) => floor.status === 'approximate').length;
  console.log(
    `Prepared ${catalogue.floors.length} floor coverage entries; ${approximate} approximate alignments.`,
  );
}
