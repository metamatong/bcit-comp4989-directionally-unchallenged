import { aiProviderDetails } from './ai-provider';
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
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
import { JourneyPanel } from './components/JourneyPanel';
import { PhotoDeviceRequirement } from './components/PhotoDeviceLocation';
import { usePhotoDeviceLocation } from './location/use-device-location';
import { gpsBuildingHint } from './location/building-hint';
import './wayfinding.css';
import type { Bootstrap, Session } from './types';

export default function App() {
  const photoDevice = usePhotoDeviceLocation();
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
  const [preferElevators, setPreferElevators] = useState(false);
  const [activeDestination, setActiveDestination] = useState('');
  const [guidedMode, setGuidedMode] = useState(false);
  const photoAbort = useRef<AbortController | null>(null);
  const evidenceForPhoto = useRef<{ photo: PreparedPhoto; id: string; contextKey: string } | null>(
    null,
  );
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
    photoDevice.clear();
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
    setGuidedMode(false);
    setError('');
  }
  function startOver() {
    removePhoto();
    setDestination('');
    setPreferElevators(false);
    void send({ type: 'reset' });
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
    photoDevice.clear();
    const generation = evidenceGate.current.next();
    photoAbort.current?.abort();
    setPreparedPhoto(null);
    evidenceForPhoto.current = null;
    setShowPhotoResults(false);
    setActiveDestination('');
    setFlowStep('photo');
    setGuidedMode(false);
    setReading(true);
    setPhotoError('');
    setError('');
    setReadStatus('Preparing your photo locally…');
    try {
      const prepared = await preparePhoto(file);
      if (!evidenceGate.current.isCurrent(generation)) return;
      setPreparedPhoto(prepared);
      setReadStatus('');
      // Auto-advance straight to Destination once local photo preparation finishes.
      setFlowStep('destination');
    } catch (failure) {
      if (evidenceGate.current.isCurrent(generation)) {
        setReadStatus('');
        setPhotoError(
          failure instanceof Error
            ? failure.message
            : 'Unable to prepare this photo. Choose a smaller image.',
        );
      }
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
      (!data.gpsTestMode && !data.locationCatalogue) ||
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
    setReadStatus(
      data.gpsTestMode
        ? 'Finding your starting point from the photo…'
        : 'Requesting GPS and finding your starting point…',
    );
    let stage: 'evidence' | 'location' = 'evidence';
    try {
      stage = 'location';
      const firstReading = data.gpsTestMode ? undefined : await photoDevice.capture();
      controller.signal.throwIfAborted();
      let gps = firstReading
        ? gpsBuildingHint(firstReading.reading, data.locationCatalogue!)
        : undefined;
      setReadStatus('Reading your photo…');
      const media = {
        consent: true,
        image: { mimeType: preparedPhoto.mimeType, data: preparedPhoto.data },
        detailCrops: preparedPhoto.detailCrops,
      };
      const result = await readPhotoInSession(
        current,
        async (active) => {
          let latest = active;
          stage = 'evidence';
          setReadStatus('Reading your photo…');
          const contextKey = JSON.stringify(gps ? [gps.buildings, gps.sourceSha256] : null);
          const cached = evidenceForPhoto.current;
          if (!(
            cached?.photo === preparedPhoto &&
            cached.contextKey === contextKey &&
            latest.photoEvidence?.id === cached.id &&
            Date.parse(latest.photoEvidence.expiresAt) > Date.now()
          )) {
            latest = await request<Session>(
              `/api/sessions/${active.id}/photo/evidence`,
              {
                ...media,
                ...(gps ? { gps } : {}),
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
            evidenceForPhoto.current = {
              photo: preparedPhoto,
              id: latest.photoEvidence.id,
              contextKey,
            };
          }
          const evidence = latest.photoEvidence;
          if (!evidence) throw new Error('Read this photo again before comparing plans.');
          stage = 'location';
          setReadStatus(
            data.gpsTestMode
              ? 'Matching your photo to the floor plans…'
              : 'Requesting GPS and matching your photo…',
          );
          if (!data.gpsTestMode && gps && Date.now() - gps.capturedAt > 20000) {
            const refreshed = await photoDevice.capture();
            controller.signal.throwIfAborted();
            gps = gpsBuildingHint(refreshed.reading, data.locationCatalogue!);
          }
          return request<Session>(
            `/api/sessions/${active.id}/photo/location`,
            {
              requestId: crypto.randomUUID(),
              revision: latest.revision,
              evidenceId: evidence.id,
              ...(gps ? { gps } : {}),
            },
            {
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
        const step = stage === 'evidence' ? 'Reading the photo' : 'Finding your starting place';
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
          <button className="primary sheet-pill-btn" onClick={() => location.reload()}>
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
  const photoReady =
    data.liveAvailable &&
    data.photoLocalizationAvailable &&
    (data.gpsTestMode || !!data.locationCatalogue);
  const provider = aiProviderDetails(data.provider);
  const analysis = showPhotoResults ? session.campusAnalysis : null;
  const region = analysis ? session.campusLocation : null;
  const routeCandidate = region ?? undefined;
  const directionsMode = Boolean(analysis && activeDestination);
  const isDestinationScreen = !analysis && !!preparedPhoto && flowStep === 'destination';
  const showAppHeader = !guidedMode && !isDestinationScreen && !(directionsMode && routeCandidate);

  const photoInput = (
    <PhotoLocationInput
      step={analysis ? 'destination' : preparedPhoto ? flowStep : 'photo'}
      destination={destination}
      destinations={data.destinations}
      preferElevators={preferElevators}
      onPreferElevatorsChange={(value) => {
        setPreferElevators(value);
        setActiveDestination('');
      }}
      canUsePhotoResult={!!analysis?.candidates.length}
      locationRequirement={
        data.gpsTestMode ? (
          <p className="gps-auto-note" role="note">GPS disabled for local testing</p>
        ) : (
          <PhotoDeviceRequirement />
        )
      }
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
  );
  const summaryInRoutePanel =
    directionsMode &&
    analysis?.method === 'photo-label-retrieval' &&
    !routeCandidate &&
    !analysis.candidates.length;
  const photoResults = analysis && (
    <CampusLocationResults
      analysis={analysis}
      selectedId={routeCandidate?.id}
      showSummary={!summaryInRoutePanel}
      plans={plans}
      readings={
        session.photoEvidence?.id === analysis.evidenceId
          ? session.photoEvidence?.labels
          : undefined
      }
    />
  );
  const updateDestination = analysis &&
    destination.trim() &&
    destination.trim() !== activeDestination && (
      <button
        className="primary full-width sheet-pill-btn"
        disabled={busy}
        onClick={() => setActiveDestination(destination.trim())}
      >
        Get Directions to {destination.trim()}
      </button>
    );
  const editInputs = analysis ? (
    <details key={analysis.requestId} className="journey-inputs" open={!directionsMode}>
      <summary>Edit photo or destination</summary>
      {photoInput}
      {updateDestination}
    </details>
  ) : undefined;

  return (
    <div className={`app-shell visitor-shell${guidedMode ? ' guided-active' : ''}`}>
      {showAppHeader && (
        <header className="header">
          <a
            className="brand"
            href="#"
            onClick={(event) => {
              event.preventDefault();
            }}
          >
            <span className="brand-mark">
              <Compass size={22} strokeWidth={1.8} />
            </span>
            <span className="brand-name">
              Directionally
              <wbr />
              Unchallenged
            </span>
            <span className="brand-dot">.</span>
          </a>
          <div className="header-end">
            <button
              className="icon-button info-circle-btn"
              aria-label="Coverage & privacy"
              onClick={() => setAboutOpen(true)}
            >
              <Info size={19} />
            </button>
          </div>
        </header>
      )}
      <main className={guidedMode ? 'main-guided' : 'main-flow'}>
        {!guidedMode && !data.liveAvailable && (
          <div className="setup-notice" role="note">
            <ShieldCheck size={19} />
            <div>
              <strong>{provider.label} setup required</strong>
              <p>
                {data.setupNotice ??
                  `Photo analysis needs a ${provider.label} key configured on the server. Add your key and restart the app.`}
              </p>
            </div>
          </div>
        )}
        {!guidedMode && error && (
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
          {!guidedMode && data.liveAvailable && !data.photoLocalizationAvailable && (
            <p className="setup-notice" role="note">
              Floor-plan images are not ready on this server. Restart after preparing the source
              plans.
            </p>
          )}
          {!guidedMode && data.liveAvailable && !data.gpsTestMode && !data.locationCatalogue && (
            <p className="setup-notice" role="note">
              GPS building data is unavailable on this server. Reload after restoring the campus
              location catalogue to get directions.
            </p>
          )}
          {directionsMode ? (
            routeCandidate ? (
              <JourneyPanel
                key={JSON.stringify([
                  session.id,
                  routeCandidate.id,
                  activeDestination,
                  preferElevators,
                ])}
                sessionId={session.id}
                revision={session.revision}
                candidate={routeCandidate}
                destination={activeDestination}
                preferElevators={preferElevators}
                plans={data.visualPlans}
                locationCatalogue={data.locationCatalogue}
                gpsTestMode={data.gpsTestMode}
                locationEvidence={photoResults}
                editInputs={editInputs}
                busy={busy}
                onGuidedChange={setGuidedMode}
                onStartOver={startOver}
                onTryAnotherPhoto={() => {
                  setShowPhotoResults(false);
                  setFlowStep('photo');
                }}
              />
            ) : (
              <>
                <section className="journey-panel">
                  <h2>
                    {analysis?.gpsStatus === 'building-only'
                      ? 'Starting building only'
                      : 'Couldn’t find your starting point'}
                  </h2>
                  <p>
                    {analysis?.method === 'photo-label-retrieval'
                      ? analysis.summary
                      : 'Try another photo showing a nearby room sign, doorway, or hallway junction.'}
                  </p>
                  <button
                    className="primary full-width sheet-pill-btn"
                    onClick={() => {
                      setShowPhotoResults(false);
                      setFlowStep('photo');
                    }}
                  >
                    Try another photo
                  </button>
                </section>
                <div className="overview-utilities">
                  {editInputs}
                  {analysis && (
                    <details className="journey-evidence">
                      <summary>Location evidence</summary>
                      {photoResults}
                    </details>
                  )}
                  <div className="overview-footer-actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={startOver}
                    >
                      <RotateCcw size={15} />
                      Start over
                    </button>
                  </div>
                </div>
              </>
            )
          ) : (
            <>
              {!analysis && photoInput}
              {analysis && (
                <div className="analysis-edit-view">
                  {editInputs}
                  {photoResults}
                  <div className="overview-footer-actions">
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={startOver}
                    >
                      <RotateCcw size={15} />
                      Clear
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
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
                Visitor wayfinding is limited to SE12, SW03, SW05 and SW01. It uses official source
                labels and walking areas compiled from the BCIT Burnaby plans.
              </p>
              <div className="about-status-row">
                <span
                  className={`provider-status ${data.liveAvailable ? 'live' : ''}`}
                  data-testid="provider-status"
                >
                  <span className="status-dot" />
                  {data.liveAvailable ? `${provider.label} ready` : 'Setup required'}
                </span>
              </div>
              <div className="about-section">
                <h3>What you can do</h3>
                <p>
                  Take or upload a photo of a nearby sign, enter a destination, and tap Get
                  Directions. The app reads the photo once, uses GPS to narrow the building when
                  required, matches the sign to a floor and starting area, and calculates a route.
                </p>
              </div>
              <div className="about-section">
                <h3>Location updates</h3>
                <p>
                  GPS cannot identify floors. The route step selects the floor map, and a location
                  dot appears only where that plan has a geographic alignment. Indoor GPS accuracy
                  is limited.
                </p>
              </div>
              <div className="about-section">
                <h3>Your data stays transient</h3>
                <p>
                  Get Directions sends the photo and detail views to {provider.recipient} for label
                  and feature extraction. The app uses source records for location and routing.
                  Photo bytes are discarded after processing. In production, GPS is required; the
                  provider receives matching building IDs as context, and the app receives those
                  IDs and reading metadata while raw coordinates stay in this tab. Local testing
                  can disable GPS with GPS_TEST_MODE=true. Hosted session results are
                  encrypted and expire after 30 minutes. {provider.dataUse}
                </p>
              </div>
              <p className="about-credit">
                A COMP 4989 project · Independent student prototype
              </p>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
