import { useEffect, useState } from 'react';

import { protectState, setProtect } from '../../api';
import { friendlyError } from '../../lib/friendlyError';
import { useMonitorReadings } from '../../monitorFeed';
import { setOutputMute } from './outputMute';

/**
 * Mute and Protect as the device reports them, for the Rig header's stage
 * controls and the floating capsule (Mute beside the preset, Protect in its
 * ☰ menu). Neither is ever shown on hope: Mute is read from the monitor
 * feed, Protect is read every five seconds, and both show the device's
 * answer after a change. Turning Protect off asks first (`confirmOff`).
 * @see docs/interface.md
 */

/** Runs one change at a time and keeps its failure in plain words. */
function useOneAtATime() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(task: () => Promise<void>, failure: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (cause) {
      setError(friendlyError(cause, failure));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function useOutputMute(connected: boolean) {
  const [muted, setMuted] = useState<boolean | null>(null);
  const { busy, error, run } = useOneAtATime();
  useMonitorReadings(5000, (reading) => {
    const value = reading.snapshot?.audio?.monitoring?.output_muted;
    setMuted(
      !reading.disconnected && typeof value === 'boolean' ? value : null,
    );
  });
  return {
    /** Null until the device says. */
    muted,
    busy,
    error,
    disabled: !connected || busy || muted === null,
    toggle: () =>
      void run(
        async () => {
          await setOutputMute(!muted);
          setMuted(!muted);
        },
        muted ? 'unmute' : 'mute',
      ),
  };
}

export function useProtect(connected: boolean) {
  const [protect, setProtectOn] = useState<boolean | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const { busy, error, run } = useOneAtATime();
  useEffect(() => {
    let alive = true;
    const read = () => {
      void protectState()
        .then((s) => alive && setProtectOn(s.on))
        .catch(() => alive && setProtectOn(null));
    };
    read();
    const timer = window.setInterval(read, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return {
    /** Null until the device says. */
    protect,
    busy,
    error,
    disabled: !connected || busy || protect === null,
    /** On in one tap; off asks first. */
    request: () =>
      protect
        ? setConfirmOff(true)
        : void run(async () => {
            setProtectOn((await setProtect(true)).on);
          }, 'turn on Protect'),
    confirmOff,
    keepOn: () => setConfirmOff(false),
    turnOff: () => {
      setConfirmOff(false);
      void run(async () => {
        setProtectOn((await setProtect(false)).on);
      }, 'turn off Protect');
    },
  };
}
