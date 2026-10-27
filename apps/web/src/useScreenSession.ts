import { useEffect, useState } from 'react';

type WakeStatus = 'off' | 'requesting' | 'active' | 'paused' | 'denied';

/** Browser display preferences, independent of the audio session and current view. */
export function useScreenSession() {
  const wakeSupported = window.isSecureContext && !!navigator.wakeLock;
  const fullscreenSupported =
    !!document.fullscreenEnabled &&
    typeof document.documentElement.requestFullscreen === 'function';
  const [keepAwake, setKeepAwake] = useState(() => {
    try {
      return localStorage.getItem('oxidal.keepAwake') === 'true';
    } catch {
      return false;
    }
  });
  const [wakeStatus, setWakeStatus] = useState<WakeStatus>('off');
  const [attempt, setAttempt] = useState(0);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  const [fullscreenError, setFullscreenError] = useState('');
  useEffect(() => {
    try {
      localStorage.setItem('oxidal.keepAwake', String(keepAwake));
    } catch {
      /* This page session still works without preference storage. */
    }
    if (!keepAwake || !wakeSupported) return;
    let disposed = false;
    let pending = false;
    let sentinel: WakeLockSentinel | null = null;
    async function acquire() {
      if (disposed || pending || sentinel || document.hidden) return;
      pending = true;
      setWakeStatus('requesting');
      try {
        const acquired = await navigator.wakeLock.request('screen');
        if (disposed || document.hidden) {
          await acquired.release();
          return;
        }
        if (acquired.released) {
          setWakeStatus('paused');
          return;
        }
        sentinel = acquired;
        acquired.addEventListener('release', () => {
          if (sentinel !== acquired) return;
          sentinel = null;
          if (!disposed) setWakeStatus('paused');
        });
        setWakeStatus('active');
      } catch {
        if (!disposed) setWakeStatus('denied');
      } finally {
        pending = false;
      }
    }
    function visibility() {
      if (!document.hidden) {
        void acquire();
      } else {
        const previous = sentinel;
        sentinel = null;
        setWakeStatus('paused');
        if (previous) void previous.release().catch(() => undefined);
      }
    }
    document.addEventListener('visibilitychange', visibility);
    void acquire();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', visibility);
      if (sentinel) void sentinel.release().catch(() => undefined);
    };
  }, [keepAwake, wakeSupported, attempt]);
  useEffect(() => {
    const changed = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);
  async function toggleFullscreen() {
    setFullscreenError('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
      setFullscreen(!!document.fullscreenElement);
    } catch {
      setFullscreenError('Fullscreen was not allowed by this browser.');
    }
  }
  return {
    keepAwake,
    setKeepAwake,
    wakeSupported,
    wakeStatus: keepAwake ? wakeStatus : ('off' as const),
    retryWake: () => setAttempt((value) => value + 1),
    fullscreen,
    fullscreenSupported,
    fullscreenError,
    toggleFullscreen,
  };
}
