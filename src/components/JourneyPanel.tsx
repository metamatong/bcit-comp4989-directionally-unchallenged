import { useEffect, useRef, useState } from 'react';
import { Check, MapPin, Route } from 'lucide-react';
import { request } from '../api';
import type { CampusLocationCandidate, VisualPlan } from '../types';
import type { NavigationResult } from '../wayfinding';
import { RouteDirections } from './RouteDirections';
import type { LocationCatalogue } from '../location/types';

export function StartingPositionNotice({
  detail,
  loading = false,
}: {
  detail?: string;
  loading?: boolean;
}) {
  return (
    <div className="route-ready" role="status" aria-live="polite">
      <span className="route-ready-icon" aria-hidden="true">
        <Check size={18} />
      </span>
      <span>
        <strong>Starting area estimated</strong>
        {detail && (
          <small className={loading ? 'route-loading' : undefined}>
            {loading && <Route size={15} className="spin" />} {detail}
          </small>
        )}
      </span>
    </div>
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
      { revision, candidateId: candidate.id, destination },
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [sessionId, revision, candidate.id, destination, refresh]);

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
        <p className="photo-status">
          <Route size={15} className="spin" /> Finding your route…
        </p>
      </section>
    );
  if (result.status === 'route')
    return (
      <section className="journey-panel" aria-label="Your walking route">
        {result.destinationMatch && (
          <p className="destination-match" role="status">
            Matching “{result.destinationMatch.requested}” to {result.destinationMatch.matched}.
          </p>
        )}
        <RouteDirections
          route={result}
          plans={plans}
          onRecheck={() => {
            setRefresh((value) => value + 1);
          }}
          locationCatalogue={locationCatalogue}
        />
      </section>
    );

  const headings = {
    'choose-origin': 'Starting point is unclear',
    'choose-destination': 'Destination match is unclear',
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
      {result.status === 'no-route' && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Retry route
        </button>
      )}
      {needsAnotherPhoto && (
        <button className="primary full-width" disabled={busy} onClick={onTryAnotherPhoto}>
          Try another photo
        </button>
      )}
    </section>
  );
}
