/** Build source-bound location coverage from archived official GIS and individually reviewed plans. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { visualPlans } from '../server/visual-data';
import { fitCalibration } from '../src/location/geometry';
import type { CalibrationControl, LocationCatalogue } from '../src/location/types';

const file = 'data/campus/geolocation/bcit-pilot-footprints.json';
const bytes = readFileSync(file);
const source = JSON.parse(bytes.toString());
if (source.error || source.spatialReference?.wkid !== 4326 || source.features?.length !== 3)
  throw Error('Expected three official BCIT WGS84 building footprints.');

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
const floors = visualPlans
  .filter((p) => ['SE12', 'SW3', 'SW1'].includes(p.building))
  .map((plan) => {
    const available = plan.id === 'SE12-F3-p1';
    if (
      available &&
      plan.sourceSha256 !== '521d90e70cda6b4fd58c0e00219fdcefb8ff605787b36bf383d124a129e794f1'
    )
      throw Error('SE12 floor 3 source changed. Review controls before regenerating.');
    const fit = available ? fitCalibration(controls, plan.width, plan.height) : null;
    const reasons: Record<string, string> = {
      'SE12-F1-p1':
        'Partial footprint on a rotated first-floor drawing. Four geographic corner correspondences remain unresolved.',
      'SE12-F2-p1':
        'Different drawing extent and incomplete main-corner correspondence. Independent controls remain unresolved.',
      'SE12-F4-p1':
        'Main rectangle resembles floor 3, but independent geographic corner correspondence remains unreviewed.',
    };
    return {
      planId: plan.id,
      sourceSha256: plan.sourceSha256,
      status: available ? ('approximate' as const) : ('unavailable' as const),
      reason: available
        ? 'Prototype corner correspondence reviewed against the same source PDF. Ground footprint may differ from floor 3. Indoor accuracy remains unmeasured.'
        : (reasons[plan.id] ??
          `${plan.building} floor ${plan.floor} drawing extent reviewed. Four independently matched geographic controls remain unresolved for this floor.`),
      version: 'bcit-pilot-2026-11-16-v1',
      controls: available ? controls : [],
      residualsMetres: fit?.residuals.slice(0, -1) ?? [],
      heldOutMetres: fit?.residuals.at(-1) ?? null,
    };
  });
const catalogue: LocationCatalogue = {
  geographicSource: {
    url: 'https://services2.arcgis.com/IgcrRjRW95F0HKSw/arcgis/rest/services/Bsite_Building_Footprint_20241022/FeatureServer/0/query?objectIds=19%2C21%2C33&outFields=BuildingName%2COBJECTID&outSR=4326&returnGeometry=true&f=json',
    retrievedAt: '2026-11-16',
    file,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  },
  buildings: source.features.map(
    (feature: { attributes: { BuildingName: string }; geometry: { rings: number[][][] } }) => ({
      building: feature.attributes.BuildingName,
      rings: feature.geometry.rings,
    }),
  ),
  floors,
};
writeFileSync(
  'data/campus/geolocation/calibrations.json',
  JSON.stringify(catalogue, null, 2) + '\n',
);
console.log(
  `Prepared ${floors.length} floor coverage entries; ${floors.filter((f) => f.status === 'approximate').length} approximate alignment.`,
);
