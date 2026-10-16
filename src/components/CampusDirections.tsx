import { useState, type FormEvent } from 'react';
import { LoaderCircle, Mic, Navigation } from 'lucide-react';
import { request } from '../api';
import { photoRouteStart } from '../directions';
import type { Bootstrap, CampusDirectionsResult, CampusLocationCandidate } from '../types';

type SpeechRecognitionResult = { transcript: string };
type SpeechRecognitionEvent = { results: ArrayLike<ArrayLike<SpeechRecognitionResult>> };
type SpeechRecognition = {
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  start(): void;
};
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
};

export function CampusDirections({
  directions,
  locationEstimate,
}: {
  directions: Bootstrap['directions'];
  locationEstimate: CampusLocationCandidate | null;
}) {
  const [destination, setDestination] = useState('');
  const [result, setResult] = useState<CampusDirectionsResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const start = photoRouteStart(locationEstimate, directions.nodes);
  const speechWindow =
    typeof window === 'undefined' ? undefined : (window as SpeechRecognitionWindow);
  const SpeechRecognition =
    speechWindow?.SpeechRecognition ?? speechWindow?.webkitSpeechRecognition;

  async function findRoute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!start || !destination.trim()) return;
    setBusy(true);
    setError('');
    setVoiceError('');
    setResult(null);
    try {
      setResult(
        await request<CampusDirectionsResult>('/api/directions', {
          fromNodeId: start.id,
          destination: destination.trim(),
        }),
      );
      setMapUnavailable(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not find this destination.');
    } finally {
      setBusy(false);
    }
  }

  function speakDestination() {
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = navigator.language;
    recognition.onresult = (event) => {
      const spoken = event.results[0]?.[0]?.transcript.trim();
      if (spoken) {
        setDestination(spoken);
        setResult(null);
        setVoiceError('');
      }
    };
    recognition.onerror = () => setVoiceError('Could not hear that. Type the destination instead.');
    recognition.start();
  }

  const route = result?.route;
  return (
    <section className="directions-panel" aria-labelledby="directions-heading">
      <h2 id="directions-heading">Directions</h2>
      <p className="directions-start">
        {start
          ? `From estimated ${locationEstimate?.building} area`
          : 'Take a location photo to set a route start.'}
      </p>
      <form className="directions-form" onSubmit={(event) => void findRoute(event)}>
        <label className="visually-hidden" htmlFor="campus-destination">
          Destination
        </label>
        <input
          id="campus-destination"
          aria-label="Destination"
          autoComplete="off"
          value={destination}
          placeholder="Room or destination (e.g. SE12 302)"
          onChange={(event) => {
            setDestination(event.target.value);
            setResult(null);
            setError('');
          }}
        />
        {SpeechRecognition && (
          <button
            className="icon-button destination-mic"
            type="button"
            aria-label="Speak destination"
            onClick={speakDestination}
          >
            <Mic size={18} />
          </button>
        )}
        <button className="primary" type="submit" disabled={busy || !start || !destination.trim()}>
          {busy ? <LoaderCircle className="spin" size={17} /> : <Navigation size={17} />}
          Go
        </button>
      </form>
      {(error || voiceError) && (
        <p className="inline-error" role="alert">
          {error || voiceError}
        </p>
      )}
      {result && (
        <div className="route-result" aria-live="polite">
          <strong>{result.destination.label}</strong>
          {result.message && <p className="route-method">{result.message}</p>}
          {route && (
            <>
              <figure
                className="route-map"
                style={{
                  aspectRatio: `${directions.mapImage.width} / ${directions.mapImage.height}`,
                }}
                role="img"
                aria-label={`Visual route from ${route.start.label} to ${route.destination.label}`}
              >
                {!mapUnavailable && (
                  <>
                    <img
                      src={directions.mapImage.url}
                      alt=""
                      onError={() => setMapUnavailable(true)}
                    />
                    <svg
                      viewBox={`0 0 ${directions.mapImage.width} ${directions.mapImage.height}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      {route.segments.map((segment) => {
                        const points = segment.points
                          .map(
                            ([x, y]) =>
                              `${x * directions.mapImage.width},${y * directions.mapImage.height}`,
                          )
                          .join(' ');
                        return (
                          <polyline className="route-line" key={segment.edgeId} points={points} />
                        );
                      })}
                      <circle
                        className="route-start-marker"
                        cx={route.start.mapPoint[0] * directions.mapImage.width}
                        cy={route.start.mapPoint[1] * directions.mapImage.height}
                        r={Math.max(directions.mapImage.width, directions.mapImage.height) * 0.022}
                      />
                      <text
                        className="route-marker-label"
                        x={route.start.mapPoint[0] * directions.mapImage.width}
                        y={route.start.mapPoint[1] * directions.mapImage.height}
                      >
                        S
                      </text>
                      <circle
                        className="route-destination-marker"
                        cx={route.destination.mapPoint[0] * directions.mapImage.width}
                        cy={route.destination.mapPoint[1] * directions.mapImage.height}
                        r={Math.max(directions.mapImage.width, directions.mapImage.height) * 0.022}
                      />
                      <text
                        className="route-marker-label"
                        x={route.destination.mapPoint[0] * directions.mapImage.width}
                        y={route.destination.mapPoint[1] * directions.mapImage.height}
                      >
                        D
                      </text>
                    </svg>
                  </>
                )}
              </figure>
              {mapUnavailable && <p role="alert">The campus map could not be loaded.</p>}
              <p className="route-map-attribution">© British Columbia Institute of Technology</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}
