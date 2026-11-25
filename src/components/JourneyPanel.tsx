import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, MapPin, RotateCcw, Route } from 'lucide-react';
import { prefetchWalkingSurfaces, request } from '../api';
import type { CampusLocationCandidate, VisualPlan } from '../types';
import { mapDestinationScope, type NavigationChoice, type NavigationResult } from '../wayfinding';
import { FloorPointPicker } from './FloorPointPicker';
import { CampusSearchMap, zoomDurationMs } from './CampusSearchMap';
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

type JourneyProps = {
  sessionId: string;
  revision: number;
  candidate: CampusLocationCandidate;
  destination: string;
  preferElevators?: boolean;
  plans: VisualPlan[];
  busy: boolean;
  onTryAnotherPhoto: () => void;
  onStartOver?: () => void;
  onGuidedChange?: (guided: boolean) => void;
  locationCatalogue?: LocationCatalogue;
  locationEvidence?: ReactNode;
  editInputs?: ReactNode;
};

export function JourneyPanel(props: JourneyProps) {
  const {
    sessionId,
    revision,
    candidate,
    destination,
    preferElevators = false,
    plans,
    locationEvidence,
    editInputs,
    onStartOver,
    onGuidedChange,
  } = props;
  const [result, setResult] = useState<NavigationResult>();
  const loadingPanel = useRef<HTMLElement>(null);
  const [routeBuildings, setRouteBuildings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [guided, setGuided] = useState(false);
  const [choice, setChoice] = useState<
    Omit<NavigationChoice, 'candidateId' | 'destination' | 'revision'>
  >({});

  const handleGuidedChange = useCallback(
    (next: boolean) => {
      setGuided(next);
      onGuidedChange?.(next);
    },
    [onGuidedChange],
  );

  useEffect(() => {
    if (candidate.planId) {
      prefetchWalkingSurfaces([candidate.planId]);
    }
  }, [candidate.planId]);

  useEffect(() => {
    const controller = new AbortController();
    let exitFade: Animation | undefined;
    setRouteBuildings([]);
    setResult(undefined);
    setError('');
    handleGuidedChange(false);
    request<NavigationResult>(
      `/api/sessions/${sessionId}/navigation`,
      { revision, candidateId: candidate.id, destination, preferElevators, ...choice },
      { signal: controller.signal },
    )
      .then(async (value) => {
        if (controller.signal.aborted) return;
        if (value.status === 'route' && loadingPanel.current && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          const byPlan = new Map(plans.map(plan => [plan.id, plan.building]));
          const stops = [value.origin, ...value.steps.map(step => step.to), value.destination];
          setRouteBuildings([...new Set(stops.flatMap(stop => byPlan.get(stop.planId) ?? []))]);
          exitFade = loadingPanel.current.animate([{ opacity: 1 }, { opacity: 0 }], {
            delay: zoomDurationMs,
            duration: 416,
            easing: 'ease-in-out',
            fill: 'forwards',
          });
          await exitFade.finished;
          if (!controller.signal.aborted) setResult(value);
        } else {
          setResult(value);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => { controller.abort(); exitFade?.cancel(); };
  }, [sessionId, revision, candidate.id, destination, preferElevators, refresh, choice]);

  const useMapDestination =
    !!candidate.sourcePlaceId && mapDestinationScope(destination) !== undefined;
  const recheck = () => setRefresh((value) => value + 1);
  function pointPicker() {
    if (!result || !candidate.sourcePlaceId) return null;
    return (
      <FloorPointPicker
        sessionId={sessionId}
        revision={revision}
        candidate={candidate}
        destination={destination}
        plans={plans}
        initiallyOpen={!choice.destinationPoint}
        onPick={(pin) =>
          setChoice((current) => ({
            ...current,
            destinationId: undefined,
            destinationPoint: pin,
            networkRevision: result.networkRevision,
          }))
        }
      />
    );
  }

  const routeOwnsUtilities =
    !error &&
    !!result &&
    !(useMapDestination && !choice.destinationPoint) &&
    (result.status === 'route' || Boolean(result.mappedPortion));

  let panel: ReactNode;
  if (error) {
    panel = (
      <section className="journey-panel">
        <p role="alert">{error}</p>
        <button
          className="secondary sheet-pill-btn"
          onClick={() => {
            setChoice({});
            recheck();
          }}
        >
          Try again
        </button>
      </section>
    );
  } else if (!result) {
    panel = (
      <section ref={loadingPanel} className="journey-panel journey-loading" role="status">
        <div className="campus-search"><CampusSearchMap building={candidate.building} routeBuildings={routeBuildings} /></div>
        <p className="photo-status">
          <Route size={16} className="spin" /> {routeBuildings.length ? routeBuildings.map(id => id.replace(/^SW(\d)$/, 'SW0$1')).join(' → ') : 'Finding your route…'}
        </p>
      </section>
    );
  } else if (useMapDestination && !choice.destinationPoint) {
    panel = <section className="journey-panel">{pointPicker()}</section>;
  } else {
    panel = (
      <JourneyResult
        busy={props.busy}
        preferElevators={preferElevators}
        plans={plans}
        locationCatalogue={props.locationCatalogue}
        onTryAnotherPhoto={props.onTryAnotherPhoto}
        onStartOver={onStartOver}
        onGuidedChange={handleGuidedChange}
        guided={guided}
        locationEvidence={locationEvidence}
        editInputs={editInputs}
        result={result}
        onRecheck={recheck}
        onChoose={(field, id) =>
          setChoice((current) => ({
            ...current,
            [field]: id,
            networkRevision: result.networkRevision,
          }))
        }
      />
    );
  }

  return (
    <>
      {panel}
      {useMapDestination && choice.destinationPoint && !guided && pointPicker()}
      {!routeOwnsUtilities && (
        <div className="overview-utilities">
          {editInputs}
          {locationEvidence && (
            <details className="journey-evidence">
              <summary>Location evidence</summary>
              {locationEvidence}
            </details>
          )}
          {onStartOver && (
            <div className="overview-footer-actions">
              <button
                type="button"
                className="text-button"
                disabled={props.busy}
                onClick={onStartOver}
              >
                <RotateCcw size={15} />
                Start over
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function JourneyResult({
  result,
  plans,
  locationCatalogue,
  onTryAnotherPhoto,
  onStartOver,
  onGuidedChange,
  guided,
  locationEvidence,
  editInputs,
  busy,
  onRecheck,
  onChoose,
  preferElevators,
}: Pick<
  JourneyProps,
  | 'plans'
  | 'locationCatalogue'
  | 'onTryAnotherPhoto'
  | 'onStartOver'
  | 'onGuidedChange'
  | 'locationEvidence'
  | 'editInputs'
  | 'busy'
  | 'preferElevators'
> & {
  guided: boolean;
  result: NavigationResult;
  onRecheck: () => void;
  onChoose: (field: 'destinationId', id: string) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (result.status !== 'route') {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [result.status]);

  if (result.status === 'route')
    return (
      <section
        className={guided ? 'journey-panel journey-panel-guided' : 'journey-panel journey-panel-overview'}
        aria-label="Your walking route"
      >
        {!guided && result.destinationMatch && (
          <p className="destination-match" role="status">
            Matching “{result.destinationMatch.requested}” to {result.destinationMatch.matched}.
          </p>
        )}
        <RouteDirections
          route={result}
          preferElevators={preferElevators}
          plans={plans}
          onRecheck={onRecheck}
          locationCatalogue={locationCatalogue}
          onGuidedChange={onGuidedChange}
          locationEvidence={locationEvidence}
          editInputs={editInputs}
          onStartOver={onStartOver}
          busy={busy}
        />
        {!guided && result.arrivalNote && <p role="note">{result.arrivalNote}</p>}
      </section>
    );

  const selectingDestination =
    result.status === 'choose-destination' && result.destinations.length > 0;
  if (selectingDestination) {
    const options = result.destinations;
    const planIds = [...new Set(options.map((option) => option.planId))];
    return (
      <section className="journey-panel" aria-label="Route location choices">
        <h2>Which destination do you mean?</h2>
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
            <div key={id} className="destination-choice-group">
              <h3>{planLabel(plan)}</h3>
              {group.length > 1 && (
                <RouteMapImage
                  plan={plan}
                  paths={[]}
                  markers={markers}
                  label="Numbered location choices on the floor plan"
                />
              )}
              <div className="place-choices">
                {group.map((place, i) => (
                  <button
                    className="secondary sheet-pill-btn"
                    key={place.id}
                    disabled={busy}
                    onClick={() => onChoose('destinationId', place.id)}
                  >
                    {group.length > 1 ? i + 1 + ' · ' : ''}
                    {place.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>
    );
  }
  const headings = {
    'choose-destination': 'Destination match is unclear',
    'unknown-destination': 'Destination not found',
    'unmapped-destination': 'Destination entrance not connected',
    'restricted-place':
      result.restriction === 'non-walking' ? 'Non-walking map feature' : 'Staff-only area',
    'unsupported-building': 'Routes are not mapped here yet',
    'unmapped-origin-and-destination': 'Route coverage is incomplete',
    'unmapped-origin': 'Could not match the photo to a mapped route',
    'no-route': 'Route unavailable',
  };
  const needsAnotherPhoto =
    !result.mappedPortion &&
    (result.status === 'unmapped-origin' || result.status === 'unmapped-origin-and-destination');

  return (
    <section
      className={result.mappedPortion ? 'journey-panel journey-panel-overview' : 'journey-panel'}
      aria-label="Route to destination"
    >
      {result.mappedPortion ? (
        <RouteDirections
          route={{ ...result, ...result.mappedPortion, status: 'route' }}
          requestedRoom={result.mappedPortion.requested}
          requestedOrigin={result.mappedPortion.requestedOrigin}
          plans={plans}
          locationCatalogue={locationCatalogue}
          preferElevators={preferElevators}
          onRecheck={onRecheck}
          locationEvidence={locationEvidence}
          editInputs={editInputs}
          onStartOver={onStartOver}
          busy={busy}
        />
      ) : (
        <>
          <div className="way-heading">
            <MapPin size={21} />
            <h2 tabIndex={-1} ref={headingRef}>
              {headings[result.status]}
            </h2>
          </div>
          <p role="status">{result.message}</p>
        </>
      )}
      {!result.mappedPortion && result.status === 'no-route' && (
        <button className="secondary full-width sheet-pill-btn" disabled={busy} onClick={onRecheck}>
          Retry route
        </button>
      )}
      {needsAnotherPhoto && (
        <button
          className="primary full-width sheet-pill-btn"
          disabled={busy}
          onClick={onTryAnotherPhoto}
        >
          Try another photo
        </button>
      )}
    </section>
  );
}
