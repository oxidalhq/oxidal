import { useEffect, useState } from 'react';
import {
  LockSimple,
  LockSimpleOpen,
  SpeakerSlash,
} from '@phosphor-icons/react';
import { monitoring, protectState, setProtect } from '../../api';
import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Button } from '../../components/ui/button';
import { friendlyError } from '../../lib/friendlyError';
import { setOutputMute } from './outputMute';

/**
 * Mute and Protect, always one tap away on Rig and Perform (7.22). States are
 * read back from the device: Muted and Protect on are never shown on hope.
 * Turning Protect off asks first; turning it on does not.
 * @see docs/interface.md
 */
export function StageControls({ connected }: { connected: boolean }) {
  const [protect, setProtectOn] = useState<boolean | null>(null);
  const [muted, setMuted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const read = () => {
      void protectState()
        .then((s) => alive && setProtectOn(s.on))
        .catch(() => alive && setProtectOn(null));
      void monitoring()
        .then(
          (m) =>
            alive &&
            setMuted(
              m.audio ? (m.audio.monitoring?.output_muted ?? false) : null,
            ),
        )
        .catch(() => alive && setMuted(null));
    };
    read();
    const timer = window.setInterval(read, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
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
  return (
    <div className="stage-controls" role="group" aria-label="Stage controls">
      <Button
        variant={muted ? 'destructive' : 'outline'}
        aria-pressed={!!muted}
        disabled={!connected || busy || muted === null}
        onClick={() =>
          void run(
            async () => {
              await setOutputMute(!muted);
              setMuted(!muted);
            },
            muted ? 'unmute' : 'mute',
          )
        }
      >
        <SpeakerSlash aria-hidden="true" />
        {muted ? 'Muted' : 'Mute'}
      </Button>
      <Button
        variant={protect ? 'default' : 'outline'}
        aria-pressed={!!protect}
        disabled={!connected || busy || protect === null}
        title={
          protect
            ? 'Protect is on: edits and audio changes are blocked'
            : 'Turn on Protect to block edits while you play'
        }
        onClick={() =>
          protect
            ? setConfirmOff(true)
            : void run(async () => {
                setProtectOn((await setProtect(true)).on);
              }, 'turn on Protect')
        }
      >
        {protect ? (
          <LockSimple aria-hidden="true" weight="fill" />
        ) : (
          <LockSimpleOpen aria-hidden="true" />
        )}
        {protect ? 'Protected' : 'Protect'}
      </Button>
      {error && (
        <p role="alert" className="stage-controls-error">
          {error}
        </p>
      )}
      {confirmOff && (
        <AdjustmentDialog
          title="Turn Protect off?"
          onCancel={() => setConfirmOff(false)}
        >
          <p>
            Edits, audio setup and presets that are not ready will work again,
            from every browser and MIDI.
          </p>
          <div className="action-row">
            <Button variant="outline" onClick={() => setConfirmOff(false)}>
              Keep Protect on
            </Button>
            <Button
              onClick={() => {
                setConfirmOff(false);
                void run(async () => {
                  setProtectOn((await setProtect(false)).on);
                }, 'turn off Protect');
              }}
            >
              Turn off
            </Button>
          </div>
        </AdjustmentDialog>
      )}
    </div>
  );
}
