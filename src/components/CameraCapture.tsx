import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ArrowLeft, Upload, RefreshCw } from 'lucide-react';
export function CameraCapture({
  onBack,
  onUpload,
  onCapture,
  busy,
}: {
  onBack: () => void;
  onUpload: () => void;
  onCapture: (file: File) => void;
  busy: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null);
  const [error, setError] = useState(''),
    [ready, setReady] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    async function openCamera() {
      setError('');
      setReady(false);
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error('Camera preview needs HTTPS or localhost. You can still upload a photo.');
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
          audio: false,
        });
        if (disposed) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        if (video.current) {
          video.current.srcObject = media;
          await video.current.play();
        }
        setReady(true);
      } catch (e) {
        if (!disposed)
          setError(
            e instanceof Error && e.message.includes('HTTPS')
              ? e.message
              : 'Camera access is unavailable or was denied. Upload a photo instead.',
          );
      }
    }
    void openCamera();
    const stopWhenHidden = () => {
      if (document.hidden) {
        stream.current?.getTracks().forEach((track) => track.stop());
        setReady(false);
        setError('Camera paused while the app was hidden. Retry when you are ready.');
      }
    };
    document.addEventListener('visibilitychange', stopWhenHidden);
    return () => {
      disposed = true;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      document.removeEventListener('visibilitychange', stopWhenHidden);
    };
  }, [attempt]);
  function capture() {
    if (!video.current || !ready || busy) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.current.videoWidth;
    canvas.height = video.current.videoHeight;
    canvas.getContext('2d')?.drawImage(video.current, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], 'campus-photo.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.8,
    );
  }
  return (
    <section className="camera-page">
      <div className="section-heading">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={18} />
          Return to plans
        </button>
        <span className="pill">Camera preview</span>
      </div>
      <div className="camera-view">
        <video ref={video} playsInline muted aria-label="Rear camera preview" />
        {!ready && (
          <div className="camera-fallback">
            <CameraOff size={42} />
            <h2>Keep your bearings.</h2>
            <p>{error || 'Opening the rear camera…'}</p>
            {error && (
              <button className="light-button" onClick={() => setAttempt(attempt + 1)}>
                <RefreshCw size={16} />
                Retry camera
              </button>
            )}
          </div>
        )}
        <div className="camera-label">
          <span className="status-dot" />
          Preview only · no automatic tracking
        </div>
        {ready && (
          <button
            className="capture-button"
            onClick={capture}
            disabled={busy}
            aria-label="Capture photo for floor-plan comparison"
          >
            <Camera size={26} />
          </button>
        )}
        <div className="camera-instruction">
          <span className="eyebrow">PHOTO TO FLOOR PLAN</span>
          <h2>Capture a campus view</h2>
          <p>
            Capture a photo, then choose whether to send it for comparison with official BCIT floor
            plans.
          </p>
        </div>
      </div>
      <p className="helper">
        Photos are sent for analysis only after you capture one and confirm. The preview does not
        track your indoor position or heading.
      </p>
      <div className="button-row">
        <button className="secondary" onClick={onUpload} disabled={busy}>
          <Upload size={18} /> Upload a photo instead
        </button>
      </div>
    </section>
  );
}
