import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, MapPin, Route } from 'lucide-react';
import { request } from '../api';
import type { CampusLocationCandidate, VisualPlan } from '../types';
import type { MapStop, NavigationResult, PlaceChoice, WalkingStep } from '../wayfinding';
import { planLabel } from '../topology';
import { RouteMap, type MapMarker } from './RouteMap';

type RouteResult = Extract<NavigationResult, { status: 'route' }>;
type Scene = {
  stop: MapStop;
  end?: MapStop;
  path: WalkingStep['path'];
  text: string;
  type: string;
};
const stepLabels: Record<WalkingStep['kind'], string> = {
  corridor: 'Walk',
  stairs: 'Stairs',
  elevator: 'Elevator',
  outdoor: 'Outdoor crossing',
  'building-link': 'Building passage',
};
function routeScenes(route: RouteResult): Scene[] {
  const scenes: Scene[] = route.steps.map((step) => ({
    stop: step.from,
    end: step.kind === 'corridor' ? step.to : undefined,
    path: step.path,
    text: step.instruction,
    type: stepLabels[step.kind],
  }));
  scenes.push({
    stop: route.destination,
    path: [],
    text: route.steps.length
      ? 'Your destination is at the marked point.'
      : 'Your confirmed starting point is the destination.',
    type: 'Arrival',
  });
  return scenes;
}
export function RouteDirections({
  route,
  plans,
  onRecheck,
}: {
  route: RouteResult;
  plans: VisualPlan[];
  onRecheck: () => void;
}) {
  const [index, setIndex] = useState(0);
  const scenes = routeScenes(route),
    scene = scenes[Math.min(index, scenes.length - 1)];
  const plan = plans.find((p) => p.id === scene.stop.planId)!;
  const arrival = scene.type === 'Arrival';
  const markers: MapMarker[] = [
    { point: scene.stop.point, label: scene.stop.label, symbol: arrival ? 'B' : 'A', end: arrival },
  ];
  if (scene.end)
    markers.push({ point: scene.end.point, label: scene.end.label, symbol: 'B', end: true });
  return (
    <div className="route-directions">
      <div className="way-heading">
        <Route size={21} />
        <h2>Walking directions</h2>
      </div>
      <div className="trip-ends">
        <span>
          {planLabel(plans.find((p) => p.id === route.origin.planId)!)} · {route.origin.label}
        </span>
        <ArrowRight size={16} />
        <strong>
          {planLabel(plans.find((p) => p.id === route.destination.planId)!)} ·{' '}
          {route.destination.label}
        </strong>
      </div>
      <nav className="step-tabs" aria-label="Route steps">
        {scenes.map((s, i) => (
          <button
            key={i}
            type="button"
            aria-current={i === index ? 'step' : undefined}
            onClick={() => setIndex(i)}
            aria-label={`Step ${i + 1}, ${s.type}, ${planLabel(plans.find((p) => p.id === s.stop.planId)!)}`}
          >
            {i + 1}
          </button>
        ))}
      </nav>
      <div aria-live="polite">
        <h3>{scene.type}</h3>
        <p>{scene.text}</p>
      </div>
      <RouteMap
        key={index}
        plan={plan}
        path={scene.path}
        markers={markers}
        label={`${planLabel(plan)}, ${scene.type}, ${scene.text}`}
      />
      <div className="pin-legend">
        <span>
          <b className={arrival ? 'end' : ''}>{arrival ? 'B' : 'A'}</b>
          {scene.stop.label}
        </span>
        {scene.end && (
          <span>
            <b className="end">B</b>
            {scene.end.label}
          </span>
        )}
      </div>
      <div className="route-paging">
        <button className="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>
          <ArrowLeft size={16} />
          Previous
        </button>
        {index + 1 < scenes.length && (
          <button className="primary" onClick={() => setIndex(index + 1)}>
            Next step <ArrowRight size={16} />
          </button>
        )}
      </div>
      <button type="button" className="text-button" onClick={onRecheck}>
        Recheck current route
      </button>
    </div>
  );
}
function choiceMap(place: PlaceChoice, plans: VisualPlan[], symbol: string) {
  const plan = plans.find((p) => p.id === place.planId);
  if (!plan) return null;
  return (
    <RouteMap
      plan={plan}
      bounds={place.bounds}
      markers={place.point ? [{ point: place.point, label: place.label, symbol }] : []}
      label={`${place.label} on ${planLabel(plan)}`}
    />
  );
}

