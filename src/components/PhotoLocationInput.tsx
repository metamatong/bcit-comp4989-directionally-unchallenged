import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  LoaderCircle,
  MapPin,
  Search,
  ShieldCheck,
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
  canUsePhotoResult?: boolean;
  deviceOption?: ReactNode;
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
  canUsePhotoResult = false,
  deviceOption,
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

  return (
    <section className="photo-location-input" aria-labelledby="location-heading">
      <div className="flow-progress" role="group" aria-label="Route setup progress">
        <span className={step === 'photo' ? 'current' : 'complete'}>1&nbsp; Photo</span>
        <span aria-hidden="true">·</span>
        <span className={step === 'destination' ? 'current' : ''}>2&nbsp; Destination</span>
      </div>
      <h1 id="location-heading">
        {step === 'photo' ? 'Take a photo of where you are' : 'Where do you want to go?'}
      </h1>

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

      {step === 'photo' ? (
        <>
          <div className="photo-actions">
            <button
              type="button"
              className="secondary"
              disabled={reading || busy}
              onClick={() => upload.current?.click()}
            >
              <Upload size={20} />
              Upload photo
            </button>
            <button
              type="button"
              className="secondary"
              disabled={reading || busy}
              onClick={() => phonePhoto.current?.click()}
            >
              <Camera size={20} />
              Take a photo
            </button>
          </div>
          {photo && (
            <img className="evidence-photo" src={photo.preview} alt="Selected campus location" />
          )}
          {(photo || reading) && (
            <div className="photo-controls">
              <button type="button" className="text-button" onClick={onDiscard}>
                <X size={16} />
                {reading ? 'Cancel photo preparation' : 'Remove photo'}
              </button>
            </div>
          )}
          {error && (
            <p className="photo-failure" role="alert">
              {error}
            </p>
          )}
          {status && (
            <p className="photo-status" role="status">
              {reading && <LoaderCircle className="spin" size={15} />}
              {status}
            </p>
          )}
          <button
            type="button"
            className="primary full-width"
            disabled={!photo || reading || busy}
            onClick={() => onNext?.()}
          >
            Next <ArrowRight size={17} />
          </button>
          <p className="helper">
            <ShieldCheck size={14} /> Include a nearby room sign or doorway if you can. Your photo
            stays on this device until you tap Go.
          </p>
        </>
      ) : (
        <>
          {photo && (
            <div className="photo-step-summary">
              <img src={photo.preview} alt="Selected starting location" />
              <span>Starting photo added</span>
              <button
                type="button"
                className="text-button"
                onClick={() => (busy ? onDiscard() : onBack?.())}
              >
                {busy ? 'Cancel analysis' : 'Change'}
              </button>
            </div>
          )}
          <form
            aria-label="Find a route"
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault();
              onAnalyze();
            }}
          >
            <div className="destination-field">
              <label htmlFor="trip-destination">Destination</label>
              <div>
                <MapPin size={19} />
                <input
                  id="trip-destination"
                  type="text"
                  maxLength={150}
                  value={destination}
                  disabled={busy}
                  autoComplete="off"
                  autoFocus
                  placeholder="Room or building, e.g. SW03 2605"
                  onChange={(event) => onDestinationChange(event.target.value)}
                />
              </div>
              <small>SE12 · SW03 · SW01 · Unique close matches accepted</small>
            </div>
            {!canUsePhotoResult && deviceOption}
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
            {!canUsePhotoResult && (
              <button
                type="submit"
                className="primary full-width go-button"
                disabled={!canSubmitPhoto}
              >
                {busy ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
                {busy ? 'Finding your route…' : error ? 'Try again' : 'GO'}
              </button>
            )}
          </form>
          <button
            type="button"
            className="text-button back-step"
            disabled={busy}
            onClick={() => onBack?.()}
          >
            {photo ? (
              <>
                <ArrowLeft size={16} /> Back to photo
              </>
            ) : (
              <>
                <Camera size={16} /> Use a different photo
              </>
            )}
          </button>
          <p className="helper">
            <ShieldCheck size={14} /> Photos are processed for this route and not saved by the app.
          </p>
        </>
      )}
    </section>
  );
}
