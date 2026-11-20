/** Validate public source alignment before exposing it to the visitor browser. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readJson, root } from './data';
import { visualPlans } from './visual-data';
import { fitCalibration } from '../src/location/geometry';
import type { LocationCatalogue } from '../src/location/types';

export function archivedBuildingFootprints(source: LocationCatalogue['geographicSource']) {
  const sourceFile = 'data/campus/geolocation/bcit-burnaby-footprints.json';
  if (source.file !== sourceFile)
    throw Error('Geographic source hash changed. Review device-location calibration.');
  const bytes = readFileSync(`${root}/${sourceFile}`);
  if (createHash('sha256').update(bytes).digest('hex') !== source.sha256)
    throw Error('Geographic source hash changed. Review device-location calibration.');
  const footprint = JSON.parse(bytes.toString('utf8')) as {
    spatialReference?: { wkid: number };
    exceededTransferLimit?: boolean;
    features: { attributes: { BuildingName: string }; geometry: { rings: number[][][] } }[];
  };
  if (
    footprint.spatialReference?.wkid !== 4326 ||
    footprint.exceededTransferLimit ||
    !footprint.features?.length
  )
    throw Error('Expected complete BCIT WGS84 building footprints.');
  const supplied = new Set(visualPlans.map((plan) => plan.building));
  const buildings = footprint.features
    .filter((f) => supplied.has(f.attributes.BuildingName))
    .map((f) => ({
      building: f.attributes.BuildingName,
      rings: f.geometry.rings,
    }));
  if (
    !buildings.length ||
    new Set(buildings.map((b) => b.building)).size !== buildings.length ||
    buildings.some(
      (b) =>
        !b.rings.length ||
        b.rings.some(
          (ring) =>
            ring.length < 4 ||
            ring.some(
              (point) =>
                point.length !== 2 ||
                !point.every(Number.isFinite) ||
                Math.abs(point[0]) > 180 ||
                Math.abs(point[1]) > 90,
            ),
        ),
    )
  )
    throw Error('Invalid campus building footprint coordinates.');
  return buildings;
}

export function locationCatalogue(): LocationCatalogue {
  const catalogue = readJson<LocationCatalogue>('data/campus/geolocation/calibrations.json');
  const buildings = archivedBuildingFootprints(catalogue.geographicSource);
  if (JSON.stringify(buildings) !== JSON.stringify(catalogue.buildings))
    throw Error('Footprint catalogue differs from the official source.');
  const plans = visualPlans;
  if (
    catalogue.floors.length !== plans.length ||
    new Set(catalogue.floors.map((f) => f.planId)).size !== plans.length
  )
    throw Error('Expected one calibration coverage entry for every supplied floor.');
  for (const floor of catalogue.floors) {
    const plan = plans.find((p) => p.id === floor.planId);
    if (!plan || floor.sourceSha256 !== plan.sourceSha256 || !floor.reason || !floor.version)
      throw Error(`Invalid calibration provenance: ${floor.planId}`);
    if (floor.status === 'approximate') {
      if (floor.method !== 'manual-corners' && floor.method !== 'stacked-features')
        throw Error(`Invalid calibration method: ${floor.planId}`);
      const fit = fitCalibration(floor.controls, plan.width, plan.height);
      const recorded = [...floor.residualsMetres, floor.heldOutMetres];
      if (
        recorded.length !== fit.residuals.length ||
        recorded.some(
          (r, i) => r === null || !Number.isFinite(r) || Math.abs(r - fit.residuals[i]) > 0.000001,
        )
      )
        throw Error(`Calibration residual mismatch: ${floor.planId}`);
    } else if (
      floor.status !== 'unavailable' ||
      floor.method !== undefined ||
      floor.controls.length ||
      floor.heldOutMetres !== null ||
      floor.residualsMetres.length
    )
      throw Error(`Invalid calibration availability: ${floor.planId}`);
  }
  return catalogue;
}
