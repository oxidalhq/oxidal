import {
  LockSimple,
  LockSimpleOpen,
  SpeakerSlash,
} from '@phosphor-icons/react';

import { Button } from '@oxidal/design-system/components/button';
import { ActionRow } from '@oxidal/design-system/components/form-layout';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import { useOutputMute, useProtect } from './stageState';

/**
 * Mute and Protect, always one tap away on Rig and Perform (7.22). States are
 * read back from the device: Muted and Protect on are never shown on hope.
 * Turning Protect off asks first; turning it on does not. With the floating
 * capsule, Mute sits in the capsule and Protect in its ☰ menu instead.
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
    compact && !grouped ? <span className="max-sm:sr-only">{text}</span> : text;
  const mute = useOutputMute(connected);
  const lock = useProtect(connected);
  const { muted } = mute;
  const { protect } = lock;
  const busy = mute.busy || lock.busy;
  const error = mute.error || lock.error;
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
        size={compact || grouped ? 'sm' : 'md'}
        className={grouped ? 'min-w-touch px-2' : undefined}
        aria-label={muted ? 'Muted' : 'Mute'}
        title={muted ? 'Unmute output' : 'Mute output'}
        aria-pressed={!!muted}
        disabled={mute.disabled || busy}
        onClick={mute.toggle}
      >
        {!grouped && <SpeakerSlash aria-hidden="true" />}
        {label(muted ? 'Muted' : 'Mute')}
      </Button>
      <Button
        variant={protect ? 'default' : grouped ? 'ghost' : 'outline'}
        size={compact || grouped ? 'sm' : 'md'}
        className={grouped ? 'min-w-touch px-2' : undefined}
        aria-label={protect ? 'Protected' : 'Protect'}
        aria-pressed={!!protect}
        disabled={lock.disabled || busy}
        title={
          protect
            ? 'Protect is on: edits and audio changes are blocked'
            : 'Turn on Protect to block edits while you play'
        }
        onClick={lock.request}
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
      {lock.confirmOff && (
        <ProtectOffDialog onKeep={lock.keepOn} onTurnOff={lock.turnOff} />
      )}
    </div>
  );
}

/** Turning Protect off always asks first. */
export function ProtectOffDialog({
  onKeep,
  onTurnOff,
}: {
  onKeep: () => void;
  onTurnOff: () => void;
}) {
  return (
    <AdjustmentDialog title="Turn Protect off?" onCancel={onKeep}>
      <p>
        Edits, audio setup and presets that are not ready will work again, from
        every browser and MIDI.
      </p>
      <ActionRow>
        <Button variant="outline" onClick={onKeep}>
          Keep Protect on
        </Button>
        <Button onClick={onTurnOff}>Turn off</Button>
      </ActionRow>
    </AdjustmentDialog>
  );
}
