import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowsClockwise,
  FloppyDisk,
  Play,
} from '@phosphor-icons/react';
import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@oxidal/design-system/components/button';
import { ActionRow } from '@oxidal/design-system/components/form-layout';
import { Caption } from '@oxidal/design-system/components/text';
import { useMedia } from '@oxidal/design-system/lib/use-media';
import { BarSlotContext } from '@oxidal/design-system/patterns/dock-context';
import { RigHeading } from '@oxidal/design-system/patterns/rig-heading';
import { PerformButton } from '@oxidal/design-system/patterns/rig-top-bar';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import type { RigAudioState } from '../../api';
import { setPresetChooser } from '../../commandStore';
import { WAITING_FOR_DEVICE } from '../../lib/deviceWait';
import { requestMidiAssignments } from '../../midiNavigation';
import { choiceKey } from '../../presetChoices';
import { RigPresetSelector } from '../../RigPresetSelector';
import { TunerButton } from '../../TunerButton';
import { StageControls } from '../stage/StageControls';
import { rigBusy, rigLocked } from './mixedRigViewModel';
import { usePresetSlot } from './PresetSlot';
import { RigHeaderDuplicate } from './RigHeaderDuplicate';
import { historyShortcut } from './rigHistory';
import { RigPresetPanel } from './RigPresetPanel';
import type { RigViewProps } from './useMixedRigSession';

/**
 * Rig header: preset selector, Perform, Save a copy, Duplicate, Undo and Redo,
 * Tuner, preset actions and audio stop/resume, then the switching,
 * copy-on-edit, unsaved-edit and discard prompts and the audio status line.
 * Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z step through this session's edits, except
 * while typing in a text field.
 * @see docs/interface.md
 */
