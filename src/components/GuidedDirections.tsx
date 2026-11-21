/** Manual progress through saved route steps; never infers movement or camera heading. */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { NavigationResult, WalkingSurface } from '../wayfinding';
import type { VisualPlan } from '../types';
import { fetchWalkingSurface } from '../api';
import { planLabel } from '../topology';
import { RouteMap } from './RouteMap';
import type { DeviceOverlay, DeviceReading, LocationCatalogue } from '../location/types';
import { overlapsFootprint } from '../location/geometry';
import {
  matchDeviceToFloor,
  type MapMatchResult,
  type PreviousMatch,
} from '../location/map-matching';
import { useWalkingLocation } from '../location/use-device-location';

type MatchHistory = {
  planId: string;
  prior: PreviousMatch | null;
  latest: PreviousMatch;
};

function locationStatusMessage({
  complete,
  reading,
  trackingStatus,
  hasStaleReading,
  hasBuilding,
  withinBuilding,
  plan,
  matchResult,
  device,
}: {
  complete: boolean;
  reading: DeviceReading | null;
  trackingStatus: string;
  hasStaleReading: boolean;
  hasBuilding: boolean;
  withinBuilding: boolean;
  plan: VisualPlan;
  matchResult: MapMatchResult | null;
  device: DeviceOverlay | null;
}) {
  if (complete) return 'Location tracking stopped. Route complete.';
  if (!reading) {
    return trackingStatus || (hasStaleReading ? 'Waiting for a fresh GPS update…' : 'Waiting for GPS…');
  }
  const floor = planLabel(plan);
  if (!hasBuilding) {
    return `An official building footprint is unavailable for ${floor}. The position dot is hidden.`;
  }
  if (matchResult?.status === 'unavailable') {
    return `A floor-plan alignment is unavailable for ${floor}. The position dot is hidden.`;
  }
  if (matchResult?.status === 'low-accuracy') {
    return `GPS accuracy is too wide (±${reading.accuracy.toFixed(0)} m) to place a position on ${floor}. The position dot is hidden.`;
  }
  if (matchResult?.status === 'too-far') {
    return `The GPS reading is too far from mapped corridors on ${floor}. The position dot is hidden.`;
  }
  if (matchResult?.status === 'raw' && !withinBuilding) {
    return 'The GPS area does not overlap this building. The position dot is hidden.';
  }
  if (matchResult?.status === 'outside-page' || !device) {
    return 'The GPS position falls outside this floor drawing. The position dot is hidden.';
  }
  if (device.snapDistanceMetres !== undefined) {
    return `Approximate corridor match on ${floor} · raw GPS ~${Math.round(device.snapDistanceMetres)} m away · reported ±${reading.accuracy.toFixed(0)} m · indoor accuracy unmeasured.`;
  }
  return `GPS position is approximate on ${floor} · reported accuracy ±${reading.accuracy.toFixed(0)} m · indoor accuracy unmeasured.`;
}

