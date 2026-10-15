import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Camera,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Info,
  LoaderCircle,
  LocateFixed,
  Map,
  MapPin,
  RotateCcw,
  Search,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import {
  bootstrap,
  createSession,
  request,
  ApiError,
  RequestGate,
  clearLegacyModePreference,
} from './api';
import { preparePhoto, type PreparedPhoto } from './photo';
import { CameraCapture } from './components/CameraCapture';
import { CampusLibrary } from './components/CampusLibrary';
import { CampusLocationResults, CampusPhotoWelcome } from './components/CampusLocationResults';
import type { Bootstrap, Session } from './types';

type View = 'plans' | 'library' | 'camera';
type Modal = 'location' | 'about' | null;

export default function App() {
  const [data, setData] = useState<Bootstrap>();
  const [session, setSession] = useState<Session>();
  const [view, setView] = useState<View>('plans');
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [description, setDescription] = useState('');
  const [reading, setReading] = useState(false);
  const [readStatus, setReadStatus] = useState('');
  const [activityOpen, setActivityOpen] = useState(false);
  const [preparedPhoto, setPreparedPhoto] = useState<PreparedPhoto | null>(null);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [buildingHint, setBuildingHint] = useState('');
  const [showPhotoResults, setShowPhotoResults] = useState(false);
  const photoAbort = useRef<AbortController | null>(null);
  const sessionRef = useRef<Session | undefined>(undefined);
  const busyRef = useRef(false);
  const evidenceGate = useRef(new RequestGate());
  const upload = useRef<HTMLInputElement>(null);
  const phonePhoto = useRef<HTMLInputElement>(null);
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
    if (modal) dialog.current?.showModal();
    else dialog.current?.close();
  }, [modal]);

  function closeModal() {
    evidenceGate.current.cancel();
    photoAbort.current?.abort();
    setPreparedPhoto(null);
    setPhotoConsent(false);
    setDescription('');
    setReadStatus('');
    setReading(false);
    setShowPhotoResults(false);
    setModal(null);
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
    setPhotoConsent(false);
    setShowPhotoResults(false);
    setReading(true);
    setModal('location');
    setError('');
    setReadStatus('Preparing your photo locally…');
    try {
      const prepared = await preparePhoto(file);
      if (!evidenceGate.current.isCurrent(generation)) return;
      setPreparedPhoto(prepared);
      setDescription('');
      setReadStatus(
        'Photo ready. Choose Analyze to compare the image with real BCIT floor plans. No readable sign is required.',
      );
    } catch (failure) {
      if (evidenceGate.current.isCurrent(generation)) setReadStatus((failure as Error).message);
    } finally {
      if (evidenceGate.current.isCurrent(generation)) setReading(false);
    }
  }
  async function analyzePhoto() {
    const current = sessionRef.current;
    if (!current || !preparedPhoto || !photoConsent || !data?.liveAvailable || busyRef.current)
      return;
    const generation = evidenceGate.current.next();
    const controller = new AbortController();
    photoAbort.current = controller;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setShowPhotoResults(false);
    setReadStatus(
      'Comparing your photo with official floor-plan overviews, then inspecting plausible plans and their geometry. This can take up to a minute.',
    );
    try {
      const result = await request<Session>(
        `/api/sessions/${current.id}/photo`,
        {
          requestId: crypto.randomUUID(),
          revision: current.revision,
          consent: true,
          description,
          buildingHint: buildingHint || null,
          image: { mimeType: preparedPhoto.mimeType, data: preparedPhoto.data },
        },
        { timeoutMs: 70000, signal: controller.signal },
      );
      if (!evidenceGate.current.isCurrent(generation)) return;
      updateSession(result);
      setShowPhotoResults(true);
      setReadStatus(
        'Photo-to-floor-plan comparison completed. Review the evidence and any possible regions below.',
      );
    } catch (failure) {
      if (evidenceGate.current.isCurrent(generation)) {
        if (failure instanceof ApiError && failure.session) updateSession(failure.session);
        setError((failure as Error).message);
        setReadStatus(
          'The photo comparison could not finish. Your photo is ready for another attempt; no location was automatically applied.',
        );
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (photoAbort.current === controller) photoAbort.current = null;
    }
  }
  async function confirmCampus(candidateId: string) {
    if (await send({ type: 'confirm-campus-region', candidateId })) {
      closeModal();
      setView('plans');
    }
  }

  if (!data || !session)
    return (
      <main className="loading-page">
        <Compass size={42} />
        <h1>CampusLens</h1>
        <p>{error || 'Getting your campus companion ready…'}</p>
        {error && (
          <button className="primary" onClick={() => location.reload()}>
            Try again
          </button>
        )}
      </main>
    );
  const plans = data.visualPlans;
  const photoReady = data.liveAvailable && data.photoLocalizationAvailable;
  return (
    <div className="app-shell">
      <header className="header">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setView('plans');
          }}
        >
          <span className="brand-mark">
            <Compass size={25} strokeWidth={1.7} />
          </span>
          campus<span className="brand-light">lens</span>
          <span className="brand-dot">.</span>
        </a>
        <nav aria-label="Main navigation">
          <button className={view !== 'library' ? 'active' : ''} onClick={() => setView('plans')}>
            <Map size={17} />
            Find your way
          </button>
          <button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}>
            <BookOpen size={17} />
            Campus library
          </button>
        </nav>
        <div className="header-end">
          <span className="campus-label">
            <MapPin size={14} />
            BCIT Burnaby
          </span>
          <span
            className={`provider-status ${data.liveAvailable ? 'live' : ''}`}
            data-testid="provider-status"
          >
            <span className="status-dot" />
            {data.liveAvailable ? 'Gemini ready' : 'Setup required'}
          </span>
          <button
            className="icon-button"
            aria-label="About CampusLens"
            onClick={() => setModal('about')}
          >
            <Info size={19} />
          </button>
        </div>
      </header>
      <main>
        <div className="page-intro">
          <div>
            <p className="eyebrow">YOUR CAMPUS COMPANION</p>
            <h1>
              {view === 'library'
                ? 'A clearer picture of campus.'
                : view === 'camera'
                  ? 'A new perspective on campus.'
                  : 'Your next step, made simple.'}
            </h1>
            <p>
              {view === 'library'
                ? 'Official Burnaby floor plans, with sources you can inspect.'
                : 'Start with a photo. Find possible locations on real BCIT floor plans.'}
            </p>
          </div>
          <span className="project-label">
            <span className="tiny-grid">✦</span> CAMPUSLENS / MVP 01
          </span>
        </div>
        <div className="source-banner">
          <Info size={16} />
          <span>
            <strong>Official BCIT plans · AI location estimates.</strong> Review possible regions
            before confirming. Real walking routes are not yet verified.{' '}
            <button onClick={() => setView('library')}>
              Explore official plans <ArrowUpRight size={13} />
            </button>
          </span>
        </div>
        {!data.liveAvailable && (
          <div className="setup-notice" role="note">
            <ShieldCheck size={21} />
            <div>
              <strong>Gemini setup required</strong>
              <p>
                {data.setupNotice ??
                  'Photo analysis needs a Gemini key configured on the server. Add your key and restart the app.'}{' '}
                You can browse all official plans now.
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
        {view === 'camera' ? (
          <CameraCapture
            onBack={() => setView('plans')}
            onUpload={() => {
              setView('plans');
              setModal('location');
            }}
            onCapture={(file) => {
              setView('plans');
              void readPhoto(file);
            }}
            busy={busy || reading}
          />
        ) : view === 'library' ? (
          <CampusLibrary data={data} onError={setError} />
        ) : (
          <div className="workspace">
            <aside className="journey-panel">
              <div className="panel-heading">
                <span>
                  <LocateFixed size={19} />
                  Find your place
                </span>
                <span className="pill pale">BCIT PLANS</span>
              </div>
              <div className="journey-step">
                <div className={`step-number ${session.campusLocation ? 'complete' : ''}`}>
                  {session.campusLocation ? <Check size={14} /> : 1}
                </div>
                <div className="step-body">
                  <label className="field-label">Your location</label>
                  {session.campusLocation ? (
                    <button className="location-selected" onClick={() => setModal('location')}>
                      <span>
                        <strong>
                          {session.campusLocation.building} · Floor {session.campusLocation.floor}
                        </strong>
                        <small>Selected region · AI estimate, unverified</small>
                      </span>
                      <LocateFixed size={20} />
                    </button>
                  ) : (
                    <button className="find-location" onClick={() => setModal('location')}>
                      <LocateFixed size={19} />
                      <span>Find my location</span>
                      <ChevronRight size={16} />
                    </button>
                  )}
                  <p className="helper">
                    Upload a campus photo. Gemini examines the image alongside official plans and
                    geometry.
                  </p>
                </div>
              </div>
              <div className="campus-route-note">
                <h3>Start with a photo.</h3>
                <p>
                  Possible regions appear on the source plans for you to review. A photo estimate
                  cannot establish a safe walking route.
                </p>
                <button className="secondary full-width" onClick={() => setView('library')}>
                  Browse official plans
                  <ArrowUpRight size={15} />
                </button>
                <button className="secondary full-width" onClick={() => setView('camera')}>
                  <Camera size={17} />
                  Camera preview
                </button>
                {session.campusAnalysis && (
                  <button
                    className="text-button full-width"
                    disabled={busy}
                    onClick={() => {
                      closeModal();
                      void send({ type: 'reset' });
                    }}
                  >
                    <RotateCcw size={16} />
                    Clear analysis
                  </button>
                )}
              </div>
              <div className="privacy-note">
                <ShieldCheck size={17} />
                <span>Photos are sent only after your consent and selecting Analyze.</span>
              </div>
            </aside>
            <section className="map-panel">
              {session.campusAnalysis ? (
                <CampusLocationResults
                  analysis={session.campusAnalysis}
                  plans={plans}
                  selectedId={session.campusLocation?.id}
                  onConfirm={(id) => void confirmCampus(id)}
                  busy={busy}
                />
              ) : (
                <CampusPhotoWelcome
                  planCount={plans.length}
                  onUpload={() => setModal('location')}
                />
              )}
              <div className="status-note" role="status">
                <span className="status-dot" />
                {session.notice}
              </div>
            </section>
          </div>
        )}
        <section className="tools-section">
          <div className="tool-tabs">
            <button aria-expanded={activityOpen} onClick={() => setActivityOpen(!activityOpen)}>
              <Activity size={17} />
              Analysis activity
              <ChevronDown size={15} />
            </button>
          </div>
          {activityOpen && (
            <div className="activity-panel">
              <div className="section-heading">
                <div>
                  <h3>Observable actions</h3>
                  <p>
                    {session.agentStatus} · {session.providerCalls} provider calls
                  </p>
                </div>
                <span className="pill">No hidden reasoning</span>
              </div>
              {session.activity.length ? (
                session.activity
                  .slice()
                  .reverse()
                  .map((item) => (
                    <div className="activity-item" key={item.id}>
                      <span className="activity-icon">
                        <Check size={13} />
                      </span>
                      <div>
                        <strong>{item.tool.replaceAll('_', ' ')}</strong>
                        <p>{item.summary}</p>
                        {item.sourceRefs.length > 0 && (
                          <small>Evidence: {item.sourceRefs.join(', ')}</small>
                        )}
                      </div>
                      <time>
                        {new Date(item.at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </div>
                  ))
              ) : (
                <p className="helper">
                  Analyze a photo to see completed comparisons and source references here.
                </p>
              )}
            </div>
          )}
        </section>
      </main>
      <footer>
        <span>
          campuslens<span className="brand-dot">.</span>
          <small>A COMP 4989 project · Independent student prototype</small>
        </span>
        <button onClick={() => setModal('about')}>
          Coverage & privacy
          <ArrowUpRight size={14} />
        </button>
      </footer>
      <dialog
        ref={dialog}
        className="dialog"
        onCancel={(event) => {
          event.preventDefault();
          closeModal();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeModal();
        }}
      >
        <div className="dialog-content">
          <button
            className="dialog-close icon-button"
            aria-label="Close dialog"
            onClick={closeModal}
          >
            <X size={21} />
          </button>
          {modal === 'location' && (
            <>
              <span className="modal-icon">
                <LocateFixed size={25} />
              </span>
              <p className="eyebrow">FIRST, FIND YOUR BEARINGS</p>
              <h2>What can you see?</h2>
              <p>
                Upload a campus photo. Gemini compares the actual scene with official BCIT floor
                plans and geometry; readable signs are optional.
              </p>
              {!photoReady && (
                <p className="setup-notice">
                  {!data.liveAvailable
                    ? (data.setupNotice ??
                      'Photo analysis is unavailable until Gemini is configured on the server. The official plan library remains available.')
                    : 'Floor-plan images are not ready on this server. Restart after preparing the source plans.'}
                </p>
              )}
              <div className="photo-actions">
                <button
                  className="secondary"
                  disabled={reading || busy}
                  onClick={() => upload.current?.click()}
                >
                  <Upload size={18} />
                  Upload photo
                </button>
                <button
                  className="secondary"
                  disabled={reading || busy}
                  onClick={() => phonePhoto.current?.click()}
                >
                  <Camera size={18} />
                  Take a photo
                </button>
              </div>
              <input
                ref={upload}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="visually-hidden"
                aria-label="Upload campus photo"
                onChange={(event) => {
                  void readPhoto(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <input
                ref={phonePhoto}
                type="file"
                accept="image/*"
                capture="environment"
                className="visually-hidden"
                aria-label="Capture phone photo"
                onChange={(event) => {
                  void readPhoto(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              {preparedPhoto && (
                <img
                  className="evidence-photo"
                  src={preparedPhoto.preview}
                  alt="Uploaded location photo, awaiting analysis or confirmation"
                />
              )}
              {readStatus && (
                <p className="photo-status">
                  {reading && <LoaderCircle className="spin" size={15} />} {readStatus}
                </p>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void analyzePhoto();
                }}
              >
                <label className="field-label" htmlFor="location-description">
                  Optional context about your photo
                </label>
                <textarea
                  id="location-description"
                  rows={2}
                  maxLength={1000}
                  placeholder="Optional: anything else you know about the building or floor"
                  value={description}
                  disabled={busy}
                  onChange={(event) => setDescription(event.target.value)}
                />
                <label className="field-label" htmlFor="building-hint">
                  Building, if you know it (optional)
                </label>
                <select
                  id="building-hint"
                  value={buildingHint}
                  disabled={busy}
                  onChange={(event) => setBuildingHint(event.target.value)}
                >
                  <option value="">All prepared Burnaby floor plans</option>
                  {data.coverage.buildings.map((building) => (
                    <option key={building} value={building}>
                      {building}
                    </option>
                  ))}
                </select>
                <label className="checkbox-label photo-consent">
                  <input
                    type="checkbox"
                    checked={photoConsent}
                    disabled={busy || !preparedPhoto || !photoReady}
                    onChange={(event) => setPhotoConsent(event.target.checked)}
                  />
                  Send this photo and optional description to Google Gemini for comparison with
                  official BCIT plans. Free-tier inputs may be used to improve Google products.
                </label>
                <button
                  className="primary full-width"
                  disabled={busy || reading || !preparedPhoto || !photoConsent || !photoReady}
                >
                  {busy ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}Analyze
                  photo against BCIT plans
                </button>
              </form>
              {error && (
                <p role="alert" className="inline-error">
                  {error}
                </p>
              )}
              {showPhotoResults && session.campusAnalysis && (
                <CampusLocationResults
                  analysis={session.campusAnalysis}
                  plans={plans}
                  selectedId={session.campusLocation?.id}
                  onConfirm={(id) => void confirmCampus(id)}
                  busy={busy}
                />
              )}
              <p className="helper">
                <ShieldCheck size={13} /> Photos are resized locally, then sent transiently to the
                server and Google only after you choose Analyze. The app does not save them to disk
                or location history.
              </p>
            </>
          )}
          {modal === 'about' && (
            <>
              <span className="modal-icon">
                <Compass size={25} />
              </span>
              <p className="eyebrow">REAL CAMPUS SOURCES</p>
              <h2>A prototype with clear boundaries.</h2>
              <p>
                CampusLens compares photographs with {data.coverage.floorPlans} official BCIT
                Burnaby floor plans across {data.coverage.buildings.length} buildings. The library
                also includes the campus map.
              </p>
              <div className="about-section">
                <h3>What you can do</h3>
                <p>
                  Upload or capture a photo, consent to Gemini analysis, inspect possible regions on
                  the source plans, and confirm a hypothesis that matches your surroundings.
                </p>
              </div>
              <div className="about-section">
                <h3>What still needs validation</h3>
                <p>
                  Location accuracy, corridor connections, floor alignment, travel times and
                  accessibility remain unverified. Floor plans are not camera-view training data.
                  Walking directions are not available.
                </p>
              </div>
              <div className="about-section">
                <h3>Your data stays transient</h3>
                <p>
                  Only an explicitly submitted photo and optional description go to Google. No
                  accounts or saved media. Session results expire after 30 minutes; reloading starts
                  a new session. Clear analysis removes the current result. Google’s free-tier data
                  handling applies.
                </p>
              </div>
              <a
                className="text-button"
                href="https://www.bcit.ca/facilities/campus-maps/floor-plans/"
                target="_blank"
                rel="noreferrer"
              >
                Official BCIT floor-plan source
                <ArrowUpRight size={15} />
              </a>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
