import { aiProviderDetails } from './ai-provider';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Compass,
  Info,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  bootstrap,
  createSession,
  request,
  ApiError,
  RequestGate,
  clearLegacyModePreference,
  readPhotoInSession,
} from './api';
import { preparePhoto, type PreparedPhoto } from './photo';
import { PHOTO_STAGE_TIMEOUT_MS, PHOTO_RESPONSE_GRACE_MS } from './photo-views';
import { CampusLocationResults } from './components/CampusLocationResults';
import { PhotoLocationInput } from './components/PhotoLocationInput';
import { JourneyPanel, StartingPositionNotice } from './components/JourneyPanel';
import './wayfinding.css';
import type { Bootstrap, Session } from './types';

export default function App() {
  const [data, setData] = useState<Bootstrap>();
  const [session, setSession] = useState<Session>();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [readStatus, setReadStatus] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [preparedPhoto, setPreparedPhoto] = useState<PreparedPhoto | null>(null);
  const [showPhotoResults, setShowPhotoResults] = useState(false);
  const [flowStep, setFlowStep] = useState<'photo' | 'destination'>('photo');
  const [destination, setDestination] = useState('');
  const [activeDestination, setActiveDestination] = useState('');
  const photoAbort = useRef<AbortController | null>(null);
  const evidenceForPhoto = useRef<{ photo: PreparedPhoto; id: string } | null>(null);
  const sessionRef = useRef<Session | undefined>(undefined);
  const busyRef = useRef(false);
  const evidenceGate = useRef(new RequestGate());
  const dialog = useRef<HTMLDialogElement>(null);

  function updateSession(next: Session) {
    sessionRef.current = next;
    setSession(next);
  }
  useEffect(() => {
    let disposed = false;
    clearLegacyModePreference();
    Promise.all([bootstrap(), createSession()])
      .then(([initial, current]) => {
        if (disposed) return;
        setData(initial);
        updateSession(current);
      })
      .catch((failure) => {
        if (!disposed) setError(failure.message);
      });
    return () => {
      disposed = true;
      evidenceGate.current.cancel();
      photoAbort.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (aboutOpen) dialog.current?.showModal();
    else dialog.current?.close();
  }, [aboutOpen]);

  function discardPhoto() {
    evidenceGate.current.cancel();
    photoAbort.current?.abort();
    setPreparedPhoto(null);
    evidenceForPhoto.current = null;
    setReadStatus('');
    setPhotoError('');
    setReading(false);
  }
  function removePhoto() {
    discardPhoto();
    setShowPhotoResults(false);
    setActiveDestination('');
    setFlowStep('photo');
    setError('');
  }
  async function send(action: unknown): Promise<Session | undefined> {
    const current = sessionRef.current;
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await request<Session>(`/api/sessions/${current.id}/actions`, {
        requestId: crypto.randomUUID(),
        revision: current.revision,
        action,
      });
      updateSession(next);
      return next;
    } catch (failure) {
      if (failure instanceof ApiError && failure.session) updateSession(failure.session);
      setError(failure instanceof Error ? failure.message : 'Something went wrong. Try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function refreshSession() {
    try {
      if (sessionRef.current)
        updateSession(await request<Session>(`/api/sessions/${sessionRef.current.id}`));
      setError('');
    } catch (failure) {
      setError((failure as Error).message);
    }
  }
  async function readPhoto(file?: File) {
    if (!file) return;
    const generation = evidenceGate.current.next();
    photoAbort.current?.abort();
    setPreparedPhoto(null);
    evidenceForPhoto.current = null;
    setShowPhotoResults(false);
    setActiveDestination('');
    setFlowStep('photo');
    setReading(true);
    setPhotoError('');
    setError('');
    setReadStatus('Preparing your photo locally…');
    try {
      const prepared = await preparePhoto(file);
      if (!evidenceGate.current.isCurrent(generation)) return;
      setPreparedPhoto(prepared);
      setReadStatus('Photo ready.');
    } catch (failure) {
      if (evidenceGate.current.isCurrent(generation)) setReadStatus((failure as Error).message);
    } finally {
      if (evidenceGate.current.isCurrent(generation)) setReading(false);
    }
  }
  async function analyzePhoto() {
    const current = sessionRef.current;
    if (
      !current ||
      !preparedPhoto ||
      !data?.liveAvailable ||
      !data.photoLocalizationAvailable ||
      busyRef.current
    )
      return;
    const generation = evidenceGate.current.next();
    const controller = new AbortController();
    photoAbort.current = controller;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setShowPhotoResults(false);
    setPhotoError('');
    setActiveDestination(destination.trim());
    setReadStatus('Finding your starting point and route…');
    let stage: 'evidence' | 'comparison' = 'evidence';
    try {
      const media = {
        consent: true,
        scope: 'wayfinding-pilot',
        image: { mimeType: preparedPhoto.mimeType, data: preparedPhoto.data },
        detailCrops: preparedPhoto.detailCrops,
      };
      const result = await readPhotoInSession(
        current,
        async (active) => {
          let latest = active;
          stage = 'evidence';
          setReadStatus('Finding your starting point and route…');
          const cached = evidenceForPhoto.current;
          if (!(
            cached?.photo === preparedPhoto &&
            latest.photoEvidence?.id === cached.id &&
            Date.parse(latest.photoEvidence.expiresAt) > Date.now()
          )) {
            latest = await request<Session>(
              `/api/sessions/${active.id}/photo/evidence`,
              {
                ...media,
                requestId: crypto.randomUUID(),
                revision: active.revision,
              },
              {
                timeoutMs: PHOTO_STAGE_TIMEOUT_MS.evidence + PHOTO_RESPONSE_GRACE_MS,
                signal: controller.signal,
              },
            );
            controller.signal.throwIfAborted();
            updateSession(latest);
            if (!latest.photoEvidence)
              throw new Error('Photo reading did not return evidence. Try again.');
            evidenceForPhoto.current = { photo: preparedPhoto, id: latest.photoEvidence.id };
          }
          const evidence = latest.photoEvidence;
          if (!evidence) throw new Error('Read this photo again before comparing plans.');
          stage = 'comparison';
          setReadStatus('Finding your starting point and route…');
          return request<Session>(
            `/api/sessions/${active.id}/photo`,
            {
              ...media,
              requestId: crypto.randomUUID(),
              revision: latest.revision,
              evidenceId: evidence.id,
            },
            {
              timeoutMs: PHOTO_STAGE_TIMEOUT_MS.comparison + PHOTO_RESPONSE_GRACE_MS,
              signal: controller.signal,
            },
          );
        },
        async () => {
          const fresh = await request<Session>('/api/sessions', {}, { signal: controller.signal });
          controller.signal.throwIfAborted();
          evidenceForPhoto.current = null;
          updateSession(fresh);
          return fresh;
        },
        controller.signal,
      );
      if (!evidenceGate.current.isCurrent(generation)) return;
      updateSession(result);
      evidenceForPhoto.current = null;
      setShowPhotoResults(true);
      setPreparedPhoto(null);
      setPhotoError('');
      setReadStatus('');
    } catch (failure) {
      if (evidenceGate.current.isCurrent(generation)) {
        if (failure instanceof ApiError && failure.session) updateSession(failure.session);
        setReadStatus('');
        const step = stage === 'evidence' ? 'Reading the photo' : 'Comparing the floor plans';
        setPhotoError(
          `${step} stopped. ${failure instanceof Error ? failure.message : 'Please try again.'}`,
        );
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (photoAbort.current === controller) photoAbort.current = null;
    }
  }
  if (!data || !session)
    return (
      <main className="loading-page">
        <Compass size={42} />
        <h1>DirectionallyUnchallenged</h1>
        <p>{error || 'Loading…'}</p>
        {error && (
          <button className="primary" onClick={() => location.reload()}>
            Try again
          </button>
        )}
      </main>
    );
  const plans = data.visualPlans.filter(
    (plan) =>
      session.campusAnalysis?.candidates.some((candidate) => candidate.planId === plan.id) ||
      session.campusAnalysis?.referenceLabels?.some((ref) => ref.planId === plan.id),
  );
  const photoReady = data.liveAvailable && data.photoLocalizationAvailable;
  const provider = aiProviderDetails(data.provider);
  const submissionNotice = `Tapping Go sends this photo and its detail views to ${provider.recipient} to find your starting area. Relevant official floor plans and your destination are also sent to generate directions. ${provider.dataUse}`;
  const analysis = showPhotoResults ? session.campusAnalysis : null;
  const region = analysis ? session.campusLocation : null;
  const routeCandidate = region ?? undefined;
  const directionsMode = Boolean(analysis && activeDestination);
  const photoInput = (
    <>
      <PhotoLocationInput
        step={analysis ? 'destination' : preparedPhoto ? flowStep : 'photo'}
        providerName={data.provider}
        destination={destination}
        submissionNotice={submissionNotice}
        canUsePhotoResult={!!analysis?.candidates.length}
        onDestinationChange={(value) => {
          setDestination(value);
          setActiveDestination('');
        }}
        photo={preparedPhoto}
        ready={photoReady}
        reading={reading}
        busy={busy}
        status={readStatus}
        error={photoError}
        onPhoto={(file) => void readPhoto(file)}
        onNext={() => setFlowStep('destination')}
        onBack={() => (preparedPhoto ? setFlowStep('photo') : removePhoto())}
        onAnalyze={() => void analyzePhoto()}
        onDiscard={removePhoto}
      />
    </>
  );
  const photoResults = analysis && (
    <>
      <CampusLocationResults analysis={analysis} plans={plans} />
    </>
  );
  const updateDestination = analysis &&
    destination.trim() &&
    destination.trim() !== activeDestination && (
      <button
        className="primary full-width"
        disabled={busy}
        onClick={() => setActiveDestination(destination.trim())}
      >
        GO to {destination.trim()}
      </button>
    );
  return (
    <div className="app-shell visitor-shell">
      <header className="header">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
          }}
        >
          <span className="brand-mark">
            <Compass size={25} strokeWidth={1.7} />
          </span>
          <span className="brand-name">
            Directionally
            <wbr />
            Unchallenged
          </span>
          <span className="brand-dot">.</span>
        </a>
        <div className="header-end">
          <span
            className={`provider-status ${data.liveAvailable ? 'live' : ''}`}
            data-testid="provider-status"
          >
            <span className="status-dot" />
            {data.liveAvailable ? `${provider.label} ready` : 'Setup required'}
          </span>
          <button
            className="icon-button"
            aria-label="About DirectionallyUnchallenged"
            onClick={() => setAboutOpen(true)}
          >
            <Info size={19} />
          </button>
        </div>
      </header>
      <main>
        {!data.liveAvailable && (
          <div className="setup-notice" role="note">
            <ShieldCheck size={21} />
            <div>
              <strong>{provider.label} setup required</strong>
              <p>
                {data.setupNotice ??
                  `Photo analysis needs a ${provider.label} key configured on the server. Add your key and restart the app.`}
              </p>
            </div>
          </div>
        )}
        {error && (
          <div role="alert" className="error-banner">
            <AlertTriangle size={18} />
            <span>{error}</span>
            <button onClick={() => void refreshSession()}>Refresh state</button>
            <button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="workspace">
          {data.liveAvailable && !data.photoLocalizationAvailable && (
            <p className="setup-notice" role="note">
              Floor-plan images are not ready on this server. Restart after preparing the source
              plans.
            </p>
          )}
          {directionsMode ? (
            <>
              {routeCandidate && analysis?.candidates.length ? <StartingPositionNotice /> : null}
              {routeCandidate ? (
                <JourneyPanel
                  key={JSON.stringify([session.id, routeCandidate.id, activeDestination])}
                  sessionId={session.id}
                  revision={session.revision}
                  candidate={routeCandidate}
                  destination={activeDestination}
                  plans={data.visualPlans}
                  locationCatalogue={data.locationCatalogue}
                  busy={busy}
                  onTryAnotherPhoto={() => {
                    setShowPhotoResults(false);
                    setFlowStep('photo');
                  }}
                />
              ) : (
                <section className="journey-panel">
                  <h2>Couldn’t find your starting point</h2>
                  <p>Try another photo showing a nearby room sign, doorway, or hallway junction.</p>
                  <button
                    className="primary full-width"
                    onClick={() => {
                      setShowPhotoResults(false);
                      setFlowStep('photo');
                    }}
                  >
                    Try another photo
                  </button>
                </section>
              )}
              {analysis && (
                <details className="journey-evidence">
                  <summary>Location evidence</summary>
                  {photoResults}
                </details>
              )}
            </>
          ) : (
            <>
              {!analysis && photoInput}
              {photoResults}
            </>
          )}
          {analysis && (
            <details key={analysis.requestId} className="journey-inputs" open={!directionsMode}>
              <summary>Edit photo or destination</summary>
              {photoInput}
              {updateDestination}
            </details>
          )}
          {analysis && (
            <div className="result-actions">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  removePhoto();
                  setDestination('');
                  void send({ type: 'reset' });
                }}
              >
                <RotateCcw size={15} />
                {directionsMode ? 'Start over' : 'Clear'}
              </button>
            </div>
          )}
        </div>
      </main>
      <footer>
        <span>
          DirectionallyUnchallenged<span className="brand-dot">.</span>
          <small>A COMP 4989 project · Independent student prototype</small>
        </span>
        <button onClick={() => setAboutOpen(true)}>
          Coverage & privacy
          <ArrowUpRight size={14} />
        </button>
      </footer>
      <dialog
        ref={dialog}
        aria-labelledby="about-heading"
        className="dialog"
        onCancel={(event) => {
          event.preventDefault();
          setAboutOpen(false);
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) setAboutOpen(false);
        }}
      >
        <div className="dialog-content">
          <button
            className="dialog-close icon-button"
            aria-label="Close dialog"
            onClick={() => setAboutOpen(false)}
          >
            <X size={21} />
          </button>
          {aboutOpen && (
            <>
              <span className="modal-icon">
                <Compass size={25} />
              </span>
              <h2 id="about-heading">About DirectionallyUnchallenged</h2>
              <p>
                Visitor wayfinding covers SE12, SW03 and SW01 at BCIT Burnaby. Photographs are
                compared with the twelve official floor plans for these buildings.
              </p>
              <div className="about-section">
                <h3>What you can do</h3>
                <p>
                  Add a photo, enter a destination, and tap Go. The AI finds the starting area and
                  destination on the official plans, then generates the route.
                </p>
              </div>
              <div className="about-section">
                <h3>What still needs validation</h3>
                <p>
                  Cross-building directions use mapped building connections. Generated floor paths,
                  distances, travel times, accessibility and live conditions have not been
                  independently field-verified.
                </p>
              </div>
              <div className="about-section">
                <h3>Your data stays transient</h3>
                <p>
                  Tapping Go sends this photo and its detail views to {provider.recipient}; relevant
                  official plans and the destination are also sent to generate directions. The app
                  does not save photos or route history. Optional device tracking in walking
                  directions stays in this browser tab. Hosted session results are encrypted and
                  expire after 30 minutes; reloading starts a new session. {provider.dataUse}
                </p>
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