export function GuidedDirections({
  route,
  plans,
  locationCatalogue,
  walkingSurfaces,
  index,
  onStepChange,
  transferNotice,
  onOverview,
}: {
  route: Extract<NavigationResult, { status: 'route' }>;
  plans: VisualPlan[];
  locationCatalogue?: LocationCatalogue;
  walkingSurfaces?: Record<string, WalkingSurface | null>;
  index: number;
  onStepChange: (index: number) => void;
  transferNotice?: string;
  onOverview: () => void;
}) {
  const tracking = useWalkingLocation(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const [loadedSurfaces, setLoadedSurfaces] = useState<Record<string, WalkingSurface | null>>({});
  const matchHistory = useRef<MatchHistory | null>(null);
  const step = route.steps[index];
  const complete = !step;
  const transfer = !!step && step.from.planId !== step.to.planId;
  const stop = complete ? route.destination : step.from;
  const plan = plans.find((item) => item.id === stop.planId)!;
  const calibration = locationCatalogue?.floors.find((floor) => floor.planId === plan.id);
  const building = locationCatalogue?.buildings.find((item) => item.building === plan.building);
  const hasProvidedSurface = !!walkingSurfaces && plan.id in walkingSurfaces;
  const surface = hasProvidedSurface ? walkingSurfaces[plan.id] : loadedSurfaces[plan.id];

  useEffect(() => {
    if (complete || hasProvidedSurface || plan.id in loadedSurfaces) return;
    const controller = new AbortController();
    fetchWalkingSurface(plan.id, controller.signal).then((fetched) => {
      if (!controller.signal.aborted) {
        setLoadedSurfaces((current) =>
          plan.id in current ? current : { ...current, [plan.id]: fetched },
        );
      }
    });
    return () => controller.abort();
  }, [complete, hasProvidedSurface, loadedSurfaces, plan.id]);

  const reading = !complete && tracking.fresh ? (tracking.reading ?? null) : null;
  const history = matchHistory.current;
  // Re-renders on the 500 ms freshness tick reuse `prior` so continuity stays idempotent.
  const previousMatch =
    reading && history && history.planId === plan.id
      ? history.latest.timestamp === reading.timestamp
        ? history.prior
        : history.latest.timestamp < reading.timestamp
          ? history.latest
          : null
      : null;

  const matchResult =
    reading && building
      ? matchDeviceToFloor({
          reading,
          plan,
          calibration,
          surface,
          routePath: step?.kind === 'corridor' ? step.path : undefined,
          stepKind: step?.kind,
          previous: previousMatch,
        })
      : null;

  const withinBuilding =
    matchResult?.status === 'raw' && !!reading && !!building
      ? overlapsFootprint(reading, building.rings)
      : false;
  const device =
    matchResult?.status === 'matched'
      ? matchResult.overlay
      : matchResult?.status === 'raw' && withinBuilding
        ? matchResult.overlay
        : null;

  useEffect(() => {
    if (complete || !tracking.active) {
      matchHistory.current = null;
      return;
    }
    const current = matchHistory.current?.planId === plan.id ? matchHistory.current : null;
    if (!current) matchHistory.current = null;
    if (!reading || matchResult?.status !== 'matched') return;
    if (current?.latest.timestamp === reading.timestamp) return;
    matchHistory.current = {
      planId: plan.id,
      prior: current?.latest ?? null,
      latest: { point: matchResult.overlay.point, timestamp: reading.timestamp },
    };
  }, [complete, matchResult, plan.id, reading, tracking.active]);

  const positionStatus = locationStatusMessage({
    complete,
    reading,
    trackingStatus: tracking.status,
    hasStaleReading: !!tracking.reading,
    hasBuilding: !!building,
    withinBuilding,
    plan,
    matchResult,
    device,
  });
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({ block: 'start' });
  }, [index]);
  function move(next: number) {
    if (next >= route.steps.length) tracking.stop();
    onStepChange(next);
  }
  return (
    <section className="guided-directions" aria-label="Step-by-step directions">
      <button type="button" className="text-button" onClick={onOverview}>
        <ArrowLeft size={17} /> Route overview
      </button>
      <div className="guided-map">
        <RouteMap
          key={`${index}-${plan.id}`}
          plan={plan}
          label={`${planLabel(plan)} · ${complete ? 'Destination' : `Step ${index + 1}`}`}
          paths={step?.kind === 'corridor' ? [step.path] : []}
          device={device}
          markers={
            step?.kind === 'corridor'
              ? [
                  { point: step.from.point, symbol: 'A', label: step.from.label },
                  { point: step.to.point, symbol: 'B', label: step.to.label, end: true },
                ]
              : [
                  {
                    point: stop.point,
                    symbol: complete ? 'B' : 'A',
                    label: stop.label,
                    end: complete,
                  },
                ]
          }
        />
      </div>
      <div className="guided-step" aria-live="polite">
        <p className="guided-step-count">
          {complete ? 'Route complete' : `Step ${index + 1} of ${route.steps.length}`}
        </p>
        <h2 ref={heading} tabIndex={-1}>
          {complete ? `Destination: ${route.destination.label}` : step.instruction}
        </h2>
        {!complete && (
          <p>
            {step.from.label} → {step.to.label}
            {transfer && (
              <>
                {' · '}
                {planLabel(plans.find((p) => p.id === step.from.planId)!)} →{' '}
                {planLabel(plans.find((p) => p.id === step.to.planId)!)}
              </>
            )}
          </p>
        )}
      </div>
      {index === 0 && transferNotice && (
        <p className="helper" role="note">
          {transferNotice}
        </p>
      )}
      <p className="guided-location-status" role="status">
        {device && <span className="guided-location-dot" aria-hidden="true" />}
        {positionStatus}
      </p>
      <div className="guided-controls">
        <button
          type="button"
          className="secondary"
          disabled={index === 0}
          onClick={() => move(index - 1)}
        >
          <ArrowLeft size={17} /> Previous
        </button>
        {complete ? (
          <button type="button" className="primary" onClick={onOverview}>
            Done
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => move(index + 1)}>
            {index === route.steps.length - 1 ? 'Finish route' : 'Next step'}{' '}
            <ArrowRight size={17} />
          </button>
        )}
      </div>
    </section>
  );
}
