/** Attach heading sensors for the current foreground floor calibration and pre-warm before Step 1. */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BrowserHeading, startHeadingPrewarm, stopHeadingPrewarm } from './browser-heading';
import {
  getOrientationPermissionState,
  getSensorPermissionSnapshot,
  subscribeSensorPermissions,
} from './browser-motion';
import type { DeviceHeading } from './types';

/**
 * Pre-warm foreground orientation sensors before GuidedDirections mounts when orientation
 * permission is already granted (e.g. Android Chrome or already-granted iOS sessions).
 */
export function useHeadingPrewarm(active: boolean) {
  const permissionSnapshot = useSyncExternalStore(
    subscribeSensorPermissions,
    getSensorPermissionSnapshot,
    getSensorPermissionSnapshot,
  );

  useEffect(() => {
    if (!active || getOrientationPermissionState() !== 'granted') {
      stopHeadingPrewarm();
      return;
    }

    const syncVisibility = () => {
      if (document.hidden) stopHeadingPrewarm();
      else startHeadingPrewarm();
    };

    syncVisibility();
    document.addEventListener('visibilitychange', syncVisibility);
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility);
      stopHeadingPrewarm();
    };
  }, [active, permissionSnapshot]);
}

export function useHeadingTracker({
  active,
  permissionTick = 0,
  bearingToPlanAngle,
}: {
  active: boolean;
  /** Increment or update snapshot when a user-gesture permission request settles. */
  permissionTick?: number | string;
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