export function JourneyPanel({
  sessionId,
  revision,
  candidate,
  destination,
  plans,
}: {
  sessionId: string;
  revision: number;
  candidate: CampusLocationCandidate;
  destination: string;
  plans: VisualPlan[];
}) {
  const [selection, setSelection] = useState<{
    originId?: string;
    destinationId?: string;
    networkRevision?: number;
  }>({});
  const [result, setResult] = useState<NavigationResult>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined);
    setError('');
    request<NavigationResult>(
      `/api/sessions/${sessionId}/navigation`,
      { revision, candidateId: candidate.id, destination, ...selection },
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [sessionId, revision, candidate.id, destination, selection]);
  const retry = () => {
    setSelection({});
  };
  const select = (value: { originId?: string; destinationId?: string }) => {
    if (!result) return;
    setResult(undefined);
    setSelection({ ...selection, ...value, networkRevision: result.networkRevision });
  };
  if (error)
    return (
      <section className="journey-panel">
        <p role="alert">{error}</p>
        <button className="secondary" onClick={retry}>
          Refresh walking map
        </button>
      </section>
    );
  if (!result)
    return (
      <section className="journey-panel" role="status">
        Checking the walking map…
      </section>
    );
  if (result.status === 'route')
    return (
      <section className="journey-panel">
        <RouteDirections route={result} plans={plans} onRecheck={retry} />
      </section>
    );
  const selected =
    result.destinations.find((p) => p.id === selection.destinationId) ??
    (result.destinations.length === 1 ? result.destinations[0] : undefined);
  const headings = {
    'choose-origin': 'Confirm your starting point',
    'choose-destination': 'Choose your destination',
    'unknown-destination': 'Destination not found',
    'unmapped-destination': 'Destination found on the plan',
    'unmapped-origin-and-destination': 'Route coverage is incomplete',
    'unmapped-origin': 'Starting point needs a closer match',
    'no-route': 'Route unavailable',
  };
  return (
    <section className="journey-panel">
      <div className="way-heading">
        <MapPin size={21} />
        <h2>{headings[result.status]}</h2>
      </div>
      <p role="status">{result.message}</p>
      {result.status === 'choose-origin' && (
        <>
          <RouteMap
            plan={plans.find((p) => p.id === candidate.planId)!}
            bounds={candidate.bounds ?? undefined}
            markers={result.origins.map((s, i) => ({
              point: s.point,
              label: s.label,
              symbol: String(i + 1),
            }))}
            label="Reviewed starting points in your confirmed photo region"
          />
          <div className="place-choices">
            {result.origins.map((s, i) => (
              <button className="secondary" key={s.id} onClick={() => select({ originId: s.id })}>
                <b>{i + 1}</b>I'm at {s.label}
              </button>
            ))}
          </div>
        </>
      )}
      {result.status === 'choose-destination' &&
        result.destinations.map((p, i) => (
          <div className="place-choice" key={p.id}>
            {choiceMap(p, plans, String(i + 1))}
            <button className="secondary" onClick={() => select({ destinationId: p.id })}>
              Choose {p.label} · {planLabel(plans.find((plan) => plan.id === p.planId)!)} · mark{' '}
              {i + 1}
            </button>
          </div>
        ))}
      {(result.status === 'unmapped-destination' ||
        result.status === 'unmapped-origin-and-destination' ||
        result.status === 'no-route') &&
        selected &&
        choiceMap(selected, plans, 'B')}
    </section>
  );
}
