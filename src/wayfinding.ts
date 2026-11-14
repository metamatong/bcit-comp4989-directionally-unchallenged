import type { PlanBounds } from './types';

export type PagePoint = { x: number; y: number };
export type MapStop = { id: string; planId: string; label: string; point: PagePoint };
export type PlaceChoice = {
  id: string;
  planId: string;
  label: string;
  bounds?: PlanBounds;
  point?: PagePoint;
};
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
};
export type NavigationResult = {
  networkRevision: number;
  origins: MapStop[];
  destinations: PlaceChoice[];
} & (
  | {
      status:
        | 'choose-origin'
        | 'choose-destination'
        | 'unknown-destination'
        | 'unmapped-origin'
        | 'unmapped-destination'
        | 'unmapped-origin-and-destination'
        | 'no-route';
      message: string;
    }
  | { status: 'route'; origin: MapStop; destination: MapStop; steps: WalkingStep[] }
);
