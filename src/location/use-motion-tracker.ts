/**
 * Foreground React lifecycle wrapper around BrowserMotion.
 * Processes 50-60 Hz IMU events off React's render loop, updating state only on discrete
 * step detections, activity changes, capability detection, or stop/silence transitions.
 */
import { useEffect, useRef, useState } from 'react';
import { BrowserMotion, getMotionPermissionState, isMotionSupported } from './browser-motion';
import type { DetectedStep, MotionSnapshot } from './types';

function emptySnapshot(): MotionSnapshot {
  return {
    supported: isMotionSupported(),
    permission: getMotionPermissionState(),
    active: false,
    hasAccel: false,
    hasGyro: false,
    gyroFresh: false,
    gyroFreshSince: null,
    activity: 'unknown',
    stepCount: 0,
    estimatedDistanceMetres: 0,
    lastStepAt: null,
    lastEventAt: null,
  };
}

export function useMotionTracker({
  active,
  permissionTick = 0,
  onStep,
  onGyroYaw,
}: {
  active: boolean;
  /** Increment or update snapshot after a user-gesture permission prompt settles. */
  permissionTick?: number | string;
  onStep?: (step: DetectedStep, snapshot: MotionSnapshot) => void;
  /** Live bias-corrected world CCW yaw rate (rad/s) streamed off React's render loop. */
  onGyroYaw?: (omegaCcwRadPerSec: number, timestamp: number) => void;
}): MotionSnapshot {
  const [snapshot, setSnapshot] = useState<MotionSnapshot>(emptySnapshot);
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;
  const onGyroYawRef = useRef(onGyroYaw);
  onGyroYawRef.current = onGyroYaw;

  useEffect(() => {
    if (!active || document.hidden || getMotionPermissionState() !== 'granted') {
      setSnapshot(emptySnapshot());
      return;
    }

    let disposed = false;
    const motion = new BrowserMotion();
    const update = (next: MotionSnapshot) => {
      if (!disposed) setSnapshot(next);
    };

    motion.start(
      (step, next) => {
        if (disposed) return;
        setSnapshot(next);
        onStepRef.current?.(step, next);
      },
      update,
      (omegaCcwRadPerSec, timestamp) => {
        if (!disposed) onGyroYawRef.current?.(omegaCcwRadPerSec, timestamp);
      },
    );

    const onVisibility = () => {
      if (document.hidden) {
        motion.stop(update);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      motion.stop();
    };
  }, [active, permissionTick]);

  return snapshot;
}
