/**
 * Foreground React lifecycle hook for the live directional heading cone.
 * Combines browser orientation events, live gyro yaw from useMotionTracker,
 * and Stage 2 PDR travel-heading fallback strictly in browser memory.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserHeading } from './browser-heading';
import type { PdrHeadingFallback } from './heading';
import type { DeviceHeading } from './types';

export function useHeadingTracker({
  active,
  permissionTick = 0,
  bearingToPlanAngle,
  pdrFallback,
}: {
  active: boolean;
  /** Increment after a user-gesture permission prompt completes to re-check orientation attachment. */
  permissionTick?: number;
  bearingToPlanAngle: ((trueBearingRad: number) => number) | null;
  pdrFallback?: PdrHeadingFallback | null;
}): {
  heading: DeviceHeading | null;
  onGyroYaw: (omegaCcwRadPerSec: number, timestamp: number) => void;
} {
  const [heading, setHeading] = useState<DeviceHeading | null>(null);
  const adapterRef = useRef<BrowserHeading | null>(null);
  const bearingTransformRef = useRef(bearingToPlanAngle);
  bearingTransformRef.current = bearingToPlanAngle;
  const pdrFallbackRef = useRef(pdrFallback ?? null);
  pdrFallbackRef.current = pdrFallback ?? null;

  const onGyroYaw = useCallback((omegaCcwRadPerSec: number, timestamp: number) => {
    adapterRef.current?.ingestGyroYaw(omegaCcwRadPerSec, timestamp);
  }, []);

  useEffect(() => {
    if (!active || document.hidden || !bearingTransformRef.current) {
      adapterRef.current?.stop();
      adapterRef.current = null;
      setHeading(null);
      return;
    }

    let disposed = false;
    const adapter = new BrowserHeading();
    adapterRef.current = adapter;
    adapter.setBearingTransform(bearingTransformRef.current);
    adapter.setPdrFallback(pdrFallbackRef.current);

    adapter.start((next) => {
      if (!disposed) setHeading(next);
    });

    const onVisibility = () => {
      if (document.hidden) {
        adapter.stop();
        if (!disposed) setHeading(null);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      adapter.stop();
      if (adapterRef.current === adapter) adapterRef.current = null;
    };
  }, [active, permissionTick]);

  useEffect(() => {
    adapterRef.current?.setBearingTransform(bearingToPlanAngle);
  }, [bearingToPlanAngle]);

  useEffect(() => {
    adapterRef.current?.setPdrFallback(pdrFallback ?? null);
  }, [pdrFallback]);

  return { heading, onGyroYaw };
}
