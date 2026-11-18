import { ArrowClockwise } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { DevicePower as DevicePowerView } from '@oxidal/design-system/patterns/device-power';

import { deviceNetwork, type NetworkState } from './api';
import { friendlyError } from './lib/friendlyError';

/** Device power is separate from the audio transport and always confirmed.
 * @see docs/device-service.md
 */
export function DevicePower({ connected }: { connected: boolean }) {
  const [state, setState] = useState<NetworkState | null>(null);
  const [action, setAction] = useState<'reboot' | 'shutdown' | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
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
      setSent(true);
      setAction(null);
    } catch (cause) {
      setError(friendlyError(cause, 'change device power'));
    } finally {
      setBusy(false);
    }
  }
  const disabled =
    !connected || !state?.available || !!state.pending || busy || sent;
  return (
    <section aria-label="Device power">
      <DevicePowerView
        action={action}
        busy={busy}
        disabled={disabled}
        error={error}
        onRequest={setAction}
        onCancel={() => setAction(null)}
        onConfirm={() => void confirm()}
        notice={
          <>
            {!state && !readError && (
              <p role="status" className="caption">
                Reading device controls…
              </p>
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
            {state?.pending && (
              <p role="status">Finish the pending network change first.</p>
            )}
            {state && !state.available && (
              <p role="status">
                Device power is unavailable on this installation.
              </p>
            )}
            {sent && (
              <p role="status">
                Request accepted. Restart reconnects when ready; after shutdown,
                wait for the device to power down before unplugging it.
              </p>
            )}
          </>
        }
      />
    </section>
  );
}
