/** Manual progress through saved route steps; never infers movement or camera heading. */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Maximize2, Minimize2 } from 'lucide-react';
import type { NavigationResult, WalkingSurface } from '../wayfinding';
import type { VisualPlan } from '../types';
import { fetchWalkingSurface } from '../api';
import { planLabel } from '../topology';
import { RouteMapImage } from './RouteMap';
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
    return `Building footprint unavailable for ${floor}. Position dot hidden.`;
  }
  if (matchResult?.status === 'unavailable') {
    return `Floor-plan alignment is unavailable for ${floor}. Position dot hidden.`;
  }
  if (matchResult?.status === 'low-accuracy') {
    return `GPS accuracy too wide (±${reading.accuracy.toFixed(0)} m). Position dot hidden.`;
  }
  if (matchResult?.status === 'too-far') {
    return `GPS reading is outside mapped corridors on ${floor}. Position dot hidden.`;
  }
  if (matchResult?.status === 'raw' && !withinBuilding) {
    return 'GPS area does not overlap this building. Position dot hidden.';
  }
  if (matchResult?.status === 'outside-page' || !device) {
    return 'GPS position falls outside this floor plan. Position dot hidden.';
  }
  if (device.snapDistanceMetres !== undefined) {
    return `Approx. corridor GPS (±${reading.accuracy.toFixed(0)} m · indoor accuracy unmeasured)`;
  }
  return `Approx. GPS (±${reading.accuracy.toFixed(0)} m · indoor accuracy unmeasured)`;
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
  onDone,
}: {
  route: Extract<NavigationResult, { status: 'route' }>;
  plans: VisualPlan[];
  locationCatalogue?: LocationCatalogue;
  walkingSurfaces?: Record<string, WalkingSurface | null>;
  index: number;
  onStepChange: (index: number) => void;
  transferNotice?: string;
  onOverview: () => void;
  onDone?: () => void;
}) {
  const tracking = useWalkingLocation(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const [whole, setWhole] = useState(false);
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

  // Reset full-floor toggle when advancing to a different step.
  useEffect(() => {
    setWhole(false);
  }, [index, plan.id]);

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
    heading.current?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  function move(next: number) {
    if (next >= route.steps.length) tracking.stop();
    onStepChange(next);
  }

  const progressPercent = complete
    ? 100
    : Math.max(8, Math.round(((index + 1) / Math.max(route.steps.length, 1)) * 100));

  return (
    <section className="guided-directions guided-stage" aria-label="Step-by-step directions">
      <div className="guided-map">
        <div className="map-floating-bar">
          <button
            type="button"
            className="map-floating-pill map-overview-btn"
            aria-label="Route overview"
            onClick={onOverview}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Overview</span>
          </button>
          <span className="map-floating-pill map-floor-badge">{planLabel(plan)}</span>
        </div>

        <RouteMapImage
          key={`${index}-${plan.id}`}
          plan={plan}
          label={`${planLabel(plan)} · ${complete ? 'Destination' : `Step ${index + 1}`}`}
          paths={step?.kind === 'corridor' ? [step.path] : []}
          device={device}
          whole={whole}
          fillContainer
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

        <button
          type="button"
          className="map-floating-fab"
          aria-pressed={whole}
          aria-label={whole ? 'Zoom to route' : 'Show full floor'}
          title={whole ? 'Zoom to route' : 'Show full floor'}
          onClick={() => setWhole(!whole)}
        >
          {whole ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>

      <div className="guided-step bottom-sheet" aria-live="polite">
        <span className="sheet-handle" aria-hidden="true" />
        <p className="guided-step-count">
          {complete ? 'Route complete' : `Step ${index + 1} of ${route.steps.length}`}
        </p>
        <div className="step-progress-track" aria-hidden="true">
          <div className="step-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <h2 ref={heading} tabIndex={-1}>
          {complete ? `Destination: ${route.destination.label}` : step.instruction}
        </h2>
        {!complete && (
          <p className="guided-step-subtitle">
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
        {index === 0 && transferNotice && (
          <p className="guided-transfer-note" role="note">
            {transferNotice}
          </p>
        )}
        <p className="guided-location-status" role="status">
          {device && <span className="guided-location-dot" aria-hidden="true" />}
          <span>{positionStatus}</span>
        </p>
        <div className="guided-controls">
          <button
            type="button"
            className="secondary sheet-pill-btn"
            disabled={index === 0}
            onClick={() => move(index - 1)}
          >
            Previous
          </button>
          {complete ? (
            <button
              type="button"
              className="primary sheet-pill-btn"
              onClick={onDone ?? onOverview}
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              className="primary sheet-pill-btn"
              onClick={() => move(index + 1)}
            >
              {index === route.steps.length - 1 ? 'Finish route' : 'Next step'}{' '}
              <ArrowRight size={17} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
