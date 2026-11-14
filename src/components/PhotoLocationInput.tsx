import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle, Search, ShieldCheck, Upload, X, MapPin } from 'lucide-react';
import type { PreparedPhoto } from '../photo';

type PhotoLocationInputProps = {
  photo: PreparedPhoto | null;
  consent: boolean;
  ready: boolean;
  reading: boolean;
  busy: boolean;
  status: string;
  error?: string;
  destination: string;
  canUsePhotoResult?: boolean;
  onDestinationChange: (value: string) => void;
  onPhoto: (file?: File) => void;
  onConsent: (consent: boolean) => void;
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
  photo,
  consent,
  ready,
  reading,
  busy,
  status,
  error,
  destination,
  canUsePhotoResult = false,
  onDestinationChange,
  onPhoto,
  onConsent,
  onAnalyze,
  onDiscard,
}: PhotoLocationInputProps) {
  const upload = useRef<HTMLInputElement>(null);
  const phonePhoto = useRef<HTMLInputElement>(null);

  return (
    <section className="photo-location-input" aria-labelledby="location-heading">
      <h1 id="location-heading">Find my location</h1>
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
      {photo && (
        <img
          className="evidence-photo"
          src={photo.preview}
          alt="Uploaded location photo, awaiting analysis or confirmation"
        />
      )}
      {(photo || reading) && (
        <div className="photo-controls">
          <button type="button" className="text-button" onClick={onDiscard}>
            <X size={16} />
            {busy ? 'Cancel analysis' : reading ? 'Cancel photo preparation' : 'Remove photo'}
          </button>
        </div>
      )}
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
            placeholder="Building and room, e.g. SW03 2605"
            onChange={(event) => onDestinationChange(event.target.value)}
          />
        </div>
        <small>BCIT Burnaby · SE12, SW03 and SW01</small>
      </div>
      {error ? (
        <p className="photo-failure" role="alert">
          {error}
        </p>
      ) : (
        status && (
          <p className="photo-status" role="status">
            {(reading || busy) && <LoaderCircle className="spin" size={15} />}
            {status}
            {busy && <ElapsedTime key={status} />}
          </p>
        )
      )}
      {photo && !canUsePhotoResult && (
        <form
          aria-label="Photo analysis"
          aria-busy={busy}
          onSubmit={(event) => {
            event.preventDefault();
            onAnalyze();
          }}
        >
          <label className="checkbox-label photo-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy || reading || !ready}
              onChange={(event) => onConsent(event.target.checked)}
            />
            Send this photo and its detail views to Google Gemini to read labels and compare floor
            plans. Free-tier inputs may be used to improve Google products.
          </label>
          <button className="primary full-width" disabled={busy || reading || !consent || !ready}>
            {busy ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}
            {error
              ? 'Retry with this photo'
              : destination.trim()
                ? 'Find my route'
                : 'Analyze photo against BCIT plans'}
          </button>
        </form>
      )}
      <p className="helper">
        <ShieldCheck size={14} /> Resized on your device. DirectionallyUnchallenged does not save
        photos or location history.
      </p>
    </section>
  );
}
