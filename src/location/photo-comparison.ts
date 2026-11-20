/** Compare a photo hypothesis with its submission-associated device reading. */
import type { CampusLocationCandidate, VisualPlan } from '../types';
import type { DeviceReading, LocationCatalogue } from './types';
import { deviceOverlay, overlapsBounds, overlapsFootprint } from './geometry';

export function comparePhotoLocation(
  candidate: CampusLocationCandidate,
  plan: VisualPlan,
  reading: DeviceReading,
  catalogue: LocationCatalogue,
) {
  const calibration = catalogue.floors.find((f) => f.planId === plan.id);
  const overlay = deviceOverlay(reading, plan, calibration);
  const building = catalogue.buildings.find((b) => b.building === plan.building);
  if (overlay && candidate.bounds) {
    return {
      overlay,
      message: overlapsBounds(overlay, candidate.bounds)
        ? 'The reported device area overlaps this possible photo region. Indoor bias and drawing alignment remain uncertain.'
        : 'The reported device area and this possible photo region disagree. Check your surroundings or request another reading.',
    };
  }
  return {
    overlay,
    message: building
      ? overlapsFootprint(reading, building.rings)
        ? 'The reported device area overlaps this building. The photo provides the floor and room evidence.'
        : 'The reported device area disagrees with this building. Check your surroundings or request another reading.'
      : 'Device comparison is unavailable for this source plan.',
  };
}
