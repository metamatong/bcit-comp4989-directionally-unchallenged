/** Manual progress through saved route steps; never infers movement or camera heading. */
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Navigation } from 'lucide-react';
import type { NavigationResult } from '../wayfinding';
import type { VisualPlan } from '../types';
import { planLabel } from '../topology';
import { RouteMap } from './RouteMap';

export function GuidedDirections({
  route,
  plans,
  onOverview,
}: {
  route: Extract<NavigationResult, { status: 'route' }>;
  plans: VisualPlan[];
  onOverview: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [arrivalMap, setArrivalMap] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const step = route.steps[index];
  const complete = !step;
  const transfer = !!step && step.from.planId !== step.to.planId;
  const stop = complete ? route.destination : arrivalMap && transfer ? step.to : step.from;
  const plan = plans.find((item) => item.id === stop.planId)!;
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({ block: 'start' });
  }, [index]);
  function move(next: number) {
    setArrivalMap(false);
    setIndex(next);
  }
  return (
    <section className="guided-directions" aria-label="Step-by-step directions">
      <button type="button" className="text-button" onClick={onOverview}>
        <ArrowLeft size={17} /> Route overview
      </button>
      <div className="guided-instruction" aria-live="polite">
        {complete ? <Check size={28} /> : <Navigation size={28} />}
        <div>
          <p>{complete ? 'Route complete' : `Step ${index + 1} of ${route.steps.length}`}</p>
          <h2 ref={heading} tabIndex={-1}>
            {complete ? `Destination: ${route.destination.label}` : step.instruction}
          </h2>
          {!complete && (
            <p>
              {step.from.label} → {step.to.label}
            </p>
          )}
          {transfer && (
            <p>
              {planLabel(plans.find((p) => p.id === step.from.planId)!)} →{' '}
              {planLabel(plans.find((p) => p.id === step.to.planId)!)}
            </p>
          )}
        </div>
      </div>
      {transfer && (
        <button
          type="button"
          className="secondary"
          aria-pressed={arrivalMap}
          onClick={() => setArrivalMap(!arrivalMap)}
        >
          {arrivalMap ? 'Show departure floor' : 'Show arrival floor'}
        </button>
      )}
      <RouteMap
        key={`${index}-${plan.id}`}
        plan={plan}
        label={`${planLabel(plan)} · ${complete ? 'Destination' : `Step ${index + 1}`}`}
        paths={step?.kind === 'corridor' ? [step.path] : []}
        markers={
          step?.kind === 'corridor'
            ? [
                { point: step.from.point, symbol: 'A', label: step.from.label },
                { point: step.to.point, symbol: 'B', label: step.to.label, end: true },
              ]
            : [
                {
                  point: stop.point,
                  symbol: complete || arrivalMap ? 'B' : 'A',
                  label: stop.label,
                  end: complete || arrivalMap,
                },
              ]
        }
      />
      <p className="helper">
        {complete
          ? 'Progress was marked manually; your position has not been verified.'
          : 'Follow the marked route. Tap Next step when you have completed this instruction.'}
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
