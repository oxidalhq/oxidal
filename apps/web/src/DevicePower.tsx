import { ArrowClockwise } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Caption } from '@oxidal/design-system/components/text';
import {
  DevicePower as DevicePowerView,
  PowerReceipt,
} from '@oxidal/design-system/patterns/device-power';

import { deviceNetwork, type NetworkState } from './api';
import { friendlyError } from './lib/friendlyError';

/** Device power is separate from the audio transport and always confirmed.
 * @see docs/device-service.md
 */
export function DevicePower({
  connected,
  ask = null,
  onAnswered,
}: {
  connected: boolean;
  /**
   * Opens this confirmation straight away, as the capsule's ☰ menu does;
   * give the section a new key for each request.
   */
  ask?: 'reboot' | 'shutdown' | null;
  /** The request was confirmed or cancelled. */
  onAnswered?: () => void;
}) {
  const [state, setState] = useState<NetworkState | null>(null);
  const [action, setAction] = useState<'reboot' | 'shutdown' | null>(ask);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<'reboot' | 'shutdown' | null>(null);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    void deviceNetwork()
      .then((next) => {
        if (active) {
          setState(next);
          setReadError('');
        }
      })
      .catch(() => {
        if (active) setReadError('Device controls could not be read.');
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  async function confirm() {
    if (!action || busy) return;
    setBusy(true);
    setError('');
    try {
      const current = await deviceNetwork();
      setState(current);
      if (!current.available || current.pending)
        throw new Error(
          'Finish the pending network change before changing device power.',
        );
      if (!current.capabilities?.guarded_power)
        throw new Error(
          'Read device status or update the device service for guarded power controls.',
        );
      await deviceNetwork({ type: 'power', action });
      setSent(action);
      setAction(null);
    } catch (cause) {
      setError(friendlyError(cause, 'change device power'));
    } finally {
      setBusy(false);
    }
  }
  const disabled =
    !connected ||
    !state?.available ||
    !state.capabilities?.guarded_power ||
    !!state.pending ||
    busy ||
    Boolean(sent);
  return (
    <section aria-label="Device power">
      <DevicePowerView
        action={action}
        busy={busy}
        disabled={disabled}
        error={error}
        onRequest={setAction}
        onCancel={() => {
          setAction(null);
          onAnswered?.();
        }}
        onConfirm={() => {
          onAnswered?.();
          void confirm();
        }}
        notice={
          <>
            {!state && !readError && (
              <Caption role="status">Reading device controls…</Caption>
            )}
            {readError && (
              <div className="space-y-2">
                <p role="alert">{readError}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setReadError('');
                    setRefresh((value) => value + 1);
                  }}
                >
                  <ArrowClockwise aria-hidden="true" /> Retry device controls
                </Button>
              </div>
            )}
            {state?.available && !state.capabilities?.guarded_power && (
              <p role="status">
                Restart and shutdown need a device-service update on this unit.
                The installed service does not support these power controls.
              </p>
            )}
            {state?.pending && (
              <p role="status">Finish the pending network change first.</p>
            )}
            {state && !state.available && (
              <p role="status">
                Device power is unavailable on this installation.
              </p>
            )}
            {sent && <PowerReceipt action={sent} />}
          </>
        }
      />
    </section>
  );
}
