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
};
export type StartingPoints = { networkRevision: number; origins: MapStop[] };
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
  revision: number;
  candidateId: string;
  destination: string;
  networkRevision?: number;
  originId?: string;
  destinationId?: string;
  originPoint?: FloorPin;
  destinationPoint?: FloorPin;
};
export type NavigationResult = {
  networkRevision: number;
  origins: MapStop[];
  destinations: PlaceChoice[];
  destinationMatch?: DestinationMatch;
  arrivalNote?: string;
} & (
  | {
      status:
        | 'choose-origin'
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
  | { status: 'route'; origin: MapStop; destination: MapStop; steps: WalkingStep[] }
);
