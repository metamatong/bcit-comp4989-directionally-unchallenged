/** Visitor-facing scope; the source archive remains campus-wide. */
import type { VisualPlan } from '../src/types';

export const PILOT_BUILDINGS = ['SE12', 'SW3', 'SW5', 'SW1'] as const;
export type PilotScopeBuilding = (typeof PILOT_BUILDINGS)[number];

const aliases: Record<string, PilotScopeBuilding> = {
  SE12: 'SE12',
  SW03: 'SW3',
  SW3: 'SW3',
  SW05: 'SW5',
  SW5: 'SW5',
  SW01: 'SW1',
  SW1: 'SW1',
};

export function canonicalPilotBuilding(value: string): PilotScopeBuilding | undefined {
  const key = value.normalize('NFKC').trim().toUpperCase();
  return aliases[key];
}

export function isPilotBuilding(value: string) {
  return PILOT_BUILDINGS.includes(value as PilotScopeBuilding);
}

export function isPilotPlan(plan: VisualPlan) {
  return isPilotBuilding(plan.building);
}
