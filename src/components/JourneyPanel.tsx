import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, MapPin, Route } from 'lucide-react';
import { request } from '../api';
import type { CampusLocationCandidate, VisualPlan } from '../types';
import type { NavigationResult, PlaceChoice } from '../wayfinding';
import { planLabel } from '../topology';
import { RouteMap } from './RouteMap';
import { RouteDirections } from './RouteDirections';
import type { LocationCatalogue } from '../location/types';

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
  busy,
  onTryAnotherPhoto,
  locationCatalogue,
}: {
  sessionId: string;
  revision: number;
  candidate: CampusLocationCandidate;
  destination: string;
  plans: VisualPlan[];
  busy: boolean;
  onTryAnotherPhoto: () => void;
  locationCatalogue?: LocationCatalogue;
}) {
  const [selection, setSelection] = useState<{
    destinationId?: string;
    networkRevision?: number;
  }>({});
  const [result, setResult] = useState<NavigationResult>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

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
  }, [sessionId, revision, candidate.id, destination, selection, refresh]);

  useEffect(() => {
    if (result && result.status !== 'route') {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [result?.status]);

  if (error)
    return (
      <section className="journey-panel">
        <p role="alert">{error}</p>
        <button className="secondary" onClick={() => setRefresh((value) => value + 1)}>
          Try again
        </button>
      </section>
    );
  if (!result)
    return (
      <section className="journey-panel" role="status">
        <div className="route-ready" aria-live="polite">
          <span className="route-ready-icon" aria-hidden="true">
            <Check size={18} />
          </span>
          <span>
            <strong>Starting position acquired</strong>
            <small className="route-loading">
              <Route size={15} className="spin" /> Finding your route…
            </small>
          </span>
        </div>
      </section>
    );
  if (result.status === 'route')
    return (
      <section className="journey-panel" aria-label="Your walking route">
        <div className="route-ready" role="status" aria-live="polite">
          <span className="route-ready-icon" aria-hidden="true">
            <Check size={18} />
          </span>
          <span>
            <strong>Starting position acquired</strong>
            <small>Your route is ready.</small>
          </span>
        </div>
        {result.destinationMatch && (
          <p className="destination-match" role="status">
            Matching “{result.destinationMatch.requested}” to {result.destinationMatch.matched}.
          </p>
        )}
        <RouteDirections
          route={result}
          plans={plans}
          onRecheck={() => {
            setSelection({});
            setRefresh((value) => value + 1);
          }}
          locationCatalogue={locationCatalogue}
        />
      </section>
    );

  const selected =
    result.destinations.find((p) => p.id === selection.destinationId) ??
    (result.destinations.length === 1 ? result.destinations[0] : undefined);
  const headings = {
    'choose-origin': 'Starting point is unclear',
    'choose-destination': 'Choose your destination',
    'unknown-destination': 'Destination not found',
    'unmapped-destination': 'Destination found on the plan',
    'unsupported-building': 'Routes are not mapped here yet',
    'unmapped-origin-and-destination': 'Route coverage is incomplete',
    'unmapped-origin': 'Starting point needs a closer match',
    'no-route': 'Route unavailable',
  };
  const needsAnotherPhoto =
    result.status === 'choose-origin' ||
    ((result.status === 'unmapped-origin' || result.status === 'unmapped-origin-and-destination') &&
      !candidate.doorwayVicinity);

  return (
    <section className="journey-panel" aria-label="Route to destination">
      <div className="way-heading">
        <MapPin size={21} />
        <h2 tabIndex={-1} ref={headingRef}>
          {headings[result.status]}
        </h2>
      </div>
      <p role="status">{result.message}</p>
      {needsAnotherPhoto && (
        <button className="primary full-width" disabled={busy} onClick={onTryAnotherPhoto}>
          Try another photo
        </button>
      )}
      {result.status === 'choose-destination' &&
        result.destinations.map((place, index) => (
          <div className="place-choice" key={place.id}>
            {choiceMap(place, plans, String(index + 1))}
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                setSelection({
                  destinationId: place.id,
                  networkRevision: result.networkRevision,
                })
              }
            >
              Go to {place.label} · {planLabel(plans.find((plan) => plan.id === place.planId)!)}
              <ArrowRight size={16} />
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
