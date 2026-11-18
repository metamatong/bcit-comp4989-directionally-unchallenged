/** Explicit photo/device association, including uploaded photographs. */
import type { PhotoReading } from '../location/types';
export function PhotoDeviceOption({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="device-location-option">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />{' '}
        Use device location with this photo
      </label>
      <p className="helper">
        By selecting this, I confirm I am standing where this photo was taken. Submitting requests
        my current location. Only matching building IDs, accuracy and reading time are sent to the
        app to narrow label matches. Coordinates stay in this tab. My browser or device may use its
        own location service.
      </p>
    </div>
  );
}
export function PhotoDeviceSummary({
  snapshot,
  status,
  onRetry,
  busy,
}: {
  snapshot?: PhotoReading;
  status: string;
  onRetry: () => void;
  busy: boolean;
}) {
  if (!snapshot && !status) return null;
  return (
    <aside className="device-location-status" aria-label="Device evidence for this photo">
      {snapshot && (
        <p>
          Device reading associated with this photo submission · acquired{' '}
          {new Date(snapshot.reading.timestamp).toLocaleTimeString()}. Reported horizontal accuracy{' '}
          {snapshot.reading.accuracy.toFixed(1)} m. This is a historical reading. Reported accuracy
          can be misleading indoors.
        </p>
      )}
      {status && <p role="status">{status}</p>}
      <button type="button" className="secondary" disabled={busy} onClick={onRetry}>
        I’m still at the photo location · request another reading
      </button>
    </aside>
  );
}
