/** Manual progress through saved route steps; never infers movement or camera heading. */
import { useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { NavigationResult } from '../wayfinding';
import type { VisualPlan } from '../types';
import { planLabel } from '../topology';
import { RouteMap } from './RouteMap';
import type { LocationCatalogue } from '../location/types';
import { deviceOverlay, overlapsFootprint } from '../location/geometry';
import { useWalkingLocation } from '../location/use-device-location';

export function GuidedDirections({
  route,
  plans,
  locationCatalogue,
  index,
  onStepChange,
  transferNotice,
  onOverview,
}: {
  route: Extract<NavigationResult, { status: 'route' }>;
  plans: VisualPlan[];
  locationCatalogue?: LocationCatalogue;
  index: number;
  onStepChange: (index: number) => void;
  transferNotice?: string;
  onOverview: () => void;
}) {
  const tracking = useWalkingLocation(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = route.steps[index];
  const complete = !step;
  const transfer = !!step && step.from.planId !== step.to.planId;
  const stop = complete ? route.destination : step.from;
  const plan = plans.find((item) => item.id === stop.planId)!;
  const calibration = locationCatalogue?.floors.find((floor) => floor.planId === plan.id);
  const building = locationCatalogue?.buildings.find((item) => item.building === plan.building);
  const reading = !complete && tracking.fresh ? tracking.reading : null;
  const withinBuilding = reading && building && overlapsFootprint(reading, building.rings);
  const projected = reading && withinBuilding ? deviceOverlay(reading, plan, calibration) : null;
  const device =
    projected &&
    projected.point.x >= 0 &&
    projected.point.x <= 1 &&
    projected.point.y >= 0 &&
    projected.point.y <= 1
      ? projected
      : null;
  const positionStatus = complete
    ? 'Location tracking stopped. Route complete.'
    : !reading
      ? tracking.status ||
        (tracking.reading ? 'Waiting for a fresh GPS update…' : 'Waiting for GPS…')
      : !building
        ? `An official building footprint is unavailable for ${planLabel(plan)}. The position dot is hidden.`
        : !withinBuilding
          ? 'The GPS area does not overlap this building. The position dot is hidden.'
          : !projected
            ? `A floor-plan alignment is unavailable for ${planLabel(plan)}. The position dot is hidden.`
            : !device
              ? 'The GPS position falls outside this floor drawing. The position dot is hidden.'
              : `GPS position is approximate on ${planLabel(plan)} · reported accuracy ±${reading.accuracy.toFixed(0)} m · indoor accuracy unmeasured.`;
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
