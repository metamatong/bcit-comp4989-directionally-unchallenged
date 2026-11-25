import { useEffect, useState } from 'react';
import { planLabel } from '../topology';
import type { VisualPlan } from '../types';
import { guidedStepInstruction, type NavigationResult } from '../wayfinding';
import { RouteMapImage } from './RouteMap';

export function RoutePlayback({ route, plans, onClose }: {
  route: Extract<NavigationResult, { status: 'route' }>;
  plans: VisualPlan[];
  onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const step = route.steps[index];
  const from = step?.from ?? route.destination;
  const plan = plans.find((item) => item.id === from.planId)!;
  const target = step && plans.find((item) => item.id === step.to.planId);
  const walk = step?.kind === 'corridor';
  const duration = walk ? 4200 : 3200;

  useEffect(() => {
    if (!playing || !step) return;
    const timer = window.setTimeout(() => setIndex(index + 1), duration);
    return () => window.clearTimeout(timer);
  }, [playing, step, index, duration]);

  function seek(next: number) {
    setPlaying(false);
    setIndex(next);
  }

  return (
    <section className="guided-directions guided-stage" aria-label="Full 3D route preview">
      <div className="route-playback-maps">
        <figure>
          <figcaption>{planLabel(plan)} · {from.label}</figcaption>
          <RouteMapImage key={index} threeD plan={plan} label={planLabel(plan)}
            paths={walk ? [step.path] : []}
            playbackDuration={walk && playing ? duration : undefined}
            markers={[{ point: from.point, symbol: step ? 'A' : 'B', label: from.label, end: !step },
              ...(walk ? [{ point: step.to.point, symbol: 'B', label: step.to.label, end: true }] : [])]} />
        </figure>
        {step && !walk && target && <figure>
          <figcaption>Continue to {planLabel(target)} · {step.to.label}</figcaption>
          <RouteMapImage threeD plan={target} label={planLabel(target)}
            markers={[{ point: step.to.point, symbol: 'B', label: step.to.label, end: true }]} />
        </figure>}
      </div>
      <div className="guided-step bottom-sheet">
        <p className="guided-step-count">3D route preview · {step ? `Step ${index + 1} of ${route.steps.length}` : 'Destination'}</p>
        <p className="guided-step-instruction" aria-live="polite">{step ? guidedStepInstruction(step, {
          fromFloor: plan.floor, toFloor: target?.floor, targetPlanLabel: target && planLabel(target),
        }) : route.destination.label}</p>
        <div className="route-playback-controls">
          <button type="button" disabled={!index} onClick={() => seek(index - 1)}>Previous</button>
          <button type="button" onClick={() => {
            if (!step) setIndex(0);
            setPlaying(!step || !playing);
          }}>{!step ? 'Replay' : playing ? 'Pause' : 'Play'}</button>
          <button type="button" disabled={!step} onClick={() => seek(index + 1)}>Next</button>
          <button type="button" className="primary" autoFocus onClick={onClose}>Back to guidance</button>
        </div>
      </div>
    </section>
  );
}
