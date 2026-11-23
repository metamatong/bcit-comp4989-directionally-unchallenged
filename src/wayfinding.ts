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

/** Give vertical transfers a compact direction and destination floor. */
export function floorTransferInstruction(
  kind: 'stairs' | 'elevator',
  fromLabel: string,
  fromFloor: string,
  toFloor: string,
) {
  const from = /^-?\d+$/.test(fromFloor) ? Number(fromFloor) : NaN;
  const to = /^-?\d+$/.test(toFloor) ? Number(toFloor) : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to)
    return `${kind === 'stairs' ? 'Stairs' : 'Elevator'} at ${fromLabel} · Floor ${toFloor}.`;

  const direction = to > from ? '↑ UP' : '↓ DOWN';
  const location = fromLabel.split(' · ')[0];
  return kind === 'stairs'
    ? `Stairs at ${location} · ${direction} · Floor ${toFloor}.`
    : `Elevator at ${location} · ${direction} · Floor ${toFloor}.`;
}

/** Format a stop label with a middot qualifier as parenthetical prose while preserving exact IDs. */
export function formatStopLabel(label: string) {
  const parts = label
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts[0]} (${parts.slice(1).join(', ')})`;
}

/**
 * Concise single-sentence copy for the guided step sheet.
 * Derived from exact step endpoints and floor metadata so archived corridor-trace hashes remain
 * untouched and intermediate rooms walked past are not enumerated.
 */
export function guidedStepInstruction(
  step: WalkingStep,
  context?: { fromFloor?: string; toFloor?: string; targetPlanLabel?: string },
) {
  const from = formatStopLabel(step.from.label);
  const to = formatStopLabel(step.to.label);

  if (step.kind === 'corridor') {
    const genericFrom = !from || /^corridor$/i.test(from);
    const genericTo = !to || /^corridor$/i.test(to);
    if ((genericFrom && genericTo) || from === to) return 'Follow the blue line.';
    if (genericTo) return 'Follow the blue line.';
    return `Follow the blue line to ${to}.`;
  }

  if (step.kind === 'stairs' || step.kind === 'elevator') {
    const label = from.split(' (')[0];
    const isNamedStair = /^stairs?\b/i.test(label);
    const isNamedElevator = /elevator\b/i.test(label);
    if (step.kind === 'stairs') return isNamedStair ? `Take ${label}.` : `Take stairs at ${label}.`;
    return isNamedElevator ? `Take ${label}.` : `Take elevator at ${label}.`;
  }

  if (step.kind === 'building-link') {
    const target = context?.targetPlanLabel || to;
    return `Take the passage to ${target}.`;
  }

  const target = context?.targetPlanLabel || to;
  return `Go outside to ${target}. Path not mapped.`;
}

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
