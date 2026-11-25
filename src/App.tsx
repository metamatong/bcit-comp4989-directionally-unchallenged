import { aiProviderDetails } from './ai-provider';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  createRequestId,
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
import { useLocationPrewarm, usePhotoDeviceLocation } from './location/use-device-location';
import { useHeadingPrewarm } from './location/use-heading-tracker';
import {
  getMotionPermissionState,
  getOrientationPermissionState,
  requestMotionPermission,
} from './location/browser-motion';
import { gpsBuildingHint } from './location/building-hint';
import type { GpsBuildingHint } from './location/types';
import './wayfinding.css';
import type { Bootstrap, Session } from './types';

function journeyKeyFor(session: Session | undefined, destination: string, preferElevators: boolean) {
  if (!session?.campusLocation || !destination) return null;
  return JSON.stringify([session.id, session.campusLocation.id, destination, preferElevators]);
}

export default function App() {
  const photoDevice = usePhotoDeviceLocation();
  const [data, setData] = useState<Bootstrap>();
  const [session, setSession] = useState<Session>();
  const [aboutOpen, setAboutOpen] = useState(false);
  const [queryingPhoto, setQueryingPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [readStatus, setReadStatus] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [preparedPhoto, setPreparedPhoto] = useState<PreparedPhoto | null>(null);
  const [showPhotoResults, setShowPhotoResults] = useState(false);
  const [gpsFallbackUsed, setGpsFallbackUsed] = useState(false);
  const [flowStep, setFlowStep] = useState<'photo' | 'destination'>('photo');
  const [destination, setDestination] = useState('');
  const [preferElevators, setPreferElevators] = useState(false);
  const [activeDestination, setActiveDestination] = useState('');
  const [guidedMode, setGuidedMode] = useState(false);
  const [pendingPrewarmKey, setPendingPrewarmKey] = useState<string | null>(null);
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
    setQueryingPhoto(false);
    evidenceGate.current.cancel();
    photoAbort.current?.abort();
    setPreparedPhoto(null);
    setPendingPrewarmKey(null);
    evidenceForPhoto.current = null;
    setReadStatus('');
    setPhotoError('');
    setGpsFallbackUsed(false);
    setReading(false);
  }
  function removePhoto() {
    discardPhoto();
    setShowPhotoResults(false);
    setGpsFallbackUsed(false);
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
        requestId: createRequestId(),
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
    setGpsFallbackUsed(false);
    setActiveDestination('');
    setFlowStep('photo');
    setGuidedMode(false);
    setPendingPrewarmKey(null);
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
  function promptMotionOnGesture() {
    if (
      getMotionPermissionState() !== 'unknown' &&
      getOrientationPermissionState() !== 'unknown'
    )
      return;
    void requestMotionPermission();
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
    // Request iOS motion & orientation permission synchronously on the Get Directions gesture
    // so orientation pre-warming can start during analysis and the cone appears automatically on Step 1.
    promptMotionOnGesture();
    const generation = evidenceGate.current.next();
    const controller = new AbortController();
    photoAbort.current = controller;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setShowPhotoResults(false);
    setGpsFallbackUsed(false);
    setPhotoError('');
    const submittedDestination = destination.trim();
    setPendingPrewarmKey(null);
    setActiveDestination(submittedDestination);
    setReadStatus(
      !data.locationCatalogue
        ? 'Finding your starting point from the photo…'
        : 'Requesting GPS and finding your starting point…',
    );
    // Request fresh GPS by default, falling back to photo-only matching when GPS is unavailable.
    async function captureGpsHint(): Promise<{ hint?: GpsBuildingHint; fallback: boolean }> {
      if (!data!.locationCatalogue) return { fallback: true };
      try {
        const reading = await photoDevice.capture();
        controller.signal.throwIfAborted();
        return { hint: gpsBuildingHint(reading.reading, data!.locationCatalogue), fallback: false };
      } catch (gpsFailure) {
        controller.signal.throwIfAborted();
        if (!evidenceGate.current.isCurrent(generation)) throw gpsFailure;
        return { fallback: true };
      }
    }
    let stage: 'evidence' | 'location' = 'evidence';
    try {
      stage = 'location';
      const initialGps = await captureGpsHint();
      let gps = initialGps.hint;
      let fallbackUsed = initialGps.fallback;
      setReadStatus(
        fallbackUsed ? 'GPS unavailable — reading your photo…' : 'Reading your photo…',
      );
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
          setReadStatus(
            fallbackUsed ? 'GPS unavailable — reading your photo…' : 'Reading your photo…',
          );
          const contextKey = JSON.stringify(gps ? [gps.buildings, gps.sourceSha256] : null);
          const cached = evidenceForPhoto.current;
          if (!(
            cached?.photo === preparedPhoto &&
            cached.contextKey === contextKey &&
            latest.photoEvidence?.id === cached.id &&
            Date.parse(latest.photoEvidence.expiresAt) > Date.now()
          )) {
            setQueryingPhoto(true);
            latest = await request<Session>(
              `/api/sessions/${active.id}/photo/evidence`,
              {
                ...media,
                ...(gps ? { gps } : {}),
                requestId: createRequestId(),
                revision: active.revision,
              },
              {
                timeoutMs: PHOTO_STAGE_TIMEOUT_MS.evidence + PHOTO_RESPONSE_GRACE_MS,
                signal: controller.signal,
              },
            );
            setQueryingPhoto(false);
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
          if (gps && Date.now() - gps.capturedAt > 20000) {
            setReadStatus('Refreshing GPS and matching your photo…');
            const refreshed = await captureGpsHint();
            // If refresh fails, omit stale GPS metadata; the server retains Stage 1's validated building scope.
            gps = refreshed.hint;
          }
          setReadStatus('Matching your photo to the floor plans…');
          return request<Session>(
            `/api/sessions/${active.id}/photo/location`,
            {
              requestId: createRequestId(),
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
      setPendingPrewarmKey(journeyKeyFor(result, submittedDestination, preferElevators));
      evidenceForPhoto.current = null;
      setGpsFallbackUsed(fallbackUsed);
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
      if (photoAbort.current === controller) {
        photoAbort.current = null;
        setQueryingPhoto(false);
      }
    }
  }
  const analysis = showPhotoResults ? session?.campusAnalysis : null;
  const region = analysis ? session?.campusLocation : null;
  const routeCandidate = region ?? undefined;
  const directionsMode = Boolean(analysis && activeDestination);
  const isDestinationScreen = !analysis && !!preparedPhoto && flowStep === 'destination';
  const journeyKey = directionsMode
    ? journeyKeyFor(session, activeDestination, preferElevators)
    : null;
  const handleNavigationSettled = useCallback(() => {
    setPendingPrewarmKey((pending) => (pending === journeyKey ? null : pending));
  }, [journeyKey]);
  const shouldPrewarmSensors =
    Boolean(data?.locationCatalogue) &&
    (isDestinationScreen || (journeyKey !== null && journeyKey === pendingPrewarmKey));
  useHeadingPrewarm(shouldPrewarmSensors);
  useLocationPrewarm(shouldPrewarmSensors);

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
  const photoReady = data.liveAvailable && data.photoLocalizationAvailable;
  const provider = aiProviderDetails(data.provider);
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
        setPendingPrewarmKey(null);
      }}
      canUsePhotoResult={!!analysis?.candidates.length}
      locationRequirement={<PhotoDeviceRequirement />}
      onDestinationChange={(value) => {
        setDestination(value);
        setActiveDestination('');
        setPendingPrewarmKey(null);
      }}
      photo={preparedPhoto}
      ready={photoReady}
      reading={reading}
      busy={busy}
      queryingPhoto={queryingPhoto}
      submissionReading={photoDevice.snapshot?.reading}
      status={readStatus}
      error={photoError}
      onPhoto={(file) => void readPhoto(file)}
      onNext={() => {
        promptMotionOnGesture();
        setFlowStep('destination');
      }}
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
      gpsFallbackUsed={gpsFallbackUsed}
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
        onClick={() => {
          promptMotionOnGesture();
          const submittedDestination = destination.trim();
          setActiveDestination(submittedDestination);
          setPendingPrewarmKey(journeyKeyFor(session, submittedDestination, preferElevators));
        }}
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
          {!guidedMode && data.liveAvailable && !data.locationCatalogue && (
            <p className="setup-notice" role="note">
              GPS building data is unavailable on this server. Directions will match your starting
              place from photo signs only.
            </p>
          )}
          {directionsMode ? (
            routeCandidate ? (
              <JourneyPanel
                key={journeyKey}
                sessionId={session.id}
                revision={session.revision}
                candidate={routeCandidate}
                destination={activeDestination}
                preferElevators={preferElevators}
                plans={data.visualPlans}
                locationCatalogue={data.locationCatalogue}
                locationEvidence={photoResults}
                editInputs={editInputs}
                busy={busy}
                onGuidedChange={setGuidedMode}
                onNavigationSettled={handleNavigationSettled}
                onStartOver={startOver}
                onTryAnotherPhoto={() => {
                  setShowPhotoResults(false);
                  setPendingPrewarmKey(null);
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
                      setPendingPrewarmKey(null);
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
                  available, matches the sign to a floor and starting area, and calculates a route.
                </p>
              </div>
              <div className="about-section">
                <h3>Location updates</h3>
                <p>
                  GPS cannot identify floors. The route step selects the floor map, and a location
                  dot appears only where that plan has a geographic alignment. When device motion
                  sensors are available and permitted, they run locally in this tab to steady
                  indoor tracking and are never transmitted or stored. Indoor accuracy remains
                  unmeasured.
                </p>
              </div>
              <div className="about-section">
                <h3>Your data stays transient</h3>
                <p>
                  Get Directions sends the photo and detail views to {provider.recipient} for label
                  and feature extraction. The app uses source records for location and routing.
                  Photo bytes are discarded after processing. GPS is requested automatically by
                  default; when available, the provider receives matching building IDs as context,
                  and the app receives those IDs and reading metadata while raw coordinates stay in
                  this tab. If GPS is unavailable, starting-place matching falls back to photo
                  signs only. Hosted session results are encrypted and expire after 30 minutes.{' '}
                  {provider.dataUse}
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
