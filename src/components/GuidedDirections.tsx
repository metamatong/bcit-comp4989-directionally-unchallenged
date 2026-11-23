/** Manual progress through saved route steps; never infers movement or camera heading. */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { NavigationResult } from '../wayfinding';
import type { VisualPlan } from '../types';
import { planLabel } from '../topology';
import { RouteMap } from './RouteMap';
import type { LocationCatalogue } from '../location/types';
import { deviceOverlay, overlapsFootprint } from '../location/geometry';
import type { useWalkingLocation } from '../location/use-device-location';

export function GuidedDirections({
  route,
  plans,
  locationCatalogue,
  tracking,
  onOverview,
}: {
  route: Extract<NavigationResult, { status: 'route' }>;
  plans: VisualPlan[];
  locationCatalogue?: LocationCatalogue;
  tracking: ReturnType<typeof useWalkingLocation>;
  onOverview: () => void;
}) {
  const [index, setIndex] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = route.steps[index];
  const complete = !step;
  const transfer = !!step && step.from.planId !== step.to.planId;
  const stop = complete ? route.destination : step.from;
  const plan = plans.find((item) => item.id === stop.planId)!;
  const calibration = locationCatalogue?.floors.find((floor) => floor.planId === plan.id);
  const building = locationCatalogue?.buildings.find((item) => item.building === plan.building);
  const withinBuilding = !!(
    tracking.fresh &&
    tracking.reading &&
    building &&
    overlapsFootprint(tracking.reading, building.rings)
  );
  const projected =
    tracking.fresh && tracking.reading ? deviceOverlay(tracking.reading, plan, calibration) : null;
  const onPlan = !!(
    projected &&
    projected.point.x >= 0 &&
    projected.point.x <= 1 &&
    projected.point.y >= 0 &&
    projected.point.y <= 1
  );
  const positionStatus = complete
    ? 'Location tracking stopped. Route complete.'
    : !tracking.fresh
      ? tracking.status ||
        (tracking.reading ? 'Waiting for a fresh GPS update…' : 'Waiting for GPS…')
      : !withinBuilding
        ? 'The GPS area does not overlap this building. The position dot is hidden.'
        : !onPlan
          ? `A floor-plan alignment is unavailable for ${planLabel(plan)}. The position dot is hidden.`
          : `GPS position is approximate on ${planLabel(plan)} · reported accuracy ±${tracking.reading!.accuracy.toFixed(0)} m · indoor accuracy unmeasured.`;
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({ block: 'start' });
  }, [index]);
  function move(next: number) {
    if (next >= route.steps.length) tracking.stop();
    setIndex(next);
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
          device={withinBuilding && onPlan ? projected : null}
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
      <p className="guided-location-status" role="status">
        {withinBuilding && onPlan && <span className="guided-location-dot" aria-hidden="true" />}
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
