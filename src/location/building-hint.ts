/** Convert an opted-in fresh device reading to source-bound building candidates on the device. */
import { eligibleReading } from './browser-location';
import { overlapsFootprint } from './geometry';
import type { DeviceReading, GpsBuildingHint, LocationCatalogue } from './types';

export function gpsBuildingHint(
  reading: DeviceReading,
  catalogue: LocationCatalogue,
): GpsBuildingHint {
  if (!eligibleReading(reading, Date.now()))
    throw Error('Request a fresh device location before locating the photo.');
  return {
    buildings: catalogue.buildings
      .filter((building) => overlapsFootprint(reading, building.rings))
      .map((building) => building.building),
    sourceSha256: catalogue.geographicSource.sha256,
    capturedAt: reading.timestamp,
    accuracy: reading.accuracy,
  };
}
