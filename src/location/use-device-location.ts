/** Browser-only location lifecycle. Readings never enter application session/API state. */
import { useEffect, useRef, useState } from 'react';
import { BrowserLocation, eligibleReading } from './browser-location';
import type { DeviceReading, PhotoReading } from './types';

export function usePhotoDeviceLocation() {
  const [enabled, setEnabled] = useState(false);
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
    setEnabled(false);
  }
  function cancelPending() {
    if (!pending.current) return;
    cancel();
    setStatus('Photo location was confirmed before a device reading arrived.');
  }
  function capture() {
    cancel();
    setSnapshot(undefined);
    setStatus('');
    if (!enabled) return;
    const submission = generation.current;
    pending.current = true;
    setStatus('Requesting device location for this photo…');
    provider.current = new BrowserLocation();
    provider.current
      .once()
      .then((reading) => {
        if (generation.current !== submission) return;
        pending.current = false;
        setSnapshot({ submission, reading });
        setStatus('');
      })
      .catch((error) => {
        if (generation.current !== submission) return;
        pending.current = false;
        setStatus((error as Error).message);
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
  return { enabled, setEnabled, snapshot, status, capture, clear, cancelPending };
}

export function useWalkingLocation() {
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reading, setReading] = useState<DeviceReading>();
  const [status, setStatus] = useState('');
  const [now, setNow] = useState(Date.now());
  const provider = useRef<BrowserLocation | null>(null);
  function stop() {
    provider.current?.stop();
    setActive(false);
    setPaused(true);
  }
  function start() {
    setReading(undefined);
    setStatus('Waiting for a fresh device reading…');
    setPaused(false);
    setActive(true);
  }
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const location = new BrowserLocation();
    provider.current = location;
    const hide = () => {
      if (document.hidden) {
        stop();
        setStatus('Tracking paused while the page is hidden. Resume when you are ready.');
      }
    };
    if (document.hidden) hide();
    else
      location.start(
        (next) => {
          if (disposed) return;
          setReading(next);
          setNow(Date.now());
          setStatus('');
        },
        (message, denied) => {
          if (disposed) return;
          setStatus(message);
          if (denied) stop();
        },
      );
    // Freshness changes only the evidence display, never route progress.
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    document.addEventListener('visibilitychange', hide);
    let permission: PermissionStatus | undefined;
    const revoked = () => {
      if (!disposed && permission?.state === 'denied') {
        stop();
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
  }, [active]);
  return {
    active,
    paused,
    reading,
    status,
    now,
    start,
    stop,
    fresh: active && !!reading && eligibleReading(reading, now),
  };
}
