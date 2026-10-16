import type { CampusLocationCandidate, RouteNode } from './types';

export function photoRouteStart(
  location: CampusLocationCandidate | null,
  nodes: RouteNode[],
): RouteNode | undefined {
  if (!location) return undefined;
  return nodes.find(
    (node) => node.kind === 'building-vicinity' && node.building === location.building,
  );
}
