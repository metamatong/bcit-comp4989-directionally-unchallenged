/** Browser-only location lifecycle. Readings never enter application session/API state. */
import { useEffect, useRef, useState } from 'react';
import { BrowserLocation, eligibleReading } from './browser-location';
import type { PhotoReading, WalkingReading } from './types';

export function usePhotoDeviceLocation() {
  const [snapshot, setSnapshot] = useState<PhotoReading>();
  const [status, setStatus] = useState('');
  const provider = useRef<BrowserLocation | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  function cancel() {
    generation.current++;
    provider.current?.stop();
    pending.current = false;
  }
  function clear() {
    cancel();
    setSnapshot(undefined);
    setStatus('');
  }
  function cancelPending() {
    if (!pending.current) return;
    cancel();
    setStatus('Waiting for the photo’s GPS reading timed out. Request location again to continue.');
  }
  function capture(): Promise<PhotoReading> {
    cancel();
    setSnapshot(undefined);
    setStatus('');
    const submission = generation.current;
    pending.current = true;
    setStatus('Requesting device location for this photo…');
    provider.current = new BrowserLocation();
    return provider.current
      .once()
      .then((reading) => {
        if (generation.current !== submission)
          throw new DOMException('The GPS request was cancelled.', 'AbortError');
        pending.current = false;
        const next = { submission, reading };
        setSnapshot(next);
        setStatus('');
        return next;
      })
      .catch((error) => {
        if (generation.current !== submission) throw error;
        pending.current = false;
        setStatus((error as Error).message);
        throw error;
      });
  }
  useEffect(() => {
    const hide = () => {
      if (document.hidden && pending.current) {
        cancel();
        setStatus(
          'Device location request paused when the page was hidden. You can request another reading here.',
        );
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      cancel();
    };
  }, []);
  return { snapshot, status, capture, clear, cancelPending };
}

export type WalkingPauseReason = 'none' | 'hidden' | 'denied' | 'manual';

/** Silence interval after which a visible active watch restarts quietly to recover wedged streams. */
export const WATCH_STALL_RESTART_MS = 15_000;

export function useWalkingLocation(startActive = false) {
  const [active, setActive] = useState(startActive);
  const [watchRevision, setWatchRevision] = useState(0);
  const [paused, setPaused] = useState(false);
  const [pauseReason, setPauseReason] = useState<WalkingPauseReason>('none');
  const [reading, setReading] = useState<WalkingReading>();
  const [status, setStatus] = useState('');
  const [now, setNow] = useState(Date.now());
  const provider = useRef<BrowserLocation | null>(null);
  function stopWithReason(reason: Exclude<WalkingPauseReason, 'none'>) {
    provider.current?.stop();
    setActive(false);
    setPaused(true);
    setPauseReason(reason);
  }
  function stop() {
    stopWithReason('manual');
  }
  function start() {
    provider.current?.stop();
    setReading(undefined);
    setStatus('Waiting for a fresh device reading…');
    setPaused(false);
    setPauseReason('none');
    setActive(true);
    setWatchRevision((revision) => revision + 1);
  }
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let latestCaptureTimestamp = -Infinity;
    let lastFixOrStartAt = Date.now();
    let lastRecoveryRestartAt = -Infinity;
    const location = new BrowserLocation();
    provider.current = location;
    const hide = () => {
      if (document.hidden) {
        stopWithReason('hidden');
        setStatus('Tracking paused while the page is hidden. Resume when you are ready.');
      }
    };
    const startWatch = () => {
      location.start(
        (next) => {
          if (disposed) return;
          latestCaptureTimestamp = next.captureTimestamp;
          lastFixOrStartAt = Date.now();
          setReading(next);
          setNow(Date.now());
          setStatus('');
        },
        (message, denied) => {
          if (disposed) return;
          setStatus(message);
          if (denied) stopWithReason('denied');
        },
        {
          minCaptureTimestamp: latestCaptureTimestamp,
          // Transient watch timeouts are common indoors; silently restart without blanking readings.
          onTimeout: () => {
            if (disposed) return;
            setStatus('');
            const tickNow = Date.now();
            if (!document.hidden && tickNow - lastRecoveryRestartAt >= WATCH_STALL_RESTART_MS) {
              lastRecoveryRestartAt = tickNow;
              lastFixOrStartAt = tickNow;
              startWatch();
            }
          },
        },
      );
    };
    if (document.hidden) hide();
    else startWatch();
    // Freshness changes only the evidence display, never route progress.
    const timer = window.setInterval(() => {
      const tickNow = Date.now();
      setNow(tickNow);
      if (
        !document.hidden &&
        tickNow - lastFixOrStartAt >= WATCH_STALL_RESTART_MS &&
        tickNow - lastRecoveryRestartAt >= WATCH_STALL_RESTART_MS
      ) {
        lastRecoveryRestartAt = tickNow;
        lastFixOrStartAt = tickNow;
        startWatch();
      }
    }, 500);
    document.addEventListener('visibilitychange', hide);
    let permission: PermissionStatus | undefined;
    const revoked = () => {
      if (!disposed && permission?.state === 'denied') {
        stopWithReason('denied');
        setStatus('Location permission was revoked. Enable it in your browser settings to resume.');
      }
    };
    navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((value) => {
        if (disposed) return;
        permission = value;
        permission.addEventListener('change', revoked);
        revoked();
      })
      .catch(() => {
        /* Watch errors still report permissions on browsers without this query. */
      });
    return () => {
      disposed = true;
      location.stop();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', hide);
      permission?.removeEventListener('change', revoked);
    };
  }, [active, watchRevision]);
  return {
    active,
    paused,
    pauseReason,
    reading,
    status,
    now,
    start,
    stop,
    fresh: active && !!reading && eligibleReading(reading, now),
  };
}
