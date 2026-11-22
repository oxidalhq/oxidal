import {
  LockSimple,
  LockSimpleOpen,
  SpeakerSlash,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { ActionRow } from '@oxidal/design-system/components/form-layout';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import { protectState, setProtect } from '../../api';
import { friendlyError } from '../../lib/friendlyError';
import { useMonitorReadings } from '../../monitorFeed';
import { setOutputMute } from './outputMute';

/**
 * Mute and Protect, always one tap away on Rig and Perform (7.22). States are
 * read back from the device: Muted and Protect on are never shown on hope.
 * Turning Protect off asks first; turning it on does not.
 * @see docs/interface.md
 */
export function StageControls({
  connected,
  compact = false,
  grouped = false,
}: {
  connected: boolean;
  /** Inside a Rig header (7.28): labels hide on phones like its other buttons. */
  compact?: boolean;
  grouped?: boolean;
}) {
  const label = (text: string) =>
    compact && !grouped ? <span className="phone-hidden">{text}</span> : text;
  const [protect, setProtectOn] = useState<boolean | null>(null);
  const [muted, setMuted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [error, setError] = useState('');
  useMonitorReadings(5000, (reading) => {
    const value = reading.snapshot?.audio?.monitoring?.output_muted;
    setMuted(
      !reading.disconnected && typeof value === 'boolean' ? value : null,
    );
  });
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
    <div
      className="mb-2 flex flex-wrap items-center justify-end gap-2 data-[compact]:m-0 data-[compact]:flex-none data-[compact]:flex-nowrap data-[grouped]:gap-0 data-[grouped]:rounded-lg data-[grouped]:bg-secondary"
      data-grouped={grouped || undefined}
      data-compact={compact || undefined}
      role="group"
      aria-label="Stage controls"
    >
      <Button
        variant={muted ? 'destructive' : grouped ? 'ghost' : 'outline'}
        size={grouped ? 'sm' : 'md'}
        className={grouped ? 'min-w-touch px-2' : undefined}
        aria-label={muted ? 'Muted' : 'Mute'}
        title={muted ? 'Unmute output' : 'Mute output'}
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
        {!grouped && <SpeakerSlash aria-hidden="true" />}
        {label(muted ? 'Muted' : 'Mute')}
      </Button>
      <Button
        variant={protect ? 'default' : grouped ? 'ghost' : 'outline'}
        size={grouped ? 'sm' : 'md'}
        className={grouped ? 'min-w-touch px-2' : undefined}
        aria-label={protect ? 'Protected' : 'Protect'}
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
        {!grouped &&
          (protect ? (
            <LockSimple aria-hidden="true" weight="fill" />
          ) : (
            <LockSimpleOpen aria-hidden="true" />
          ))}
        {label(protect ? 'Protected' : 'Protect')}
      </Button>
      {error && (
        <p role="alert" className="m-0 basis-full text-right text-destructive">
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
          <ActionRow>
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
          </ActionRow>
        </AdjustmentDialog>
      )}
    </div>
  );
}
