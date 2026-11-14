import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { request } from '../api';
import type { CampusLocationCandidate, VisualPlan } from '../types';
import type { MapStop, NavigationResult, PlaceChoice, StartingPoints } from '../wayfinding';
import { planLabel } from '../topology';
import { RouteMap } from './RouteMap';
import { RouteDirections } from './RouteDirections';

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

function OriginOptions({
  candidate,
  plan,
  origins,
  destination,
  busy,
  onSelect,
}: {
  candidate: CampusLocationCandidate;
  plan: VisualPlan;
  origins: MapStop[];
  destination: string;
  busy: boolean;
  onSelect: (origin: MapStop) => void;
}) {
  return (
    <>
      <p>
        Your photo suggests {planLabel(plan)}
        {candidate.doorwayVicinity ? `, near room ${candidate.doorwayVicinity.room}` : ''}. Choose
        the point where you are standing.
      </p>
      <div className="place-choices">
        {origins.map((point, i) => (
          <button
            className="primary"
            key={point.id}
            disabled={busy}
            onClick={() => onSelect(point)}
          >
            {origins.length > 1 && <b>{i + 1}</b>} Start at {point.label} → {destination}
          </button>
        ))}
      </div>
      <RouteMap
        plan={plan}
        bounds={candidate.bounds ?? undefined}
        markers={origins.map((point, i) => ({
          point: point.point,
          label: point.label,
          symbol: String(i + 1),
        }))}
        label="Possible photo area and reviewed starting points"
      />
    </>
  );
}

export function JourneyPanel({
  sessionId,
  revision,
  candidate,
  confirmed,
  destination,
  plans,
  busy,
  onConfirm,
}: {
  sessionId: string;
  revision: number;
  candidate: CampusLocationCandidate;
  confirmed: boolean;
  destination: string;
  plans: VisualPlan[];
  busy: boolean;
  onConfirm: (candidateId: string) => Promise<boolean>;
}) {
  const [selection, setSelection] = useState<{
    originId?: string;
    destinationId?: string;
    networkRevision?: number;
  }>({});
  const [result, setResult] = useState<NavigationResult>();
  const [error, setError] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (result && result.status !== 'route') {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [result?.status]);
  useEffect(() => {
    const controller = new AbortController();
    setResult(undefined);
    setError('');
    async function resolveJourney(): Promise<NavigationResult> {
      if (!confirmed) {
        const points = await request<StartingPoints>(
          `/api/sessions/${sessionId}/navigation/origins`,
          { revision, candidateId: candidate.id },
          { signal: controller.signal },
        );
        return {
          ...points,
          destinations: [],
          status: points.origins.length ? 'choose-origin' : 'unmapped-origin',
          message: points.origins.length
            ? 'Select your starting point.'
            : 'This photo area has no reviewed starting point. Try a photo at a mapped doorway, stair landing or elevator.',
        };
      }
      return request<NavigationResult>(
        `/api/sessions/${sessionId}/navigation`,
        { revision, candidateId: candidate.id, destination, ...selection },
        { signal: controller.signal },
      );
    }
    resolveJourney()
      .then((value) => {
        if (!controller.signal.aborted) setResult(value);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [sessionId, revision, candidate.id, confirmed, destination, selection]);

  async function chooseOrigin(origin: MapStop) {
    if (!result || busy) return;
    const networkRevision = result.networkRevision;
    if (!confirmed && !(await onConfirm(candidate.id))) return;
    setResult(undefined);
    setSelection((old) => ({ ...old, originId: origin.id, networkRevision }));
  }
  const recheck = () => {
    setResult(undefined);
    setSelection({});
  };
  if (error)
    return (
      <section className="journey-panel">
        <p role="alert">{error}</p>
        <button className="secondary" onClick={recheck}>
          Refresh walking map
        </button>
      </section>
    );
  if (!result)
    return (
      <section className="journey-panel" role="status">
        {confirmed ? 'Finding walking directions…' : 'Finding your starting point…'}
      </section>
    );
  if (result.status === 'route')
    return (
      <section className="journey-panel" aria-label="Your walking route">
        <RouteDirections route={result} plans={plans} onRecheck={recheck} />
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
    <section className="journey-panel" aria-label="Route to destination">
      <div className="way-heading">
        <MapPin size={21} />
        <h2 tabIndex={-1} ref={headingRef}>
          {headings[result.status]}
        </h2>
      </div>
      {result.status === 'choose-origin' ? (
        <OriginOptions
          candidate={candidate}
          plan={plans.find((p) => p.id === candidate.planId)!}
          origins={result.origins}
          destination={destination}
          busy={busy}
          onSelect={(origin) => void chooseOrigin(origin)}
        />
      ) : (
        <p role="status">{result.message}</p>
      )}
      {result.status === 'choose-destination' &&
        result.destinations.map((p, i) => (
          <div className="place-choice" key={p.id}>
            {choiceMap(p, plans, String(i + 1))}
            <button
              className="secondary"
              onClick={() => {
                setResult(undefined);
                setSelection({
                  ...selection,
                  destinationId: p.id,
                  networkRevision: result.networkRevision,
                });
              }}
            >
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
