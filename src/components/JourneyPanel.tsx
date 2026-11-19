import { useEffect, useRef, useState } from 'react';
import { Check, MapPin, Route } from 'lucide-react';
import { request } from '../api';
import type { CampusLocationCandidate, VisualPlan } from '../types';
import type { NavigationChoice, NavigationResult } from '../wayfinding';
import { FloorPointPicker } from './FloorPointPicker';
import { RouteDirections } from './RouteDirections';
import { RouteMapImage } from './RouteMap';
import { planLabel } from '../topology';
import type { LocationCatalogue } from '../location/types';

export function StartingPositionNotice({
  detail,
  loading = false,
  labelOnly = false,
}: {
  detail?: string;
  loading?: boolean;
  labelOnly?: boolean;
}) {
  return (
    <div className="route-ready" role="status" aria-live="polite">
      <span className="route-ready-icon" aria-hidden="true">
        <Check size={18} />
      </span>
      <span>
        <strong>{labelOnly ? 'Photo label matched' : 'Starting area estimated'}</strong>
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
  const [choice, setChoice] = useState<
    Omit<NavigationChoice, 'candidateId' | 'destination' | 'revision'>
  >({});
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined);
    setError('');
    request<NavigationResult>(
      `/api/sessions/${sessionId}/navigation`,
      { revision, candidateId: candidate.id, destination, ...choice },
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [sessionId, revision, candidate.id, destination, refresh, choice]);

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
        <button
          className="secondary"
          onClick={() => {
            setChoice({});
            setRefresh((value) => value + 1);
          }}
        >
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
  const requestMap =
    destination === 'Map point' ||
    /^(?:NE|NW|SE|SW)\s*-?\s*\d+(?:\s+floor\s+\d+)?$/i.test(destination.trim());
  const chooseMap = candidate.sourcePlaceId && (
    <FloorPointPicker
      sessionId={sessionId}
      revision={revision}
      candidate={candidate}
      destination={destination}
      plans={plans}
      initialDestination={requestMap && !choice.destinationPoint}
      onPick={(role, pin) =>
        setChoice((c) => ({
          ...c,
          [role === 'origin' ? 'originId' : 'destinationId']: undefined,
          [role === 'origin' ? 'originPoint' : 'destinationPoint']: pin,
          networkRevision: result.networkRevision,
        }))
      }
    />
  );
  if (requestMap && !choice.destinationPoint && chooseMap)
    return <section className="journey-panel">{chooseMap}</section>;
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
        {result.arrivalNote && <p role="note">{result.arrivalNote}</p>}
        {chooseMap}
      </section>
    );

  const selectingOrigin = result.status === 'choose-origin' && result.origins.length > 0;
  const selectingDestination =
    result.status === 'choose-destination' && result.destinations.length > 0;
  if (selectingOrigin || selectingDestination) {
    const options = selectingOrigin ? result.origins : result.destinations;
    const planIds = [...new Set(options.map((option) => option.planId))];
    return (
      <section className="journey-panel" aria-label="Route location choices">
        <h2>
          {selectingOrigin
            ? result.message.includes('shared entrance')
              ? 'Start at the marked shared entrance?'
              : 'Which doorway are you beside?'
            : 'Which destination do you mean?'}
        </h2>
        {planIds.map((id) => {
          const plan = plans.find((p) => p.id === id);
          if (!plan) return null;
          const group = options.filter((p) => p.planId === id);
          const markers = group.flatMap((place, i) => {
            const bounds = 'bounds' in place ? place.bounds : undefined;
            const point =
              place.point ??
              (bounds
                ? { x: (bounds[0] + bounds[2]) / 2, y: (bounds[1] + bounds[3]) / 2 }
                : undefined);
            return point ? [{ point, symbol: String(i + 1), label: place.label }] : [];
          });
          return (
            <div key={id}>
              <h3>{planLabel(plan)}</h3>
              {(group.length > 1 ||
                (selectingOrigin && result.message.includes('shared entrance'))) && (
                <RouteMapImage
                  plan={plan}
                  paths={[]}
                  markers={markers}
                  label="Numbered location choices on the floor plan"
                />
              )}
              {group.map((place, i) => (
                <button
                  className="secondary"
                  key={place.id}
                  disabled={busy}
                  onClick={() =>
                    setChoice({
                      ...choice,
                      [selectingOrigin ? 'originId' : 'destinationId']: place.id,
                      networkRevision: result.networkRevision,
                    })
                  }
                >
                  {group.length > 1 ? i + 1 + ' · ' : ''}
                  {place.label}
                </button>
              ))}
            </div>
          );
        })}
        {chooseMap}
      </section>
    );
  }
  const headings = {
    'choose-origin': 'Starting point is unclear',
    'choose-destination': 'Destination match is unclear',
    'unknown-destination': 'Destination not found',
    'unmapped-destination': 'Destination found on the plan',
    'restricted-place': 'Staff-only area',
    'unsupported-building': 'Routes are not mapped here yet',
    'unmapped-origin-and-destination': 'Route coverage is incomplete',
    'unmapped-origin':
      result.originIssue === 'ambiguous-doorway'
        ? 'Starting doorway is unclear'
        : result.originIssue === 'ambiguous-region' ||
            (!result.originIssue && result.origins.length > 1)
          ? 'Starting point needs a closer match'
          : 'Starting route not mapped',
    'no-route': 'Route unavailable',
  };
  const needsAnotherPhoto =
    result.status === 'choose-origin' ||
    (result.status === 'unmapped-origin' &&
      (result.originIssue === 'ambiguous-region' ||
        (!result.originIssue && result.origins.length > 1)));

  return (
    <section className="journey-panel" aria-label="Route to destination">
      <div className="way-heading">
        <MapPin size={21} />
        <h2 tabIndex={-1} ref={headingRef}>
          {headings[result.status]}
        </h2>
      </div>
      <p role="status">{result.message}</p>
      {chooseMap}
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
