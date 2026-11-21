import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  LoaderCircle,
  MapPin,
  Search,
  Upload,
  X,
} from 'lucide-react';
import type { PreparedPhoto } from '../photo';

type PhotoLocationInputProps = {
  step?: 'photo' | 'destination';
  photo: PreparedPhoto | null;
  ready: boolean;
  reading: boolean;
  busy: boolean;
  status: string;
  error?: string;
  destination: string;
  preferElevators?: boolean;
  onPreferElevatorsChange?: (value: boolean) => void;
  canUsePhotoResult?: boolean;
  locationRequirement?: ReactNode;
  onDestinationChange: (value: string) => void;
  onPhoto: (file?: File) => void;
  onNext?: () => void;
  onBack?: () => void;
  onAnalyze: () => void;
  onDiscard: () => void;
};

function ElapsedTime() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  return seconds >= 5 ? (
    <span className="photo-elapsed" aria-hidden="true">
      {seconds}s elapsed
    </span>
  ) : null;
}

export function PhotoLocationInput({
  step = 'photo',
  photo,
  ready,
  reading,
  busy,
  status,
  error,
  destination,
  preferElevators = false,
  onPreferElevatorsChange,
  canUsePhotoResult = false,
  locationRequirement,
  onDestinationChange,
  onPhoto,
  onNext,
  onBack,
  onAnalyze,
  onDiscard,
}: PhotoLocationInputProps) {
  const upload = useRef<HTMLInputElement>(null);
  const phonePhoto = useRef<HTMLInputElement>(null);
  const canSubmitPhoto = !!photo && ready && !reading && !busy && !!destination.trim();

  const hiddenInputs = (
    <>
      <input
        ref={upload}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="visually-hidden"
        aria-label="Upload campus photo"
        disabled={reading || busy}
        onChange={(event) => {
          onPhoto(event.target.files?.[0]);
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
        disabled={reading || busy}
        onChange={(event) => {
          onPhoto(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </>
  );

  // Compact inline edit form when modifying destination inside Route Overview.
  if (canUsePhotoResult) {
    return (
      <section className="destination-inline" aria-label="Edit destination">
        {hiddenInputs}
        <form
          aria-label="Find a route"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <div className="destination-field">
            <label htmlFor="trip-destination" className="visually-hidden">
              Destination
            </label>
            <div className="destination-input-pill">
              <MapPin size={19} aria-hidden="true" />
              <input
                id="trip-destination"
                type="text"
                maxLength={150}
                value={destination}
                disabled={busy}
                autoComplete="off"
                placeholder="e.g. SW03 2605"
                onChange={(event) => onDestinationChange(event.target.value)}
              />
            </div>
          </div>
          {!destination.trim() && (
            <button
              type="button"
              className="text-button map-point-link"
              disabled={busy}
              onClick={() => onDestinationChange('Map point')}
            >
              Choose a map point
            </button>
          )}
          <label className="switch-card">
            <span className="switch-label">Prefer elevators</span>
            <span className="pill-switch">
              <input
                type="checkbox"
                role="switch"
                checked={preferElevators}
                disabled={busy}
                onChange={(event) => onPreferElevatorsChange?.(event.target.checked)}
              />
              <span className="pill-switch-track" aria-hidden="true" />
            </span>
          </label>
        </form>
        <button
          type="button"
          className="text-button back-step"
          disabled={busy}
          onClick={() => onBack?.()}
        >
          <Camera size={16} /> Use a different photo
        </button>
      </section>
    );
  }

  if (step === 'photo') {
    return (
      <section className="photo-stage" aria-labelledby="location-heading">
        {hiddenInputs}
        <div className="photo-stage-canvas">
          {photo ? (
            <div className="photo-preview-card">
              <img
                className="evidence-photo"
                src={photo.preview}
                alt="Selected campus location"
              />
              <button
                type="button"
                className="photo-remove-fab"
                aria-label="Remove photo"
                disabled={busy}
                onClick={onDiscard}
              >
                <X size={18} />
              </button>
              <h1 id="location-heading" className="visually-hidden">
                Snap a nearby room sign
              </h1>
            </div>
          ) : (
            <div className="viewfinder-card">
              <div className="viewfinder-icon" aria-hidden="true">
                {reading ? <LoaderCircle className="spin" size={44} /> : <Camera size={44} strokeWidth={1.6} />}
              </div>
              <h1 id="location-heading">Snap a nearby room sign</h1>
              <span className="scope-pill">SE12 · SW03 · SW05 · SW01</span>
            </div>
          )}

          {error && (
            <p className="photo-failure" role="alert">
              {error}
            </p>
          )}
          {status && !error && (
            <p className="photo-status" role="status">
              {reading && <LoaderCircle className="spin" size={15} />}
              {status}
            </p>
          )}
        </div>

        <div className="bottom-sheet">
          {photo ? (
            <>
              <button
                type="button"
                className="primary full-width sheet-pill-btn"
                disabled={reading || busy}
                onClick={() => onNext?.()}
              >
                Next <ArrowRight size={18} />
              </button>
              <div className="sheet-secondary-row">
                <button
                  type="button"
                  className="secondary sheet-pill-btn"
                  disabled={reading || busy}
                  onClick={() => phonePhoto.current?.click()}
                >
                  <Camera size={18} />
                  Take a photo
                </button>
                <button
                  type="button"
                  className="secondary sheet-pill-btn"
                  disabled={reading || busy}
                  onClick={() => upload.current?.click()}
                >
                  <Upload size={18} />
                  Upload photo
                </button>
              </div>
              <button type="button" className="text-button sheet-text-action" onClick={onDiscard}>
                <X size={15} />
                Remove photo
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="primary full-width sheet-pill-btn"
                disabled={reading || busy}
                onClick={() => phonePhoto.current?.click()}
              >
                <Camera size={19} />
                Take a photo
              </button>
              <button
                type="button"
                className="secondary full-width sheet-pill-btn"
                disabled={reading || busy}
                onClick={() => upload.current?.click()}
              >
                <Upload size={19} />
                Upload photo
              </button>
              {reading && (
                <button type="button" className="text-button sheet-text-action" onClick={onDiscard}>
                  <X size={15} />
                  Cancel photo preparation
                </button>
              )}
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="destination-stage" aria-labelledby="location-heading">
      {hiddenInputs}
      <form
        className="destination-form"
        aria-label="Find a route"
        aria-busy={busy}
        onSubmit={(event) => {
          event.preventDefault();
          onAnalyze();
        }}
      >
        <div className="destination-top-bar">
          <button
            type="button"
            className="icon-button destination-back-btn"
            aria-label="Back to photo"
            disabled={busy}
            onClick={() => onBack?.()}
          >
            <ArrowLeft size={21} />
          </button>
          {photo && (
            <div className="photo-step-summary">
              <img src={photo.preview} alt="Selected starting location" />
              <span>Photo added</span>
              <button
                type="button"
                className="text-button photo-change-link"
                onClick={() => (busy ? onDiscard() : onBack?.())}
              >
                {busy ? 'Cancel analysis' : 'Change'}
              </button>
            </div>
          )}
        </div>

        <div className="destination-body">
          <h1 id="location-heading">Where are you headed?</h1>

          <div className="destination-field">
            <label htmlFor="trip-destination" className="visually-hidden">
              Destination
            </label>
            <div className="destination-input-pill">
              <MapPin size={20} aria-hidden="true" />
              <input
                id="trip-destination"
                type="text"
                maxLength={150}
                value={destination}
                disabled={busy}
                autoComplete="off"
                autoFocus
                placeholder="e.g. SW03 2605"
                onChange={(event) => onDestinationChange(event.target.value)}
              />
            </div>
          </div>

          <label className="switch-card">
            <span className="switch-label">Prefer elevators</span>
            <span className="pill-switch">
              <input
                type="checkbox"
                role="switch"
                checked={preferElevators}
                disabled={busy}
                onChange={(event) => onPreferElevatorsChange?.(event.target.checked)}
              />
              <span className="pill-switch-track" aria-hidden="true" />
            </span>
          </label>

          {!destination.trim() && (
            <button
              type="button"
              className="text-button map-point-link"
              disabled={busy}
              onClick={() => onDestinationChange('Map point')}
            >
              Choose a map point
            </button>
          )}

          {error ? (
            <p className="photo-failure" role="alert">
              {error}
            </p>
          ) : (
            status && (
              <p className="photo-status" role="status">
                {busy && <LoaderCircle className="spin" size={15} />}
                {status}
                {busy && <ElapsedTime />}
              </p>
            )
          )}
        </div>

        <div className="bottom-sheet destination-sheet">
          <span className="sheet-handle" aria-hidden="true" />
          <button
            type="submit"
            className="primary full-width sheet-pill-btn go-button"
            disabled={!canSubmitPhoto}
          >
            {busy ? <LoaderCircle className="spin" size={18} /> : <Search size={18} />}
            {busy ? 'Finding your route…' : error ? 'Try again' : 'Get Directions'}
          </button>
          {locationRequirement}
        </div>
      </form>
    </section>
  );
}
