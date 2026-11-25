/** Attach heading sensors for the current foreground floor calibration. */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { BrowserHeading } from './browser-heading';
import type { DeviceHeading } from './types';

export function useHeadingTracker({
  active,
  permissionTick = 0,
  bearingToPlanAngle,
}: {
  active: boolean;
  /** Increment when a user-gesture permission request settles. */
  permissionTick?: number;
  bearingToPlanAngle: ((trueBearingRad: number) => number) | null;
}): {
  heading: DeviceHeading | null;
  onGyroYaw: (omegaCcwRadPerSec: number, timestamp: number) => void;
} {
  const [heading, setHeading] = useState<DeviceHeading | null>(null);
  const adapterRef = useRef<BrowserHeading | null>(null);

  const onGyroYaw = useCallback((omegaCcwRadPerSec: number, timestamp: number) => {
    adapterRef.current?.ingestGyroYaw(omegaCcwRadPerSec, timestamp);
  }, []);

  // Discard the old pixel angle before painting a different floor or calibration.
  useLayoutEffect(() => {
    if (!active || !bearingToPlanAngle) {
      setHeading(null);
      return;
    }

    const adapter = new BrowserHeading(bearingToPlanAngle);
    adapterRef.current = adapter;
    const onVisibility = () => {
      setHeading(null);
      if (document.hidden) adapter.stop();
      else adapter.start(setHeading);
    };

    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      adapter.stop();
      adapterRef.current = null;
    };
  }, [active, permissionTick, bearingToPlanAngle]);

  return { heading, onGyroYaw };
}
