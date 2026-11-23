/** Build source-bound location coverage from archived official GIS and individually reviewed plans. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { visualPlans } from '../server/visual-data';
import { fitCalibration, localMetres } from '../src/location/geometry';
import type {
  CalibrationControl,
  FloorCalibration,
  LocationCatalogue,
} from '../src/location/types';

const file = 'data/campus/geolocation/bcit-burnaby-footprints.json';
const bytes = readFileSync(file);
const source = JSON.parse(bytes.toString());
const suppliedBuildings = new Set(visualPlans.map((plan) => plan.building));
if (
  source.error ||
  source.exceededTransferLimit ||
  source.spatialReference?.wkid !== 4326 ||
  !source.features?.length
)
  throw Error('Expected complete official BCIT WGS84 building footprints.');

// Prototype controls came from the same SE12-F3 PDF. Undo crop (200,660)-(3800,1800)
// and resize (2800,887) against a 4000px-wide rendering of its 1224x792pt page.
const measuredControls = [
  {
    label: 'NW main corner, ring vertex 43',
    latitude: 49.2504715666189,
    longitude: -123.001755908749,
    x: 115,
    y: 704,
  },
  {
    label: 'SE main corner, ring vertex 17',
    latitude: 49.2494375079103,
    longitude: -123.001426553242,
    x: 2795,
    y: 148,
  },
  {
    label: 'SW main corner, ring vertex 18',
    latitude: 49.2494387932512,
    longitude: -123.001758816794,
    x: 2795,
    y: 704,
  },
  {
    label: 'NE main corner, ring vertex 53, held out',
    latitude: 49.2504690666971,
    longitude: -123.001441208812,
    x: 115,
    y: 148,
  },
];
const controls: CalibrationControl[] = measuredControls.map((c) => ({
  ...c,
  x: (200 + (c.x * 3600) / 2800) / 4000,
  y: (660 + (c.y * 1140) / 887) / ((4000 * 792) / 1224),
}));

// Proposed outline registrations retained from the GPS coverage PR. Independent
// source correspondences are not archived, so these do not enable visitor dots.
// Raster coordinates use source-bound PNG dimensions; scales are pixels per metre.
const outlineRegistrations: Record<
  string,
  {
    sourceSha256: string;
    rotationDegrees: 0 | 90 | 180 | 270;
    scalePixelsPerMetre: number;
    translateX: number;
    translateY: number;
    rmsePixels: number;
  }
> = {
  'SE12-F1-p1': {
    sourceSha256: 'b87581c2dce2d170f90a0512267803567026395948ab381dcbd70a1f0c437f72',
    rotationDegrees: 0,
    scalePixelsPerMetre: 9.18486,
    translateX: 1454.838,
    translateY: 1391.279,
    rmsePixels: 6.985,
  },
  'SE12-F2-p1': {
    sourceSha256: '9cbb10dee2e102cb05baec386bae3b7dc51f43276f30c1807063015dbc41f545',
    rotationDegrees: 270,
    scalePixelsPerMetre: 8.046543,
    translateX: 1766.77,
    translateY: 707.42,
    rmsePixels: 7.798,
  },
  'SE12-F4-p1': {
    sourceSha256: 'd73872a56148fc1e6ac5592277e8ffb0b575ced1c501a1f5c939f7fa9bae88fb',
    rotationDegrees: 270,
    scalePixelsPerMetre: 23.3543,
    translateX: 1260.34,
    translateY: 987.13,
    rmsePixels: 6.037,
  },
  'SW3-F1-p1': {
    sourceSha256: '768da55d04f76d0d33ad2ff9822aac2d1ddc57c2c29cbc7c88890ca7ffac20b0',
    rotationDegrees: 0,
    scalePixelsPerMetre: 14.1538,
    translateX: 1340.31,
    translateY: 1186.55,
    rmsePixels: 5.246,
  },
  'SW3-F2-p1': {
    sourceSha256: '39b1a81a2706f7254b3175859e94348839385f0afed3b785561f6bad1e2b9fcc',
    rotationDegrees: 0,
    scalePixelsPerMetre: 17.7874,
    translateX: 1284.84,
    translateY: 1125.67,
    rmsePixels: 4.987,
  },
  'SW3-F3-p1': {
    sourceSha256: 'a34945534dd978027a28f5f2fbd0f018a03846360f9c36dc43c24f72d68a8874',
    rotationDegrees: 0,
    scalePixelsPerMetre: 11.0903,
    translateX: 1475.56,
    translateY: 1364.81,
    rmsePixels: 10.899,
  },
  'SW3-F4-p1': {
    sourceSha256: 'ec9b5c3ae80da356b78dc7ea89e3228e6cd6b5e882d9c20a6b7e10bbd5ec034a',
    rotationDegrees: 0,
    scalePixelsPerMetre: 11.0606,
    translateX: 1423.62,
    translateY: 1269.01,
    rmsePixels: 11.01,
  },
  'SW1-F1-p1': {
    sourceSha256: '23b7bcfabb01d07a22a25a58d6f8b49322e3f6c9f901b4b2e2a0331175766f90',
    rotationDegrees: 270,
    scalePixelsPerMetre: 8.9564,
    translateX: 1509.321,
    translateY: 1085.923,
    rmsePixels: 6.444,
  },
  'SW1-F2-p1': {
    sourceSha256: '37ab5548156a14f390b7d51010172c3ba7975744fb47ee441eee3586f5ce639b',
    rotationDegrees: 270,
    scalePixelsPerMetre: 9.212127,
    translateX: 1763.623,
    translateY: 1070.845,
    rmsePixels: 6.948,
  },
  'SW1-F3-p1': {
    sourceSha256: '68d980c7919448b4c843281c95f1f3ee07dbb90945f1335c354ce7b893a0bce2',
    rotationDegrees: 270,
    scalePixelsPerMetre: 8.181263,
    translateX: 1746.314,
    translateY: 986.184,
    rmsePixels: 7.056,
  },
  'SW5-F1-p1': {
    sourceSha256: '37105ff14e81094e4e968500a70da3cea6cd2e13803dd2853909ee35bcd10790',
    rotationDegrees: 0,
    scalePixelsPerMetre: 46.3901,
    translateX: 1620.01,
    translateY: 960.26,
    rmsePixels: 4.354,
  },
  'SW5-F2-p1': {
    sourceSha256: '3157fabbf5eeaa7751c0d66c3baa88ba6bc1029bce0013b7b75fe5f8bdb007b1',
    rotationDegrees: 0,
    scalePixelsPerMetre: 49.4396,
    translateX: 1660.82,
    translateY: 944.98,
    rmsePixels: 4.316,
  },
};

const stackedCores = {
  planId: 'SW1-F4-p1',
  sourcePlanId: 'SW1-F3-p1',
  sourceSha256: '68d980c7919448b4c843281c95f1f3ee07dbb90945f1335c354ce7b893a0bce2',
  targetSha256: 'ed111bbfb9b7423af5a9369253f7820ed4e7eddbe6bf3a3421cda77bf3f53e30',
  pageWidth: 1224,
  pageHeight: 792,
  controls: [
    {
      from: 'S300',
      to: 'S400',
      source: [232.7, 181.0] as [number, number],
      target: [78.3, 347.37],
    },
    {
      from: 'S320',
      to: 'S420',
      source: [477.2, 208.4] as [number, number],
      target: [387.075, 389.375],
    },
    {
      from: 'S350',
      to: 'S450',
      source: [861.2, 213.4] as [number, number],
      target: [867.075, 389.255],
    },
    {
      from: 'S390',
      to: 'S490',
      source: [1108.65, 182.8] as [number, number],
      target: [1176.25, 346.365],
    },
  ],
};

function geoAtPlanPoint(
  floorControls: CalibrationControl[],
  width: number,
  height: number,
  point: [number, number],
) {
  const origin = floorControls[0];
  const fitControls = floorControls.slice(0, 3);
  const local = fitControls.map((c) => localMetres(c, origin));
  const mean = (values: number[]) => values.reduce((sum, n) => sum + n, 0) / values.length;
  const east = mean(local.map((p) => p.x));
  const north = mean(local.map((p) => p.y));
  const imageX = mean(fitControls.map((c) => c.x * width));
  const imageY = mean(fitControls.map((c) => c.y * height));
  let denominator = 0;
  let rotation = 0;
  let crossRotation = 0;
  local.forEach((p, i) => {
    const x = p.x - east;
    const y = p.y - north;
    const dx = fitControls[i].x * width - imageX;
    const dy = fitControls[i].y * height - imageY;
    denominator += x * x + y * y;
    rotation += x * dx - y * dy;
    crossRotation += y * dx + x * dy;
  });
  const a = rotation / denominator;
  const b = crossRotation / denominator;
  const inverseDenominator = a * a + b * b;
  const dx = point[0] - imageX;
  const dy = point[1] - imageY;
  const localX = east + (a * dx + b * dy) / inverseDenominator;
  const localY = north + (b * dx - a * dy) / inverseDenominator;
  const latitude = origin.latitude + localY / (6371008.8 * (Math.PI / 180));
  const longitude =
    origin.longitude +
    localX / (6371008.8 * (Math.PI / 180) * Math.cos(origin.latitude * (Math.PI / 180)));
  return { latitude, longitude };
}

function stackedCoreControls(
  sourceControls: CalibrationControl[],
  sourcePlan: (typeof visualPlans)[number],
  targetPlan: (typeof visualPlans)[number],
): CalibrationControl[] {
  if (
    sourcePlan.id !== stackedCores.sourcePlanId ||
    targetPlan.id !== stackedCores.planId ||
    sourcePlan.sourceSha256 !== stackedCores.sourceSha256 ||
    targetPlan.sourceSha256 !== stackedCores.targetSha256
  )
    throw Error('A stacked-core drawing source changed. Review its core correspondences.');
  return stackedCores.controls.map((control, index) => ({
    label: `Shared stair core ${control.from} to ${control.to}${index === 3 ? ' (held out)' : ''}`,
    ...geoAtPlanPoint(sourceControls, sourcePlan.width, sourcePlan.height, control.source),
    x: control.target[0] / stackedCores.pageWidth,
    y: control.target[1] / stackedCores.pageHeight,
  }));
}

function footprintControls(
  ring: number[][],
  plan: (typeof visualPlans)[number],
  registration: (typeof outlineRegistrations)[string],
): CalibrationControl[] {
  const vertices = ring.slice(0, -1);
  const origin = {
    longitude: vertices.reduce((sum, point) => sum + point[0], 0) / vertices.length,
    latitude: vertices.reduce((sum, point) => sum + point[1], 0) / vertices.length,
  };
  const angle = (registration.rotationDegrees * Math.PI) / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const candidates = vertices.map(([longitude, latitude], index) => {
    const local = localMetres({ longitude, latitude }, origin);
    return {
      index,
      longitude,
      latitude,
      x:
        registration.scalePixelsPerMetre * (cosine * local.x + sine * local.y) +
        registration.translateX,
      y:
        registration.scalePixelsPerMetre * (sine * local.x - cosine * local.y) +
        registration.translateY,
    };
  });
  const inside = candidates.filter(
    (point) =>
      point.x >= 0 && point.x <= plan.full.width && point.y >= 0 && point.y <= plan.full.height,
  );
  let training: [number, number, number] | undefined;
  let largestTriangle = 0;
  for (let a = 0; a < inside.length - 2; a++) {
    for (let b = a + 1; b < inside.length - 1; b++) {
      for (let c = b + 1; c < inside.length; c++) {
        const area = Math.abs(
          (inside[b].x - inside[a].x) * (inside[c].y - inside[a].y) -
            (inside[b].y - inside[a].y) * (inside[c].x - inside[a].x),
        );
        if (area > largestTriangle) {
          largestTriangle = area;
          training = [a, b, c];
        }
      }
    }
  }
  if (!training || largestTriangle < 1000)
    throw Error(`Could not choose stable footprint controls for ${plan.id}.`);
  const used = new Set(training);
  const center = {
    x: training.reduce((sum, index) => sum + inside[index].x, 0) / 3,
    y: training.reduce((sum, index) => sum + inside[index].y, 0) / 3,
  };
  const heldOutIndex = inside.reduce(
    (best, point, index) => {
      if (used.has(index)) return best;
      const current = inside[best];
      return (point.x - center.x) ** 2 + (point.y - center.y) ** 2 >
        (current.x - center.x) ** 2 + (current.y - center.y) ** 2
        ? index
        : best;
    },
    inside.findIndex((_point, index) => !used.has(index)),
  );
  const selected = [...training.map((index) => inside[index]), inside[heldOutIndex]];
  return selected.map((point, index) => ({
    label: `Footprint boundary vertex ${point.index}${index === 3 ? ' (held out)' : ''}`,
    latitude: point.latitude,
    longitude: point.longitude,
    x: point.x / plan.full.width,
    y: point.y / plan.full.height,
  }));
}

function outlineControlsForPlan(
  plan: (typeof visualPlans)[number],
  registration: (typeof outlineRegistrations)[string],
) {
  const feature = source.features.find(
    (f: { attributes: { BuildingName: string } }) => f.attributes.BuildingName === plan.building,
  );
  if (!feature) throw Error(`Missing footprint for ${plan.building}.`);
  return footprintControls(feature.geometry.rings[0], plan, registration);
}

const proposedFloors = visualPlans.map((plan) => {
  const available =
    plan.id === 'SE12-F3-p1' || plan.id in outlineRegistrations || plan.id === stackedCores.planId;
  const registration = outlineRegistrations[plan.id];
  if (
    plan.id === 'SE12-F3-p1' &&
    plan.sourceSha256 !== '521d90e70cda6b4fd58c0e00219fdcefb8ff605787b36bf383d124a129e794f1'
  )
    throw Error('SE12 floor 3 source changed. Review controls before regenerating.');
  if (registration && plan.sourceSha256 !== registration.sourceSha256)
    throw Error(
      `${plan.id} source changed. Review its geographic registration before regenerating.`,
    );
  const sourcePlan =
    plan.id === stackedCores.planId
      ? visualPlans.find((item) => item.id === stackedCores.sourcePlanId)!
      : undefined;
  const sourceControls = sourcePlan
    ? outlineControlsForPlan(sourcePlan, outlineRegistrations[sourcePlan.id])
    : undefined;
  const floorControls =
    plan.id === 'SE12-F3-p1'
      ? controls
      : registration
        ? outlineControlsForPlan(plan, registration)
        : plan.id === stackedCores.planId
          ? stackedCoreControls(sourceControls!, sourcePlan!, plan)
          : [];
  const fit = available ? fitCalibration(floorControls, plan.width, plan.height) : null;
  const method: FloorCalibration['method'] =
    plan.id === 'SE12-F3-p1'
      ? 'manual-corners'
      : registration
        ? 'footprint-outline'
        : plan.id === stackedCores.planId
          ? 'stacked-cores'
          : undefined;
  return {
    planId: plan.id,
    sourceSha256: plan.sourceSha256,
    status: available ? ('approximate' as const) : ('unavailable' as const),
    ...(method ? { method } : {}),
    reason: available
      ? plan.id === stackedCores.planId
        ? `Approximate stacked-floor registration from SW01 floor 3 using three shared stair cores (S300/S320/S350 to S400/S420/S450); the fourth pair (S390 to S490) was held out at ${fit?.residuals.at(-1)?.toFixed(2)} m. Floor-specific indoor accuracy remains unmeasured.`
        : registration
          ? `Approximate full-page registration to the archived ${plan.building} ground footprint (boundary RMS ${(
              registration.rmsePixels / registration.scalePixelsPerMetre
            ).toFixed(2)} m). Floor-specific indoor accuracy remains unmeasured.`
          : 'Approximate four-corner alignment to the source-bound SE12 floor 3 drawing. Floor-specific indoor accuracy remains unmeasured.'
      : `${plan.building} floor ${plan.floor} has no floor-specific geographic alignment.`,
    version: available ? 'bcit-pilot-2026-11-19-v3' : 'bcit-pilot-2026-11-16-v1',
    controls: floorControls,
    residualsMetres: fit?.residuals.slice(0, -1) ?? [],
    heldOutMetres: fit?.residuals.at(-1) ?? null,
    ...(registration
      ? { registrationRmseMetres: registration.rmsePixels / registration.scalePixelsPerMetre }
      : {}),
  };
});
// Outline controls (including their fourth point) come from the same proposed
// transform. Their residuals cannot independently validate drawing alignment.
// SW01-F4 also depends on an unverified outline transform on SW01-F3.
const candidates = proposedFloors.filter(
  (floor) => floor.status === 'approximate' && floor.planId !== 'SE12-F3-p1',
);
const floors: FloorCalibration[] = proposedFloors.map((floor) =>
  candidates.includes(floor)
    ? {
        planId: floor.planId,
        sourceSha256: floor.sourceSha256,
        status: 'unavailable',
        version: 'bcit-pilot-2026-11-19-pending-evidence',
        reason:
          'A proposed alignment is retained for development. Independent source correspondences are missing; the GPS dot is hidden.',
        controls: [],
        residualsMetres: [],
        heldOutMetres: null,
      }
    : floor,
);
const catalogue: LocationCatalogue = {
  geographicSource: {
    url: 'https://services2.arcgis.com/IgcrRjRW95F0HKSw/arcgis/rest/services/Bsite_Building_Footprint_20241022/FeatureServer/0/query?where=1%3D1&outFields=BuildingName%2COBJECTID&outSR=4326&returnGeometry=true&f=json',
    retrievedAt: '2026-11-18',
    file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
  buildings: source.features
    .filter((f: { attributes: { BuildingName: string } }) =>
      suppliedBuildings.has(f.attributes.BuildingName),
    )
    .map(
      (feature: { attributes: { BuildingName: string }; geometry: { rings: number[][][] } }) => ({
        building: feature.attributes.BuildingName,
        rings: feature.geometry.rings,
      }),
    ),
  floors,
};
writeFileSync(
  'data/campus/geolocation/calibration-candidates.json',
  JSON.stringify(
    {
      status: 'pending-independent-source-evidence',
      geographicSource: catalogue.geographicSource,
      note: 'Not consumed by the visitor app. Outline controls and residuals are derived from the proposed transform, not independent validation. Stacked-core alignment inherits that uncertainty.',
      floors: candidates.map(({ status: _status, heldOutMetres, ...floor }) => ({
        ...floor,
        status: 'candidate',
        fourthControlResidualMetres: heldOutMetres,
      })),
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  'data/campus/geolocation/calibrations.json',
  JSON.stringify(catalogue, null, 2) + '\n',
);
console.log(
  `Prepared ${floors.length} floor coverage entries; ${floors.filter((f) => f.status === 'approximate').length} approximate alignment.`,
);
