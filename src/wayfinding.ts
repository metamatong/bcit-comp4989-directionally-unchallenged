import type { PlanBounds } from './types';

export type PagePoint = { x: number; y: number };
export type MapStop = { id: string; planId: string; label: string; point: PagePoint };
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
  preferElevators?: boolean;
  revision: number;
  candidateId: string;
  destination: string;
  networkRevision?: number;
  originId?: string;
  destinationId?: string;
};
export type NavigationResult = {
  networkRevision: number;
  origins: MapStop[];
  destinations: PlaceChoice[];
  destinationMatch?: DestinationMatch;
} & (
  | {
      status:
        | 'choose-origin'
        | 'choose-destination'
        | 'unknown-destination'
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
