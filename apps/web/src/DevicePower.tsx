import { useEffect, useState } from 'react';
import { ArrowClockwise, Power } from '@phosphor-icons/react';
import { deviceNetwork, type NetworkState } from './api';
import { Button } from './components/ui/button';
import { AdjustmentDialog } from './AdjustmentDialog';

/** Device power is separate from the audio transport and always confirmed. */
export function DevicePower({ connected }: { connected: boolean }) {
  const [state, setState] = useState<NetworkState | null>(null);
  const [action, setAction] = useState<'reboot' | 'shutdown' | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void deviceNetwork()
      .then((next) => {
        if (active) setState(next);
      })
      .catch(() => {
        if (active)
          setError(
            'Device controls unavailable. Reopen this section to retry.',
          );
      });
    return () => {
      active = false;
    };
  }, []);
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
      await deviceNetwork({ type: 'power', action });
      setSent(true);
      setAction(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  const disabled =
    !connected || !state?.available || !!state.pending || busy || sent;
  return (
    <section className="panel space-y-3" aria-label="Device power">
      <h2>Device power</h2>
      <p className="caption">
        Save your edits first. These controls stop audio and close the
        connection.
      </p>
      <div className="action-row">
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => setAction('reboot')}
        >
          <ArrowClockwise aria-hidden="true" />
          Restart device
        </Button>
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => setAction('shutdown')}
        >
          <Power aria-hidden="true" />
          Shut down device
        </Button>
      </div>
      {state?.pending && (
        <p role="status">Finish the pending network change first.</p>
      )}
      {state && !state.available && (
        <p role="status">Device power is unavailable on this installation.</p>
      )}
      {sent && (
        <p role="status">
          Request accepted. Restart reconnects when ready; after shutdown, wait
          for the device to power down before unplugging it.
        </p>
      )}
      {error && !action && <p role="alert">{error}</p>}
      {action && (
        <AdjustmentDialog
          title={action === 'reboot' ? 'Restart device?' : 'Shut down device?'}
          onCancel={() => {
            if (!busy) setAction(null);
          }}
        >
          <p>
            Audio will stop. Save any edits you want to keep before continuing.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="action-row">
            <Button disabled={disabled} onClick={() => void confirm()}>
              Confirm {action === 'reboot' ? 'restart' : 'shutdown'}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setAction(null)}
            >
              Cancel
            </Button>
          </div>
        </AdjustmentDialog>
      )}
    </section>
  );
}
