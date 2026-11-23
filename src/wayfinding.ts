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

/** Give vertical transfers explicit travel direction, floor count and destination. */
export function floorTransferInstruction(
  kind: 'stairs' | 'elevator',
  fromLabel: string,
  fromFloor: string,
  toFloor: string,
) {
  const from = /^-?\d+$/.test(fromFloor) ? Number(fromFloor) : NaN;
  const to = /^-?\d+$/.test(toFloor) ? Number(toFloor) : NaN;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === to)
    return `From Floor ${fromFloor}, at ${fromLabel}, take the ${kind} to Floor ${toFloor}.`;

  const direction = to > from ? 'UP ↑' : 'DOWN ↓';
  const count = Math.abs(to - from);
  const floors = `${count} ${count === 1 ? 'floor' : 'floors'}`;
  return kind === 'stairs'
    ? `From Floor ${fromFloor}, at ${fromLabel}, take the stairs ${direction} ${floors} to Floor ${toFloor}.`
    : `From Floor ${fromFloor}, at ${fromLabel}, take the elevator ${direction} ${floors} to Floor ${toFloor}. Select Floor ${toFloor}.`;
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
    if ((genericFrom && genericTo) || from === to) return 'Follow the marked corridor.';
    if (genericFrom) return `Follow the corridor to ${to}.`;
    if (genericTo) return `Follow the corridor from ${from}.`;
    if (/^corridor\b/i.test(from)) return `Walk from ${from} to ${to}.`;
    return `Follow the corridor from ${from} to ${to}.`;
  }

  if (step.kind === 'stairs' || step.kind === 'elevator') {
    const action =
      step.kind === 'stairs'
        ? /^stairs?\b/i.test(from)
          ? `Take ${from}`
          : `Take the stairs at ${from}`
        : /elevator\b/i.test(from)
          ? `Take ${from}`
          : `Take the elevator at ${from}`;
    const fromFloor = context?.fromFloor ?? '';
    const toFloor = context?.toFloor ?? '';
    const fromNum = /^-?\d+$/.test(fromFloor) ? Number(fromFloor) : NaN;
    const toNum = /^-?\d+$/.test(toFloor) ? Number(toFloor) : NaN;
    if (Number.isFinite(fromNum) && Number.isFinite(toNum) && fromNum !== toNum) {
      const direction = toNum > fromNum ? 'UP ↑' : 'DOWN ↓';
      const count = Math.abs(toNum - fromNum);
      const floors = `${count} ${count === 1 ? 'floor' : 'floors'}`;
      return `${action} ${direction} ${floors} to Floor ${toFloor}.`;
    }
    return toFloor ? `${action} to Floor ${toFloor}.` : step.instruction;
  }

  if (step.kind === 'building-link') {
    const target = context?.targetPlanLabel || to;
    return `Use the connecting passage to ${target}.`;
  }

  const targetSuffix = context?.targetPlanLabel ? ` (${context.targetPlanLabel})` : '';
  return `Walk outdoors from ${from} to ${to}${targetSuffix}. Outdoor path unmapped.`;
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
