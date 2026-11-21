/** Open complete routes in guided directions and keep the full itinerary available. */
import { useEffect, useRef, useState } from 'react';
import { Route } from 'lucide-react';
import { planLabel } from '../topology';
import type { VisualPlan } from '../types';
import type {
  MapStop,
  NavigationResult,
  PlaceChoice,
  WalkingStep,
  WalkingSurface,
} from '../wayfinding';
import { RouteMapImage, type MapMarker } from './RouteMap';
import type { LocationCatalogue } from '../location/types';
import { GuidedDirections } from './GuidedDirections';

type FoundRoute = Extract<NavigationResult, { status: 'route' }>;
type FloorVisit = { start: MapStop; end: MapStop; walks: WalkingStep[] };

function floorItinerary(route: FoundRoute): FloorVisit[] {
  let visit: FloorVisit = { start: route.origin, end: route.origin, walks: [] };
  const visits = [visit];
  for (const step of route.steps) {
    if (step.kind === 'corridor') {
      visit.walks.push(step);
      visit.end = step.to;
    } else {
      visit.end = step.from;
      // Re-entering a floor is a new visit. Never connect points across different maps or an outdoor gap.
      visit = { start: step.to, end: step.to, walks: [] };
      visits.push(visit);
    }
  }
  return visits;
}

function routeOverview(route: FoundRoute, plans: Map<string, VisualPlan>) {
  if (!route.steps.length) return `${route.destination.label} · You are at the destination.`;
  const parts = [route.origin.label];
  for (let index = 0; index < route.steps.length; index++) {
    const step = route.steps[index];
    const next = route.steps[index + 1];
    if (step.kind === 'corridor') {
      // A transfer describes its boarding point once, together with the floor change.
      if ((!next || next.kind === 'corridor') && parts.at(-1) !== step.to.label)
        parts.push(step.to.label);
    } else if (step.kind === 'building-link') {
      parts.push(`Connecting passage to ${planLabel(plans.get(step.to.planId)!)}`);
    } else if (step.kind === 'outdoor') {
      parts.push(`Outside to ${planLabel(plans.get(step.to.planId)!)} (outdoor path unmapped)`);
    } else {
      const fromFloor = plans.get(step.from.planId)!.floor;
      const toFloor = plans.get(step.to.planId)!.floor;
      parts.push(`${step.from.label} (Floor ${fromFloor} → ${toFloor})`);
    }
  }
  if (route.steps.at(-1)?.kind !== 'corridor') parts.push(route.destination.label);
  return parts.join(' → ');
}

function FloorMap({
  visit,
  plan,
  first,
  last,
  whole,
  requestedRoom,
  requestedOrigin,
}: {
  visit: FloorVisit;
  plan: VisualPlan;
  first: boolean;
  last: boolean;
  whole: boolean;
  requestedRoom?: PlaceChoice;
  requestedOrigin?: PlaceChoice;
}) {
  const samePoint = visit.start.id === visit.end.id && !visit.walks.length;
  const finalLabel = requestedRoom ? 'Last mapped stop' : 'Destination';
  const markers: MapMarker[] = [
    {
      point: visit.start.point,
      symbol: samePoint && last ? 'B' : 'A',
      label: `${samePoint && last ? finalLabel : first ? (visit.start.startRegion ? 'Start area' : 'Start') : 'Enter'} · ${visit.start.label}`,
      end: samePoint && last,
    },
  ];
  if (!samePoint)
    markers.push({
      point: visit.end.point,
      symbol: 'B',
      label: `${last ? finalLabel : 'Continue at'} · ${visit.end.label}`,
      end: true,
    });
  if (last && requestedRoom?.bounds && requestedRoom.planId === plan.id) {
    const [l, t, r, b] = requestedRoom.bounds;
    markers.push({
      point: { x: (l + r) / 2, y: (t + b) / 2 },
      symbol: 'R',
      label: 'Requested place · ' + requestedRoom.label + ' (plan label)',
    });
  }
  if (first && requestedOrigin?.bounds && requestedOrigin.planId === plan.id) {
    const [l, t, r, b] = requestedOrigin.bounds;
    markers.push({
      point: { x: (l + r) / 2, y: (t + b) / 2 },
      symbol: 'S',
      label: 'Matched sign · ' + requestedOrigin.label + ' (plan label)',
    });
  }
  const heading = planLabel(plan);
  return (
    <figure className="route-map-visit" aria-label={heading}>
      <RouteMapImage
        plan={plan}
        paths={visit.walks.map((step) => step.path)}
        markers={markers}
        bounds={first ? visit.start.startRegion : undefined}
        whole={whole}
        label={`${heading}, walking directions from ${visit.start.label} to ${visit.end.label}`}
      />
      <figcaption>
        <span className="route-floor-label">{heading}</span>
        <div className="pin-legend">
          {markers.map((marker) => (
            <span key={marker.symbol}>
              <b className={marker.end ? 'end' : ''}>{marker.symbol}</b>
              {marker.label}
            </span>
          ))}
        </div>
      </figcaption>
    </figure>
  );
}

