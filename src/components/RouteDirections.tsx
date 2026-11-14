import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Route } from 'lucide-react';
import { planLabel } from '../topology';
import type { VisualPlan } from '../types';
import type { MapStop, NavigationResult, WalkingStep } from '../wayfinding';
import { RouteMap, type MapMarker } from './RouteMap';

type FoundRoute = Extract<NavigationResult, { status: 'route' }>;
type FloorVisit = { start: MapStop; end: MapStop; walks: WalkingStep[]; transfer?: WalkingStep };

function floorItinerary(route: FoundRoute): FloorVisit[] {
  let visit: FloorVisit = { start: route.origin, end: route.origin, walks: [] };
  const visits = [visit];
  for (const step of route.steps) {
    if (step.kind === 'corridor') {
      visit.walks.push(step);
      visit.end = step.to;
    } else {
      visit.end = step.from;
      visit.transfer = step;
      // Re-entering a floor is a new visit. Never connect points across different maps or an outdoor gap.
      visit = { start: step.to, end: step.to, walks: [] };
      visits.push(visit);
    }
  }
  return visits;
}

function FloorDirections({
  visit,
  plan,
  first,
  last,
}: {
  visit: FloorVisit;
  plan: VisualPlan;
  first: boolean;
  last: boolean;
}) {
  const markers: MapMarker[] = [];
  function mark(stop: MapStop, symbol: string, caption: string, end = false) {
    markers.push({ point: stop.point, symbol, label: caption, end });
  }
  mark(visit.start, 'A', `${first ? 'Start' : 'Enter'} · ${visit.start.label}`);
  for (const step of visit.walks) {
    if (step.to.id === visit.end.id) continue;
    mark(step.to, String(markers.length), step.to.label);
  }
  if (visit.start.id !== visit.end.id || visit.walks.length > 0) {
    mark(visit.end, 'B', `${last ? 'Destination' : 'Continue at'} · ${visit.end.label}`, true);
  } else if (last) {
    markers[0] = {
      point: visit.end.point,
      label: `Destination · ${visit.end.label}`,
      symbol: 'B',
      end: true,
    };
  }
  const heading = planLabel(plan);
  return (
    <article className="floor-directions" aria-label={heading}>
      <h3>{heading}</h3>
      {visit.walks.length > 0 && (
        <div className="floor-endpoints">
          {visit.start.label}
          <ArrowRight size={15} /> {visit.end.label}
        </div>
      )}
      <RouteMap
        plan={plan}
        paths={visit.walks.map((step) => step.path)}
        markers={markers}
        showPlanTitle={false}
        label={`${heading}, ${visit.walks.length ? 'walking directions from ' + visit.start.label + ' to ' + visit.end.label : visit.end.label}`}
      />
      <div className="pin-legend">
        {markers.map((m, i) => (
          <span key={i}>
            <b className={m.end ? 'end' : ''}>{m.symbol}</b>
            {m.label}
          </span>
        ))}
      </div>
      {visit.walks.map((step, i) => (
        <p key={i} className="floor-walk">
          {step.instruction}
        </p>
      ))}
      {visit.transfer && (
        <p className="floor-transfer">
          <ArrowRight size={18} />
          {visit.transfer.instruction}
        </p>
      )}
      {last && (
        <p className="route-arrival">
          {first && !visit.walks.length
            ? 'Your starting point is the destination.'
            : `Arrive at ${visit.end.label}.`}
        </p>
      )}
    </article>
  );
}

export function RouteDirections({
  route,
  plans,
  onRecheck,
}: {
  route: FoundRoute;
  plans: VisualPlan[];
  onRecheck: () => void;
}) {
  // null shows the whole journey. A floor changes only when the visitor chooses one.
  const [floor, setFloor] = useState<number | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView?.({ block: 'start' });
  }, [route.origin.id, route.destination.id]);
  const visits = floorItinerary(route);
  const planById = new Map(plans.map((p) => [p.id, p]));
  const destinationPlan = planById.get(route.destination.planId)!;
  return (
    <div className="route-directions">
      <div className="way-heading">
        <Route size={22} />
        <h2 tabIndex={-1} ref={headingRef}>
          Walking directions
        </h2>
      </div>
      <div className="trip-ends">
        <span>
          {planLabel(planById.get(route.origin.planId)!)} · {route.origin.label}
        </span>
        <ArrowRight size={16} />
        <strong>
          {planLabel(destinationPlan)} · {route.destination.label}
        </strong>
      </div>
      {visits.length > 1 && (
        <div className="itinerary-toggle">
          <button className="secondary" onClick={() => setFloor(floor === null ? 0 : null)}>
            {floor === null ? 'One floor at a time' : 'Show all floors'}
          </button>
        </div>
      )}
      <ol className="floor-itinerary" aria-label="Floors in walking order">
        {visits.map(
          (visit, index) =>
            (floor === null || index === floor) && (
              <li key={index} value={index + 1}>
                <FloorDirections
                  visit={visit}
                  plan={planById.get(visit.start.planId)!}
                  first={index === 0}
                  last={index === visits.length - 1}
                />
              </li>
            ),
        )}
      </ol>
      {floor !== null && (
        <nav className="route-paging" aria-label="Floor navigation">
          <button className="secondary" disabled={floor === 0} onClick={() => setFloor(floor - 1)}>
            <ArrowLeft size={16} />
            Previous floor
          </button>
          {floor + 1 < visits.length && (
            <button className="primary" onClick={() => setFloor(floor + 1)}>
              Next floor <ArrowRight size={16} />
            </button>
          )}
        </nav>
      )}
      <button type="button" className="text-button" onClick={onRecheck}>
        Recheck current route
      </button>
    </div>
  );
}
