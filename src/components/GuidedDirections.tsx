/** Manual progress through saved route steps; never infers floor changes or camera heading. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import type { NavigationResult, WalkingSurface } from '../wayfinding';
import type { VisualPlan } from '../types';
import { fetchWalkingSurface, getCachedWalkingSurface } from '../api';
import { planLabel } from '../topology';
import { RouteMapImage } from './RouteMap';
import type {
  DetectedStep,
  DeviceOverlay,
  DeviceReading,
  LocationCatalogue,
  MotionSnapshot,
} from '../location/types';
import { overlapsFootprint } from '../location/geometry';
import { getMotionPermissionState, requestMotionPermission } from '../location/browser-motion';
import { MAP_MATCH_CONFIG } from '../location/map-matching';
import {
  IndoorPdrTracker,
  PARTICLE_PDR_ENABLED,
  type TrackerEvaluation,
} from '../location/pdr-tracker';
import { useWalkingLocation } from '../location/use-device-location';
import { useMotionTracker } from '../location/use-motion-tracker';
import { guidedStepInstruction } from '../wayfinding';

function locationStatusMessage({
  complete,
  reading,
  trackingStatus,
  hasStaleReading,
  hasBuilding,
  withinBuilding,
  plan,
  evaluation,
  device,
}: {
  complete: boolean;
  reading: DeviceReading | null;
  trackingStatus: string;
  hasStaleReading: boolean;
  hasBuilding: boolean;
  withinBuilding: boolean;
  plan: VisualPlan;
  evaluation: TrackerEvaluation | null;
  device: DeviceOverlay | null;
}): { announcement: string; detail?: string } {
  if (complete) return { announcement: 'Route complete' };
  if (evaluation?.status === 'bridged' && device) {
    return { announcement: 'Estimating location · waiting for GPS' };
  }
  if (evaluation?.status === 'held' && device) {
    const age = Math.max(1, device.ageSeconds ?? 0);
    return { announcement: `Using last location · ${age}s ago` };
  }
  if (!reading || evaluation?.status === 'waiting') {
    return {
      announcement:
        trackingStatus || (hasStaleReading ? 'Waiting for a fresh GPS update…' : 'Waiting for GPS…'),
    };
  }
  const floor = planLabel(plan);
  if (!hasBuilding) {
    return { announcement: `Location unavailable on ${floor}` };
  }
  if (evaluation?.status === 'unavailable') {
    return { announcement: `Location unavailable on ${floor}` };
  }
  if (evaluation?.status === 'low-accuracy') {
    return reading.accuracy >= MAP_MATCH_CONFIG.coarseLocationAccuracyMetres
      ? { announcement: 'GPS signal too weak · check Precise Location' }
      : { announcement: 'GPS signal too weak' };
  }
  if (evaluation?.status === 'too-far') {
    return { announcement: 'Location off mapped route' };
  }
  if (
    evaluation?.status === 'outside-building' ||
    (evaluation?.status === 'raw' && !withinBuilding)
  ) {
    return { announcement: 'Location outside this building' };
  }
  if (evaluation?.status === 'outside-page' || !device) {
    return { announcement: `Location off ${floor} map` };
  }
  if (evaluation?.status === 'matched') {
    return {
      announcement: 'Approx. location',
      detail: ` · ${Math.ceil(device.uncertaintyRadiusMetres)} m uncertainty radius`,
    };
  }
  const accuracy = (device.reportedAccuracyMetres ?? reading.accuracy).toFixed(0);
  return { announcement: `Approx. location · ±${accuracy}m` };
}

export function GuidedDirections({
  route,
  plans,
  locationCatalogue,
  gpsTestMode = false,
  walkingSurfaces,
  enableParticlePdr = PARTICLE_PDR_ENABLED,
  index,
  onStepChange,
  transferNotice,
  onOverview,
  onDone,
}: {
  route: Extract<NavigationResult, { status: 'route' }>;
  plans: VisualPlan[];
  locationCatalogue?: LocationCatalogue;
  gpsTestMode?: boolean;
  walkingSurfaces?: Record<string, WalkingSurface | null>;
  /** Internal Stage 2 verification gate override for tests and controlled rollouts. */
  enableParticlePdr?: boolean;
  index: number;
  onStepChange: (index: number) => void;
  transferNotice?: string;
  onOverview: () => void;
  onDone?: () => void;
}) {
  const tracking = useWalkingLocation(!gpsTestMode);
  const instructionRef = useRef<HTMLParagraphElement>(null);
  const [loadedSurfaces, setLoadedSurfaces] = useState<Record<string, WalkingSurface | null>>(
    () => {
      const initial: Record<string, WalkingSurface | null> = {};
      for (const routeStep of route.steps) {
        for (const id of [routeStep.from.planId, routeStep.to.planId]) {
          const cached = getCachedWalkingSurface(id);
          if (cached) initial[id] = cached;
        }
      }
      return initial;
    },
  );
  const [permissionTick, setPermissionTick] = useState(0);
  const [evaluation, setEvaluation] = useState<TrackerEvaluation | null>(null);
  const trackerRef = useRef<IndoorPdrTracker | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = new IndoorPdrTracker({ enableParticleFilter: enableParticlePdr });
  }
  const pauseReasonRef = useRef(tracking.pauseReason);
  pauseReasonRef.current = tracking.pauseReason;
  const startTrackingRef = useRef(tracking.start);
  startTrackingRef.current = tracking.start;

  const step = route.steps[index];
  const complete = !step;
  const transfer = !!step && step.from.planId !== step.to.planId;
  const isSamePlanCorridor = !!step && step.kind === 'corridor' && !transfer;
  const stop = complete ? route.destination : step.from;
  const plan = plans.find((item) => item.id === stop.planId)!;
  const targetPlan = step ? plans.find((item) => item.id === step.to.planId) : undefined;
  const stepInstruction = step
    ? guidedStepInstruction(step, {
        fromFloor: plan.floor,
        toFloor: targetPlan?.floor,
        targetPlanLabel: targetPlan ? planLabel(targetPlan) : undefined,
      })
    : undefined;
  const fromFloorNumber = Number(plan.floor);
  const toFloorNumber = Number(targetPlan?.floor);
  const transferDirection =
    step &&
    (step.kind === 'stairs' || step.kind === 'elevator') &&
    Number.isFinite(fromFloorNumber) &&
    Number.isFinite(toFloorNumber)
      ? toFloorNumber > fromFloorNumber
        ? 'up'
        : toFloorNumber < fromFloorNumber
          ? 'down'
          : undefined
      : undefined;
  const calibration = locationCatalogue?.floors.find((floor) => floor.planId === plan.id);
  const building = locationCatalogue?.buildings.find((item) => item.building === plan.building);
  const hasProvidedSurface = !!walkingSurfaces && plan.id in walkingSurfaces;
  const surface = hasProvidedSurface
    ? walkingSurfaces[plan.id]
    : (loadedSurfaces[plan.id] ?? getCachedWalkingSurface(plan.id));
  const canTrack = !complete && tracking.active && !gpsTestMode;
  const stepKind = step?.kind;
  const transferStepIndex = step && !isSamePlanCorridor ? index : undefined;
  const routePath = isSamePlanCorridor ? step.path : undefined;
  const stepStartPoint = isSamePlanCorridor ? step.from.point : undefined;

  const handleDetectedStep = useCallback((detected: DetectedStep, snapshot: MotionSnapshot) => {
    trackerRef.current?.updateMotion(snapshot, detected.timestamp);
    trackerRef.current?.ingestStep(detected);
  }, []);

  const motion = useMotionTracker({
    active: canTrack && isSamePlanCorridor,
    permissionTick,
    onStep: handleDetectedStep,
  });

  useEffect(() => {
    if (complete || hasProvidedSurface || plan.id in loadedSurfaces) return;
    const cached = getCachedWalkingSurface(plan.id);
    if (cached) {
      setLoadedSurfaces((current) => (plan.id in current ? current : { ...current, [plan.id]: cached }));
      return;
    }
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

  // Resume with a new watch and discard fixes captured before the tab returned.
  useEffect(() => {
    if (gpsTestMode || complete) return;
    const onVisibility = () => {
      if (document.hidden) {
        trackerRef.current?.reset(Date.now());
      } else if (pauseReasonRef.current === 'hidden') {
        trackerRef.current?.reset(Date.now());
        startTrackingRef.current();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [complete, gpsTestMode]);

  // Ingest every accepted watch fix (including 2-8 s indoor fixes); freshness drives live vs. hold state.
  const watchReading = !complete && tracking.active ? (tracking.reading ?? null) : null;
  const tracker = trackerRef.current;

  // Apply the committed floor and transfer context before consuming a GPS fix for it.
  useLayoutEffect(() => {
    if (!canTrack) {
      tracker.reset();
      return;
    }
    tracker.configureContext(
      {
        plan,
        calibration,
        surface,
        buildingRings: building?.rings,
        stepKind,
        transferStepIndex,
        isSamePlanStep: !transfer,
        routePath,
        stepStartPoint,
      },
      Date.now(),
    );
  }, [
    tracker,
    canTrack,
    plan,
    calibration,
    surface,
    building,
    stepKind,
    transferStepIndex,
    transfer,
    routePath,
    stepStartPoint,
  ]);

  useLayoutEffect(() => {
    if (!canTrack || !building) {
      setEvaluation(null);
      return;
    }
    const observedAt = Math.max(tracking.now, Date.now());
    if (watchReading) tracker.ingestGpsReading(watchReading, motion, observedAt);
    else tracker.updateMotion(motion, observedAt);
    setEvaluation(tracker.evaluateAt(observedAt, tracking.fresh, motion.activity));
  }, [
    tracker,
    canTrack,
    building,
    watchReading,
    tracking.fresh,
    motion,
    tracking.now,
    plan,
    calibration,
    surface,
    stepKind,
    transferStepIndex,
    transfer,
    routePath,
    stepStartPoint,
  ]);

  const withinBuilding =
    evaluation?.status === 'raw' && !!watchReading && !!building
      ? overlapsFootprint(watchReading, building.rings)
      : false;
  const device =
    evaluation?.status === 'matched' ||
    evaluation?.status === 'bridged' ||
    evaluation?.status === 'held'
      ? evaluation.overlay
      : evaluation?.status === 'raw' && withinBuilding
        ? evaluation.overlay
        : null;

  const positionStatus = gpsTestMode
    ? { announcement: 'GPS off · follow the map' }
    : locationStatusMessage({
        complete,
        reading: watchReading,
        trackingStatus: tracking.status,
        hasStaleReading: !!tracking.reading,
        hasBuilding: !!building,
        withinBuilding,
        plan,
        evaluation,
        device,
      });

  useEffect(() => {
    instructionRef.current?.focus({ preventScroll: true });
    instructionRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [index]);

  function promptMotionOnGesture() {
    if (gpsTestMode || getMotionPermissionState() !== 'unknown') return;
    void requestMotionPermission().then(() => setPermissionTick((tick) => tick + 1));
  }

  function move(next: number) {
    if (next >= route.steps.length) tracking.stop();
    else promptMotionOnGesture();
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
        {transferDirection && targetPlan && (
          <div
            className={`guided-transfer-overlay is-${transferDirection}`}
            aria-label={`${transferDirection === 'up' ? 'Up' : 'Down'} to Floor ${targetPlan.floor}`}
          >
            {transferDirection === 'up' ? (
              <ArrowUp size={26} strokeWidth={3} aria-hidden="true" />
            ) : (
              <ArrowDown size={26} strokeWidth={3} aria-hidden="true" />
            )}
            <span>{transferDirection === 'up' ? 'UP' : 'DOWN'}</span>
            <small>Floor {targetPlan.floor}</small>
          </div>
        )}
      </div>

      <div className="guided-step bottom-sheet">
        <p className="guided-step-count">
          {complete ? 'Route complete' : `Step ${index + 1} of ${route.steps.length}`}
        </p>
        <div className="step-progress-track" aria-hidden="true">
          <div className="step-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <p ref={instructionRef} tabIndex={-1} className="guided-step-instruction">
          {complete ? `Arrived · ${route.destination.label}` : stepInstruction}
        </p>
        {index === 0 && transferNotice && (
          <p className="guided-transfer-note" role="note">
            {transferNotice}
          </p>
        )}
        <p className="guided-location-status">
          {device && (
            <span
              className={
                device.trackingMode === 'gps-hold'
                  ? 'guided-location-dot is-held'
                  : 'guided-location-dot'
              }
              aria-hidden="true"
            />
          )}
          <span>
            <span role="status">{positionStatus.announcement}</span>
            {positionStatus.detail}
          </span>
        </p>
        <div className="guided-controls">
          <button
            type="button"
            className="secondary sheet-pill-btn"
            disabled={index === 0}
            onClick={() => move(index - 1)}
          >
            Back
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
              {index === route.steps.length - 1 ? 'Finish' : 'Next'}{' '}
              <ArrowRight size={17} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
