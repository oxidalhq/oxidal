import { useCallback, useEffect, useRef, useState } from 'react';

import { deviceNetwork, type NetworkCommand, type NetworkState } from './api';

/** One owner for readback and writes; a late poll cannot replace a transaction.
 * @see docs/device-service.md
 */
export function useDeviceNetwork(connected: boolean) {
  const [state, setState] = useState<NetworkState | null>(null);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [joined, setJoined] = useState<{
    transaction: string;
    ssid: string;
  } | null>(null);
  const owner = useRef({
    active: false,
    generation: 0,
    writing: false,
    stale: false,
  });
  const request = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const current = owner.current;
    if (!connected || !current.active || current.writing || request.current)
      return;
    const generation = ++current.generation;
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const next = await deviceNetwork(undefined, controller.signal);
      if (current.active && current.generation === generation) {
        setState(next);
        setReadError('');
        current.stale = false;
        setBusy(false);
      }
    } catch {
      if (current.active && current.generation === generation) {
        current.stale = true;
        setReadError(
          'Cannot reach device settings. Reconnect to the device and refresh before making another change.',
        );
      }
    } finally {
      clearTimeout(timer);
      if (request.current === controller) request.current = null;
    }
  }, [connected]);

  useEffect(() => {
    const current = owner.current;
    current.active = true;
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      current.active = false;
      current.generation += 1;
      request.current?.abort();
      request.current = null;
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [refresh]);

  const run = useCallback(
    async (command: NetworkCommand, joinedSsid?: string) => {
      const current = owner.current;
      if (
        !connected ||
        !current.active ||
        current.writing ||
        (current.stale && command.type !== 'scan' && command.type !== 'status')
      )
        return false;
      const generation = ++current.generation;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      current.writing = true;
      setBusy(true);
      setError('');
      const timer = setTimeout(() => controller.abort(), 25000);
      let succeeded = false;
      try {
        const next = await deviceNetwork(command, controller.signal);
        if (current.active && current.generation === generation) {
          setState(next);
          setReadError('');
          current.stale = false;
          if (next.pending && joinedSsid)
            setJoined({
              transaction: next.pending.transaction,
              ssid: joinedSsid,
            });
          else if (!next.pending) setJoined(null);
          succeeded = true;
        }
      } catch (failure) {
        if (current.active && current.generation === generation) {
          current.stale = true;
          setError(
            failure instanceof Error
              ? failure.message
              : 'Network operation failed',
          );
          setReadError(
            'The result is uncertain. Reading device settings before another change.',
          );
        }
      } finally {
        clearTimeout(timer);
        if (request.current === controller) request.current = null;
        current.writing = false;
        if (current.active && current.generation === generation) {
          setBusy(false);
          if (!succeeded) void refresh();
        }
      }
      return succeeded;
    },
    [connected, refresh],
  );

  const joinedSsid =
    joined &&
    joined.transaction === state?.pending?.transaction &&
    state.pending.phase === 'awaiting_confirmation'
      ? joined.ssid
      : undefined;
  return { state, error, readError, busy, refresh, run, joinedSsid };
}
