import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Camera,
  Compass,
  Info,
  LoaderCircle,
  LocateFixed,
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
import { CampusLocationResults, PhotoEmptyState } from './components/CampusLocationResults';
import type { Bootstrap, Session } from './types';

type Modal = 'location' | 'about' | null;

export default function App() {
  const [data, setData] = useState<Bootstrap>();
  const [session, setSession] = useState<Session>();
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [readStatus, setReadStatus] = useState('');
  const [preparedPhoto, setPreparedPhoto] = useState<PreparedPhoto | null>(null);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [showPhotoResults, setShowPhotoResults] = useState(false);
  const photoAbort = useRef<AbortController | null>(null);
  const evidenceForPhoto = useRef<{ photo: PreparedPhoto; id: string } | null>(null);
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
    evidenceForPhoto.current = null;
    setPhotoConsent(false);
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
    evidenceForPhoto.current = null;
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
    setReadStatus('Reading room labels from your photo and detail views…');
    try {
      const media = {
        consent: true,
        image: { mimeType: preparedPhoto.mimeType, data: preparedPhoto.data },
        detailCrops: preparedPhoto.detailCrops,
      };
      let latest = current;
      const cached = evidenceForPhoto.current;
      if (!(
        cached?.photo === preparedPhoto &&
        latest.photoEvidence?.id === cached.id &&
        Date.parse(latest.photoEvidence.expiresAt) > Date.now()
      )) {
        latest = await request<Session>(
          `/api/sessions/${current.id}/photo/evidence`,
          {
            ...media,
            requestId: crypto.randomUUID(),
            revision: current.revision,
          },
          { timeoutMs: 55000, signal: controller.signal },
        );
        if (!evidenceGate.current.isCurrent(generation)) return;
        updateSession(latest);
        if (!latest.photoEvidence)
          throw new Error('Photo reading did not return evidence. Try again.');
        evidenceForPhoto.current = { photo: preparedPhoto, id: latest.photoEvidence.id };
      }
      const evidence = latest.photoEvidence;
      if (!evidence) throw new Error('Read this photo again before comparing plans.');
      const labels = evidence.labels
        .filter((label) => label.clarity === 'clear')
        .map((label) => label.text);
      setReadStatus(
        labels.length
          ? `Read room label${labels.length === 1 ? '' : 's'} ${[...new Set(labels)].join(', ')}. Comparing the photo with matching floor plans…`
          : 'No clear room label found. Comparing the scene with the floor plans…',
      );
      const result = await request<Session>(
        `/api/sessions/${current.id}/photo`,
        {
          ...media,
          requestId: crypto.randomUUID(),
          revision: latest.revision,
          evidenceId: evidence.id,
        },
        { timeoutMs: 70000, signal: controller.signal },
      );
      if (!evidenceGate.current.isCurrent(generation)) return;
      updateSession(result);
      evidenceForPhoto.current = null;
      setShowPhotoResults(true);
      setReadStatus('Comparison complete.');
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
    }
  }

  if (!data || !session)
    return (
      <main className="loading-page">
        <Compass size={42} />
        <h1>CampusLens</h1>
        <p>{error || 'Loading…'}</p>
        {error && (
          <button className="primary" onClick={() => location.reload()}>
            Try again
          </button>
        )}
      </main>
    );
  const plans = data.visualPlans.filter((plan) =>
    session.campusAnalysis?.candidates.some((candidate) => candidate.planId === plan.id),
  );
  const photoReady = data.liveAvailable && data.photoLocalizationAvailable;
  return (
    <div className="app-shell">
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
          campus<span className="brand-light">lens</span>
          <span className="brand-dot">.</span>
        </a>
        <div className="header-end">
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
        <h1 className="visually-hidden">CampusLens photo location</h1>
        {!data.liveAvailable && (
          <div className="setup-notice" role="note">
            <ShieldCheck size={21} />
            <div>
              <strong>Gemini setup required</strong>
              <p>
                {data.setupNotice ??
                  'Photo analysis needs a Gemini key configured on the server. Add your key and restart the app.'}
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
        <section className="workspace">
          {session.campusAnalysis ? (
            <>
              <div className="result-actions">
                <button className="secondary" onClick={() => setModal('location')}>
                  <Camera size={17} />
                  New photo
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    closeModal();
                    void send({ type: 'reset' });
                  }}
                >
                  <RotateCcw size={15} />
                  Clear
                </button>
              </div>
              <CampusLocationResults
                analysis={session.campusAnalysis}
                plans={plans}
                selectedId={session.campusLocation?.id}
                onConfirm={(id) => void confirmCampus(id)}
                busy={busy}
              />
            </>
          ) : (
            <PhotoEmptyState onUpload={() => setModal('location')} />
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
              <h2>Analyze a photo</h2>
              <p>Compare it with official BCIT Burnaby floor plans.</p>
              {!photoReady && (
                <p className="setup-notice">
                  {!data.liveAvailable
                    ? (data.setupNotice ??
                      'Photo analysis is unavailable until Gemini is configured on the server.')
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
                <label className="checkbox-label photo-consent">
                  <input
                    type="checkbox"
                    checked={photoConsent}
                    disabled={busy || !preparedPhoto || !photoReady}
                    onChange={(event) => setPhotoConsent(event.target.checked)}
                  />
                  Send this photo and its detail views to Google Gemini to read labels and compare
                  floor plans. Free-tier inputs may be used to improve Google products.
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
                <ShieldCheck size={13} /> Resized on your device. CampusLens does not save photos or
                location history.
              </p>
            </>
          )}
          {modal === 'about' && (
            <>
              <span className="modal-icon">
                <Compass size={25} />
              </span>
              <h2>About CampusLens</h2>
              <p>
                CampusLens compares photographs with {data.coverage.floorPlans} official BCIT
                Burnaby floor plans across {data.coverage.buildings.length} buildings. Relevant
                plans appear with the location result.
              </p>
              <div className="about-section">
                <h3>What you can do</h3>
                <p>
                  Upload or capture a photo, consent to Gemini analysis, and confirm the best
                  source-linked estimate only if it matches your surroundings.
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
                  Only the explicitly submitted photo goes to Google. No accounts or saved media.
                  Session results expire after 30 minutes; reloading starts a new session. Clear
                  analysis removes the current result. Google’s free-tier data handling applies.
                </p>
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
