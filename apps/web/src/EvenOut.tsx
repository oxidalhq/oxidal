import { useEffect, useRef, useState } from 'react';

import { EvenOutPanel } from '@oxidal/design-system/patterns/even-out';

import {
  calibration,
  type CalibrationCoverage,
  calibrationCoverage,
  type CalibrationState,
} from './api';
import { friendlyError } from './lib/friendlyError';

/**
 * Even out all: measures a reference riff through every preset and scene
 * and applies a stored loudness correction. Only new or changed presets are measured
 * again. Hidden on a daemon without calibration.
 * @see docs/audio.md
 */
export function EvenOut({ connected }: { connected: boolean }) {
  const [state, setState] = useState<CalibrationState | null | 'unsupported'>(
    null,
  );
  const [error, setError] = useState('');
  const [coverage, setCoverage] = useState<CalibrationCoverage | null>(null);
  const alive = useRef(true);
  const running = state !== 'unsupported' && !!state?.progress.running;
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const [next, nextCoverage] = await Promise.all([
          calibration(),
          calibrationCoverage(),
        ]);
        if (!alive.current) return;
        setState(next ?? 'unsupported');
        setCoverage(nextCoverage);
        // Poll while a run is going; one read otherwise.
        if (next?.progress.running) timer = setTimeout(() => void read(), 500);
      } catch (cause) {
        if (alive.current) setError(friendlyError(cause, 'measure the levels'));
      }
    };
    void read();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [running]);
  if (state === 'unsupported' || state == null) return null;
  async function send(action: 'run' | 'run_all' | 'cancel' | 'reset') {
    setError('');
    try {
      const next = await calibration(action);
      if (next && alive.current) setState(next);
    } catch (cause) {
      setError(friendlyError(cause, 'even out the levels'));
    }
  }
  const { progress, entries, target_lufs } = state;
  const pending = (coverage?.stale ?? 0) + (coverage?.unmeasured ?? 0);
  return (
    <EvenOutPanel
      sounds={entries}
      target={target_lufs ?? null}
      pending={pending}
      progress={progress}
      connected={connected}
      error={error}
      onAction={(action) => void send(action)}
    />
  );
}
