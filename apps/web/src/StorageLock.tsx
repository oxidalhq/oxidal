import { ArrowClockwise } from '@phosphor-icons/react';
import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Loading } from '@oxidal/design-system/components/states';
import { StorageLock as StorageLockView } from '@oxidal/design-system/patterns/device-flows';

import { AdjustmentDialog } from './AdjustmentDialog';
import { changeStorage, deviceNetwork, type StorageState } from './api';
import { RecoveryAction } from './FailureNotice';
import { friendlyError } from './lib/friendlyError';
import { useFailure } from './lib/useFailure';

/** Next-boot storage selection with independently confirmed power.
 * @see docs/device-service.md
 */
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
    if (busy || !state?.reboot_required || !state.next_boot) return;
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
    <section aria-label="Storage lock">
      <StorageLockView
        current={current ?? null}
        nextBoot={next ?? null}
        disabled={!connected || !state?.available || busy || sent}
        onChange={(mode) => void choose(mode)}
        notice={
          <>
            {!state && <Loading label="Reading storage state…" />}
            {state?.message && (
              <p role="status" className="caption">
                {state.message}
              </p>
            )}
          </>
        }
        restart={
          <>
            {state?.reboot_required && next && !sent && (
              <div className="grid gap-3 rounded-md bg-muted px-3 py-3">
                <p>
                  <strong>
                    {next === 'locked' ? 'Locked' : 'Unlocked'} is ready for the
                    next boot.
                  </strong>{' '}
                  Restart when you are ready; audio will stop and the browser
                  will reconnect afterward.
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
          </>
        }
      />
      {sent && (
        <p role="status">
          Restart requested. Oxidal will reconnect in the selected storage mode.
        </p>
      )}
      {error && !confirmReboot && <p role="alert">{error}</p>}
      {error && <RecoveryAction failure={recoverFailure} />}

      {confirmReboot && next && (
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
