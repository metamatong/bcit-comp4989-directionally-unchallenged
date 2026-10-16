import { describe, expect, it } from 'vitest';
import { directionCatalogue, resolveCampusDestination, routeCampus } from '../server/directions';
import { photoRouteStart } from '../src/directions';
import type { CampusLocationCandidate } from '../src/types';

const estimatedLocation = (building: string) =>
  ({
    id: 'confirmed',
    planId: `${building}-F1-p1`,
    sourceRef: `${building}-F1#page=1`,
    building,
    floor: '1',
    page: 1,
    bounds: [0.2, 0.2, 0.4, 0.4],
    confidence: 'low',
    matches: [],
    limitations: [],
    labelMatches: [],
    verification: 'unverified-ai-hypothesis',
  }) satisfies CampusLocationCandidate;

describe('source-traced Burnaby campus directions', () => {
  it('provides a connected route through mapped pedestrian segments', () => {
    const route = routeCampus('nw4-vicinity', 'se16-vicinity');
    expect(route.start.label).toBe('NW4 map-side vicinity');
    expect(route.destination.label).toBe('SE16 map-side vicinity');
    expect(route.segments.length).toBeGreaterThan(1);
    expect(route.segments.every((segment) => segment.sourceRef === route.sourceRef)).toBe(true);
    expect(route.segments[0].points[0]).toEqual(route.start.mapPoint);
    expect(route.segments.at(-1)?.points.at(-1)).toEqual(route.destination.mapPoint);
    expect(directionCatalogue.mapImage.width).toBe(520);
    expect(directionCatalogue.mapImage.height).toBe(530);
    expect(route.limitations.join(' ')).toContain('not been field-verified');
  });

  it('offers a connected outdoor pilot network without representing floor-plan locations as route starts', () => {
    expect(directionCatalogue.available).toBe(true);
    expect(directionCatalogue.nodes).toHaveLength(13);
    expect(directionCatalogue.segmentCount).toBe(14);
    expect(directionCatalogue.mapImage.sourceRef).toBe('burnaby-wayfinding#page=1');
    expect(directionCatalogue.nodes.some((node) => node.id === 'campus-square')).toBe(true);
    expect(directionCatalogue.nodes.every((node) => !('floor' in node))).toBe(true);
    for (const start of directionCatalogue.nodes) {
      for (const destination of directionCatalogue.nodes) {
        if (start.id !== destination.id)
          expect(() => routeCampus(start.id, destination.id)).not.toThrow();
      }
    }
  });

  it('reverses route geometry when routing in the opposite direction', () => {
    const route = routeCampus('se16-vicinity', 'nw4-vicinity');
    expect(route.segments[0].points[0]).toEqual(route.start.mapPoint);
    expect(route.segments.at(-1)?.points.at(-1)).toEqual(route.destination.mapPoint);
    expect(route.segments[0].edgeId).toBe('south-commons-se16');
    expect(route.segments[0].points[0]).toEqual([0.612, 0.923]);
    expect(route.segments[0].points.at(-1)).toEqual([0.412, 0.713]);
    expect(route).not.toHaveProperty('steps');
  });

  it('uses only an exact mapped building match for an unverified photo estimate', () => {
    expect(photoRouteStart(estimatedLocation('SE12'), directionCatalogue.nodes)?.id).toBe(
      'se12-vicinity',
    );
    expect(photoRouteStart(estimatedLocation('SE1'), directionCatalogue.nodes)).toBeUndefined();
    expect(photoRouteStart(null, directionCatalogue.nodes)).toBeUndefined();
  });

  it('resolves typed room labels using exact source labels and requires context for ambiguous labels', () => {
    expect(resolveCampusDestination('SE12 Floor 3 302')).toMatchObject({
      kind: 'room-label',
      nodeId: 'se12-vicinity',
      resolution: { building: 'SE12', floor: '3', sourceRef: 'SE12-F3#page=1' },
    });
    expect(() => resolveCampusDestination('312')).toThrow(
      'This label appears in multiple buildings',
    );
    expect(() => resolveCampusDestination('SE12 Floor 3 3021')).toThrow(
      'No exact source-plan label found',
    );
  });

  it('rejects unknown or identical endpoints rather than fabricating a route', () => {
    expect(() => routeCampus('not-mapped', 'se16-vicinity')).toThrow('Choose a start');
    expect(() => routeCampus('se16-vicinity', 'se16-vicinity')).toThrow('Choose two different');
  });
});