export function RigHeader({ rig, vm }: RigViewProps) {
  const waiting = rigBusy(vm, rig);
  const { redoTarget, setStepping, stepHistory, stepping, undoTarget } = rig;
  const drafts = vm.draftCount;
  const [discardOpening, setDiscardOpening] = useState<RigAudioState | null>(
    null,
  );
  // Scene updates belong to this version; Save or discard them first.
  const historyBlocked = waiting || !rig.connected || drafts > 0;
  const canUndo = !!undoTarget && !historyBlocked;
  const canRedo = !!redoTarget && !historyBlocked;
  const shortcut = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    shortcut.current = (event) => {
      const which = historyShortcut(event);
      if (!which) return;
      const step = which === 'undo' ? -1 : 1;
      if (!(step < 0 ? canUndo : canRedo)) return;
      event.preventDefault();
      void stepHistory(step);
    };
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => shortcut.current(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const historyTitle = (action: 'Undo' | 'Redo', keys: string) =>
    drafts
      ? 'Save or discard your scene updates first'
      : `${action} ${action === 'Undo' ? 'the last change' : 'the change you undid'} (${keys})`;
  const {
    actionsOpen,
    busy,
    choose,
    command,
    connected,
    copyOnEdit,
    discarding,
    edit,
    eqBusy,
    matching,
    picker,
    resolveMixedCopy,
    revision,
    setActionsOpen,
    setDiscarding,
    setError,
    setName,
    setPerforming,
    setSaveOpening,
    setUnsaved,
    switching,
    unsaved,
  } = rig;
  const { changed, disabled, draftCount, performSwitching, running, state } =
    vm;
  // The dock's Set list tool, while it is open.
  const presetSlot = usePresetSlot();
  // The one search plays a preset through this screen, with its unsaved-edit checks.
  const chooseLatest = useRef(choose);
  useEffect(() => {
    chooseLatest.current = choose;
  });
  useEffect(() => {
    setPresetChooser((c) => {
      void chooseLatest.current(c);
    });
    return () => setPresetChooser(null);
  }, []);
  const chooseFromStopped =
    state.phase === 'stopped' &&
    !!state.configured &&
    !state.waiting_for_device &&
    connected &&
    !busy &&
    !eqBusy &&
    !rig.readError &&
    !rigLocked(rig) &&
    !switching;
  // With the floating capsule, Perform sits beside the preset in the capsule.
  const inCapsule = !!useContext(BarSlotContext)?.capsule;
  const phone = useMedia('(max-width: 47.99rem)');
  // The shared Perform button, as Storybook's capsule draws it: the
  // capsule's height, only its sign on a phone.
  const performButton = (
    <PerformButton
      size={inCapsule ? 'xs' : 'sm'}
      compact={phone}
      label="Perform view"
      disabled={waiting}
      onPerform={() => setPerforming(true)}
    />
  );
  return (
    <>
      <RigHeading
        playing={running}
        identity={
          <RigPresetSelector
            heading
            phase={state.phase}
            current={{
              key: revision
                ? choiceKey({
                    kind: 'scenes',
                    revision,
                  })
                : '',
              name: matching?.manifest.name,
              modified: !!changed,
              refresh: revision,
            }}
            disabled={(waiting && !chooseFromStopped) || !!copyOnEdit}
            onSelect={(choice) => void choose(choice)}
          />
        }
        primary={inCapsule ? performButton : undefined}
      >
        {/* With the floating capsule, Mute is in the capsule and Protect in its ☰ menu. */}
        {!inCapsule && <StageControls connected={connected} compact grouped />}
        {(canUndo || canRedo) && (
          <div role="group" aria-label="Edit history" className="flex">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Undo edit"
              title={historyTitle('Undo', '⌘Z or Ctrl+Z')}
              disabled={!canUndo}
              onClick={() => void stepHistory(-1)}
            >
              <ArrowCounterClockwise aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Redo edit"
              title={historyTitle('Redo', '⇧⌘Z or Ctrl+Shift+Z')}
              disabled={!canRedo}
              onClick={() => void stepHistory(1)}
            >
              <ArrowClockwise aria-hidden="true" />
            </Button>
          </div>
        )}
        {/* Save is on the chain bar; Save a copy stays in More. */}
        {!inCapsule && performButton}
        <div role="group" aria-label="Rig tools" className="flex items-center">
          <TunerButton disabled={!running} compact />
          <Button
            variant="ghost"
            size="sm"
            aria-label="More preset actions"
            aria-haspopup="dialog"
            title="More preset actions"
            disabled={waiting}
            onClick={() => setActionsOpen(true)}
          >
            More
          </Button>
          {actionsOpen && (
            <AdjustmentDialog
              title="Preset actions"
              onCancel={() => setActionsOpen(false)}
            >
              <div className="grid divide-y divide-border [&>button]:h-auto [&>button]:justify-start [&>button]:rounded-none [&>button]:py-2.5 [&>button]:text-left [&>button]:whitespace-normal">
                <Button
                  variant="ghost"
                  type="button"
                  title={
                    draftCount
                      ? 'Save or discard your scene updates first'
                      : undefined
                  }
                  disabled={
                    disabled ||
                    !matching ||
                    !!edit ||
                    !!picker ||
                    !!state.save?.running ||
                    draftCount > 0
                  }
                  onClick={() => {
                    setActionsOpen(false);
                    setName(matching!.manifest.name);
                    setSaveOpening(state);
                    setError('');
                  }}
                >
                  <FloppyDisk aria-hidden="true" />
                  <span className="grid gap-0.5">
                    Save a copy…
                    <Caption as="span" className="font-normal">
                      Keep this sound under a name, changed or not
                    </Caption>
                  </span>
                </Button>
                <RigHeaderDuplicate
                  entry={revision ? { kind: 'rig', id: revision } : null}
                  connected={connected}
                  disabled={waiting}
                  changed={!!changed}
                />
                <Button
                  variant="ghost"
                  aria-label="Undo"
                  aria-keyshortcuts="Control+Z Meta+Z"
                  title={historyTitle('Undo', '⌘Z or Ctrl+Z')}
                  disabled={!canUndo}
                  onClick={() => {
                    setActionsOpen(false);
                    void stepHistory(-1);
                  }}
                >
                  <ArrowCounterClockwise aria-hidden="true" />
                  Undo
                </Button>
                <Button
                  variant="ghost"
                  aria-label="Redo"
                  aria-keyshortcuts="Shift+Control+Z Shift+Meta+Z Control+Y"
                  title={historyTitle('Redo', '⇧⌘Z or Ctrl+Shift+Z')}
                  disabled={!canRedo}
                  onClick={() => {
                    setActionsOpen(false);
                    void stepHistory(1);
                  }}
                >
                  <ArrowClockwise aria-hidden="true" />
                  Redo
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={
                    !changed ||
                    disabled ||
                    waiting ||
                    !!draftCount ||
                    !!copyOnEdit ||
                    !!state.save?.running ||
                    !!state.control?.scene_transitioning
                  }
                  onClick={() => {
                    setActionsOpen(false);
                    setDiscardOpening(state);
                  }}
                >
                  <span className="grid gap-0.5">
                    Discard live edits…
                    <Caption as="span" className="font-normal">
                      Reload this saved preset version
                    </Caption>
                  </span>
                </Button>
                {state.device_owned && (
                  <Button
                    variant="ghost"
                    type="button"
                    aria-label={
                      state.phase === 'starting'
                        ? 'Cancel loading'
                        : 'Stop audio'
                    }
                    disabled={
                      !connected || busy || eqBusy || !!edit || !!picker
                    }
                    onClick={() => {
                      setActionsOpen(false);
                      void command({ kind: 'stop' });
                    }}
                  >
                    <span className="grid gap-0.5">
                      {state.phase === 'starting'
                        ? 'Cancel loading'
                        : 'Stop audio'}
                      <Caption as="span" className="font-normal">
                        Silence the device; Resume starts it again
                      </Caption>
                    </span>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    setActionsOpen(false);
                    requestMidiAssignments();
                  }}
                >
                  <span className="grid gap-0.5">
                    MIDI assignments…
                    <Caption as="span" className="font-normal">
                      Assign this preset&apos;s scenes, switches and controls
                    </Caption>
                  </span>
                </Button>
              </div>
            </AdjustmentDialog>
          )}
          {state.device_owned && state.phase === 'starting' && (
            <Button
              variant="ghost"
              size="sm"
              title="Cancel loading"
              aria-label="Cancel loading"
              disabled={!connected || busy || eqBusy || !!edit || !!picker}
              onClick={() => void command({ kind: 'stop' })}
            >
              Cancel
            </Button>
          )}
          {!state.device_owned && (
            <Button
              aria-label="Resume audio"
              disabled={!connected || busy}
              onClick={() => void command({ kind: 'restart' })}
            >
              <Play aria-hidden="true" />
              <span>Resume</span>
            </Button>
          )}
        </div>
      </RigHeading>
      {presetSlot &&
        createPortal(
          <RigPresetPanel
            playingKey={revision ? choiceKey({ kind: 'scenes', revision }) : ''}
            refresh={revision}
            disabled={(waiting && !chooseFromStopped) || !!copyOnEdit}
            onSelect={(choice) => void choose(choice)}
          />,
          presetSlot,
        )}
      {performSwitching && (
        <div
          data-rig-switching
          className="flex min-h-48 items-center justify-center gap-3 rounded-md border border-border bg-card p-6 [&_small]:text-muted-foreground [&>span]:grid [&>span]:gap-0.5 [&>svg]:size-6 motion-safe:[&>svg]:animate-spin [[data-display=epaper]_&>svg]:animate-none"
          role="status"
          aria-live="polite"
        >
          <ArrowsClockwise aria-hidden="true" />
          <span>
            <strong>Preparing preset…</strong>
            <small>The chain will appear when its audio state is ready.</small>
          </span>
        </div>
      )}
      {copyOnEdit && (
        <div
          className="rounded-md border border-border bg-card p-3"
          role="status"
        >
          <strong>Editing a copy of {copyOnEdit.sourceName}</strong>
          <Caption>
            Your first change created this preset in Mine. The original is
            unchanged.
          </Caption>
          <ActionRow>
            <Button disabled={busy} onClick={() => void resolveMixedCopy(true)}>
              Keep copy
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void resolveMixedCopy(false)}
            >
              Discard copy
            </Button>
          </ActionRow>
        </div>
      )}
      {unsaved && (
        <AdjustmentDialog
          title="Keep your edits?"
          onCancel={() => setUnsaved(null)}
        >
          <p>
            This changes the preset&apos;s effects by building a new version of
            it. Edits you made to the blocks inside its TONE3000 chains and have
            not saved are not carried over. Save a copy first to keep them.
          </p>
          <ActionRow>
            <Button variant="outline" onClick={() => setUnsaved(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const run = unsaved;
                setUnsaved(null);
                void run();
              }}
            >
              Continue
            </Button>
          </ActionRow>
        </AdjustmentDialog>
      )}
      {stepping && (
        <AdjustmentDialog
          title={stepping < 0 ? 'Undo the last change?' : 'Redo the change?'}
          onCancel={() => setStepping(null)}
        >
          <p>
            {matching?.manifest.name ?? 'This preset'} has changes that are not
            saved. {stepping < 0 ? 'Undo' : 'Redo'} plays the preset as it was{' '}
            {stepping < 0 ? 'before your last edit' : 'after that edit'}, so
            those changes are not kept. Save a copy first to keep them.
          </p>
          <ActionRow>
            <Button variant="outline" onClick={() => setStepping(null)}>
              Cancel
            </Button>
            <Button onClick={() => void stepHistory(stepping, true)}>
              {stepping < 0 ? 'Undo' : 'Redo'}
            </Button>
          </ActionRow>
        </AdjustmentDialog>
      )}
      {discardOpening && (
        <AdjustmentDialog
          title="Discard live edits?"
          onCancel={() => setDiscardOpening(null)}
        >
          <p>
            Reload the saved version of{' '}
            {matching?.manifest.name ?? 'this preset'}. Audio will restart and
            release any caught loop.
          </p>
          <ActionRow>
            <Button variant="outline" onClick={() => setDiscardOpening(null)}>
              Keep editing
            </Button>
            <Button
              disabled={
                waiting ||
                disabled ||
                !!draftCount ||
                !!state.save?.running ||
                state.session !== discardOpening.session ||
                state.revision !== discardOpening.revision
              }
              onClick={() => {
                setDiscardOpening(null);
                void command(
                  { kind: 'discard_changes' },
                  false,
                  discardOpening,
                );
              }}
            >
              Discard edits and reload
            </Button>
          </ActionRow>
          {(state.session !== discardOpening.session ||
            state.revision !== discardOpening.revision) && (
            <p role="status">
              The rig changed. Reopen Discard to review the current version.
            </p>
          )}
        </AdjustmentDialog>
      )}
      {discarding && (
        <AdjustmentDialog
          title="Discard unsaved changes?"
          onCancel={() => setDiscarding(null)}
        >
          <p>
            {matching?.manifest.name ?? 'This preset'} has unsaved changes.
            Opening {discarding.name} discards them, because only one preset
            with scenes keeps its edits at a time. Keep both ready to switch
            without losing either.
          </p>
          <ActionRow>
            <Button variant="outline" onClick={() => setDiscarding(null)}>
              Keep editing
            </Button>
            <Button onClick={() => void choose(discarding, true)}>
              Discard and open
            </Button>
          </ActionRow>
        </AdjustmentDialog>
      )}
      {(state.phase !== 'running' || switching) && (
        <Caption role="status">
          {switching
            ? 'Changing preset…'
            : state.waiting_for_device
              ? WAITING_FOR_DEVICE
              : state.phase === 'starting'
                ? 'Preparing sound…'
                : state.phase === 'failed'
                  ? 'Audio needs attention'
                  : 'Audio stopped'}
        </Caption>
      )}
    </>
  );
}
