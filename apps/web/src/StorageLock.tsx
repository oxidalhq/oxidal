import { RecoveryAction } from './components/ui/failure';
import { useFailure } from './lib/useFailure';
import { friendlyError } from './lib/friendlyError';
import { useState } from 'react';
import {
  ArrowClockwise,
  LockSimple,
  LockSimpleOpen,
} from '@phosphor-icons/react';
import { changeStorage, deviceNetwork, type StorageState } from './api';
import { Button } from './components/ui/button';
import { AdjustmentDialog } from './AdjustmentDialog';

export function StorageLock({
  connected,
  state,
  onState,
}: {
  connected: boolean;
  state: StorageState | null;
  onState: (state: StorageState) => void;
}) {
  const { failure: recoverFailure, fail: recoverFail } = useFailure();
  const [busy, setBusy] = useState(false);
  const [confirmReboot, setConfirmReboot] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function choose(mode: 'unlocked' | 'locked') {
    if (!state?.available || busy || state.next_boot === mode) return;
    setBusy(true);
    setError('');
    try {
      onState(await changeStorage({ mode }));
    } catch (cause) {
      setError(friendlyError(cause, 'change storage protection'));
      recoverFail(cause, 'change storage protection', () => void choose(mode));
    } finally {
      setBusy(false);
    }
  }

  async function reboot() {
    if (busy || !state?.reboot_required) return;
    setBusy(true);
    setError('');
    try {
      const network = await deviceNetwork();
      if (!network.available || network.pending)
        throw new Error(
          'Finish the pending network change before restarting the device.',
        );
      await deviceNetwork({ type: 'power', action: 'reboot' });
      setSent(true);
      setConfirmReboot(false);
    } catch (cause) {
      setError(friendlyError(cause, 'change storage protection'));
    } finally {
      setBusy(false);
    }
  }

  const current = state?.current;
  const next = state?.next_boot;
  return (
    <section className="panel space-y-4" aria-label="Storage lock">
      <div>
        <h2>System storage</h2>
        <p className="caption mt-1 max-w-2xl">
          Locking protects system files at the next boot. Presets and unit data
          stay on the writable data partition. This never remounts a playing
          system.
        </p>
      </div>

      {state ? (
        <div className="storage-current" data-mode={current ?? 'unknown'}>
          {current === 'locked' ? (
            <LockSimple aria-hidden="true" />
          ) : (
            <LockSimpleOpen aria-hidden="true" />
          )}
          <span>
            <strong>
              {current === 'locked'
                ? 'Locked now'
                : current === 'unlocked'
                  ? 'Unlocked now'
                  : 'Current state unknown'}
            </strong>
            <small>
              {current === 'locked'
                ? 'System packages cannot change.'
                : current === 'unlocked'
                  ? 'System updates and effect packs are allowed.'
                  : 'No storage change is available.'}
            </small>
          </span>
        </div>
      ) : (
        <p role="status">Reading storage state…</p>
      )}

      <div
        className="storage-choice"
        role="group"
        aria-label="Mode at next boot"
      >
        <Button
          variant="outline"
          aria-pressed={next === 'unlocked'}
          disabled={!connected || !state?.available || busy || sent}
          onClick={() => void choose('unlocked')}
        >
          <LockSimpleOpen aria-hidden="true" />
          <span>
            <strong>Unlocked</strong>
            <small>Updates and installs work</small>
          </span>
        </Button>
        <Button
          variant="outline"
          aria-pressed={next === 'locked'}
          disabled={!connected || !state?.available || busy || sent}
          onClick={() => void choose('locked')}
        >
          <LockSimple aria-hidden="true" />
          <span>
            <strong>Locked</strong>
            <small>System files read-only</small>
          </span>
        </Button>
      </div>

      {state?.message && (
        <p role="status" className="caption">
          {state.message}
        </p>
      )}
      {state?.reboot_required && !sent && (
        <div className="storage-restart rounded-md bg-muted px-3 py-3">
          <p>
            <strong>
              {next === 'locked' ? 'Locked' : 'Unlocked'} is ready for the next
              boot.
            </strong>{' '}
            Restart when you are ready; audio will stop and the browser will
            reconnect afterward.
          </p>
          <Button
            variant="outline"
            disabled={!connected || busy}
            onClick={() => setConfirmReboot(true)}
          >
            <ArrowClockwise aria-hidden="true" /> Reboot now
          </Button>
        </div>
      )}
      {sent && (
        <p role="status">
          Restart requested. Oxidal will reconnect in the selected storage mode.
        </p>
      )}
      {error && !confirmReboot && <p role="alert">{error}</p>}
      {error && <RecoveryAction failure={recoverFailure} />}

      {confirmReboot && (
        <AdjustmentDialog
          title={`Restart into ${next === 'locked' ? 'Locked' : 'Unlocked'} mode?`}
          onCancel={() => {
            if (!busy) setConfirmReboot(false);
          }}
        >
          <p>
            Audio will stop. Save any edits you want to keep before restarting.
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="action-row">
            <Button disabled={busy} onClick={() => void reboot()}>
              Confirm restart
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmReboot(false)}
            >
              Cancel
            </Button>
          </div>
        </AdjustmentDialog>
      )}
    </section>
  );
}
