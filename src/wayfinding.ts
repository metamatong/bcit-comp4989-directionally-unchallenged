import type { PlanBounds } from './types';

/** A named room is always resolved by the router. Only these requests need a destination pin. */
export function mapDestinationScope(
  value: string,
): { building?: string; floor?: string } | undefined {
  const text = value.normalize('NFKC').trim();
  if (/^map point$/i.test(text)) return {};
  const match = /^(NE|NW|SE|SW)\s*-?\s*(\d+)(?:\s+floor\s+(\d+))?$/i.exec(text);
  if (match) return { building: match[1].toUpperCase() + Number(match[2]), floor: match[3] };
}

export type PagePoint = { x: number; y: number };
export type FloorPin = {
  planId: string;
  sourceSha256: string;
  graphVersion: string;
  point: PagePoint;
};
export type WalkingSurface = Omit<FloorPin, 'point'> & {
  step: number;
  runs: [number, number, number][];
  interiorRuns?: [number, number, number][];
};
export type MapStop = {
  id: string;
  planId: string;
  label: string;
  point: PagePoint;
  startRegion?: PlanBounds;
  corridorVicinity?: boolean;
  sharedEntrance?: string;
};
export type PlaceChoice = {
  id: string;
  planId: string;
  label: string;
  bounds?: PlanBounds;
  point?: PagePoint;
};
export type DestinationMatch = { requested: string; matched: string };
export type OriginIssue =
  'unmapped-doorway' | 'unmapped-connection' | 'ambiguous-doorway' | 'ambiguous-region';
export type WalkingStep = {
  kind: 'corridor' | 'stairs' | 'elevator' | 'building-link' | 'outdoor';
  from: MapStop;
  to: MapStop;
  instruction: string;
  /** Ordered in the direction of travel, on a single original page. */
  path: PagePoint[];
};
export type NavigationChoice = {
  preferElevators?: boolean;
  revision: number;
  candidateId: string;
  destination: string;
  networkRevision?: number;
  destinationId?: string;
  destinationPoint?: FloorPin;
};
export type WalkingPath = { origin: MapStop; destination: MapStop; steps: WalkingStep[] };
export type NavigationResult = {
  networkRevision: number;
  origins: MapStop[];
  destinations: PlaceChoice[];
  destinationMatch?: DestinationMatch;
  arrivalNote?: string;
  /** The first or last stretch between a printed place and a public stop is unverified. */
  mappedPortion?: WalkingPath & { requested?: PlaceChoice; requestedOrigin?: PlaceChoice };
  restriction?: 'staff-only' | 'non-walking';
} & (
  | {
      status:
        | 'choose-destination'
        | 'unknown-destination'
        | 'restricted-place'
        | 'unmapped-origin'
        | 'unsupported-building'
        | 'unmapped-destination'
        | 'unmapped-origin-and-destination'
        | 'no-route';
      message: string;
      originIssue?: OriginIssue;
    }
  | ({ status: 'route' } & WalkingPath)
);