export function RouteDirections({
  route,
  plans,
  onRecheck,
  locationCatalogue,
  walkingSurfaces,
  preferElevators = false,
  requestedRoom,
  requestedOrigin,
}: {
  route: FoundRoute;
  requestedRoom?: PlaceChoice;
  requestedOrigin?: PlaceChoice;
  plans: VisualPlan[];
  onRecheck: () => void;
  locationCatalogue?: LocationCatalogue;
  walkingSurfaces?: Record<string, WalkingSurface | null>;
  preferElevators?: boolean;
}) {
  const [showOverview, setShowOverview] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [whole, setWhole] = useState(false);
  const canGuide = !requestedRoom && !requestedOrigin && route.steps.length > 0;
  const guided = canGuide && !showOverview;
  const complete = stepIndex >= route.steps.length;
  const usesNonPreferredTransfer = route.steps.some(
    (step) => step.kind === (preferElevators ? 'stairs' : 'elevator'),
  );
  const transferNotice = usesNonPreferredTransfer
    ? preferElevators
      ? 'No mapped elevator route is available for the full trip, so this route includes stairs.'
      : 'This route uses an elevator because no complete route without elevators is mapped.'
    : undefined;
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView?.({ block: 'start' });
  }, [route.origin.id, route.destination.id, guided]);
  if (guided)
    return (
      <GuidedDirections
        route={route}
        plans={plans}
        locationCatalogue={locationCatalogue}
        walkingSurfaces={walkingSurfaces}
        index={stepIndex}
        onStepChange={setStepIndex}
        transferNotice={transferNotice}
        onOverview={() => setShowOverview(true)}
      />
    );
  const visits = floorItinerary(route);
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const routePlans = [...new Set(visits.map((visit) => visit.start.planId))].map((id) =>
    planById.get(id)!,
  );
  return (
    <div className="route-directions">
      <div className="way-heading">
        <Route size={22} />
        <h2 tabIndex={-1} ref={headingRef}>
          {requestedRoom
            ? 'Directions to the last mapped stop'
            : requestedOrigin
              ? 'Directions from the first mapped stop'
              : 'Walking directions'}
        </h2>
      </div>
      <p className="route-overview" aria-label="Route overview">
        {(requestedRoom || requestedOrigin) && !route.steps.length
          ? 'Mapped stop · ' + route.destination.label
          : routeOverview(route, planById)}
      </p>
      {requestedRoom && (
        <p role="note">
          The walking line ends at {route.destination.label}. The final walk to{' '}
          {requestedRoom.label} is unverified. R marks the requested place on its floor plan.
        </p>
      )}
      {requestedOrigin && (
        <p role="note">
          S marks the sign for {requestedOrigin.label}. The walk from that sign to{' '}
          {route.origin.label} is unverified. Follow the walking line once you reach{' '}
          {route.origin.label}.
        </p>
      )}
      <p className="helper" role="note">
        {transferNotice ?? (preferElevators ? 'Elevators preferred.' : 'Stairs preferred.')}
      </p>
      {canGuide && (
        <button
          type="button"
          className="primary full-width"
          onClick={() => {
            if (complete) setStepIndex(0);
            setShowOverview(false);
          }}
        >
          {complete ? 'Restart directions' : 'Back to steps'}
        </button>
      )}
      <div className="route-map-stack" role="group" aria-label="Route maps in travel order">
        <div className="map-bar">
          <button type="button" aria-pressed={whole} onClick={() => setWhole(!whole)}>
            {whole ? 'Zoom to route' : 'Show full floors'}
          </button>
        </div>
        {visits.map((visit, index) => (
          <FloorMap
            key={index}
            visit={visit}
            plan={planById.get(visit.start.planId)!}
            first={index === 0}
            last={index === visits.length - 1}
            requestedRoom={index === visits.length - 1 ? requestedRoom : undefined}
            requestedOrigin={index === 0 ? requestedOrigin : undefined}
            whole={whole}
          />
        ))}
        <div className="map-credit">
          <span>{[...new Set(routePlans.map((plan) => plan.attribution))].join(' · ')}</span>
          <details className="route-sources">
            <summary>Source plans</summary>
            {routePlans.map((plan) => (
              <a key={plan.id} href={plan.sourceUrl} target="_blank" rel="noreferrer">
                {planLabel(plan)} ↗
              </a>
            ))}
          </details>
        </div>
      </div>
      <button type="button" className="text-button" onClick={onRecheck}>
        Recheck current route
      </button>
    </div>
  );
}
