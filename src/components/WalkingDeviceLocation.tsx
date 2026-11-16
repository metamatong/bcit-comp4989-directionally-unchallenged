/** Foreground location controls and uncertainty for the visitor-confirmed floor visit. */
import type { useWalkingLocation } from '../location/use-device-location';
import type { FloorCalibration } from '../location/types';
export function WalkingDeviceLocation({
  tracking,
  floorLabel,
  calibration,
  outside,
}: {
  tracking: ReturnType<typeof useWalkingLocation>;
  floorLabel: string;
  calibration?: FloorCalibration;
  outside: boolean;
}) {
  return (
    <section className="device-location-status" aria-label="Walking device location">
      <p>Tracking floor · {floorLabel}. Confirm your floor after each transfer.</p>
      <button
        type="button"
        className="secondary"
        onClick={tracking.active ? tracking.stop : tracking.start}
      >
        {tracking.active
          ? 'Stop tracking'
          : tracking.paused
            ? 'Resume tracking'
            : 'Show my position'}
      </button>
      <p className="helper">
        Device readings stay in this tab. Your browser or device may use its own location service.
        Indoor readings may drift. Stop tracking when you finish walking.
      </p>
      {tracking.status && <p role="status">{tracking.status}</p>}
      {tracking.reading && (
        <p>
          {tracking.fresh
            ? 'Approximate device reading'
            : 'Last device reading · live marker unavailable'}
          {' · '}
          {new Date(tracking.reading.timestamp).toLocaleTimeString()}
          {' · '}Reported horizontal accuracy {tracking.reading.accuracy.toFixed(1)} m.
          {tracking.fresh &&
            ` Acquired ${Math.max(0, Math.floor((tracking.now - tracking.reading.timestamp) / 1000))}s ago.`}
          {tracking.fresh &&
            tracking.reading.accuracy > 0 &&
            ' The blue area may cover several rooms or corridors.'}
        </p>
      )}
      {outside && (
        <p role="status">
          The reported device area falls outside this building. Check your surroundings.
        </p>
      )}
      <p className="helper">
        {calibration?.status === 'approximate'
          ? `Approximate drawing alignment. Held-out landmark discrepancy ${calibration.heldOutMetres?.toFixed(2)} m. ${calibration.reason}`
          : `Position overlay unavailable for this floor. ${calibration?.reason ?? 'Drawing calibration is unavailable.'}`}
      </p>
    </section>
  );
}
