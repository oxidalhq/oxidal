import { AdjustmentDialog } from '../../AdjustmentDialog';
import {
  ArrowsClockwise,
  DotsThree,
  FloppyDisk,
  Lightning,
  Play,
  Stop,
} from '@phosphor-icons/react';
import { Button } from '../../components/ui/button';
import { RigPresetSelector } from '../../RigPresetSelector';
import { StageControls } from '../stage/StageControls';
import { TunerButton } from '../../TunerButton';
import { WAITING_FOR_DEVICE } from '../../lib/deviceWait';
import { choiceKey } from '../../presetChoices';
import { requestMidiAssignments } from '../../midiNavigation';
import type { RigViewProps } from './useMixedRigSession';

/**
 * Rig header: preset selector, Perform, Save, Tuner, preset actions and
 * audio stop/resume, then the switching, copy-on-edit, unsaved-edit and
 * discard prompts and the audio status line.
 * @see docs/interface.md
 */
export function RigHeader({ rig, vm }: RigViewProps) {
  const {
    actionsOpen,
    busy,
    choose,
    command,
    connected,
    copyOnEdit,
    discarding,
    edit,
    editing,
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
  return (
    <>
      <div className="rig-performance-header">
        <RigPresetSelector
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
          disabled={
            disabled || busy || switching || !!edit || !!picker || !!copyOnEdit
          }
          onSelect={(choice) => void choose(choice)}
        />
        <StageControls connected={connected} compact />
        <Button
          aria-label="Perform view"
          title="Scene pads and effect switches for playing live"
          disabled={!running || disabled || !!edit || editing}
          onClick={() => setPerforming(true)}
        >
          <Lightning aria-hidden="true" />
          <span className="phone-hidden">Perform</span>
        </Button>
        <Button
          variant="outline"
          aria-label="Save copy"
          title={
            draftCount ? 'Save or discard your scene updates first' : undefined
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
            setName(matching!.manifest.name);
            setSaveOpening(state);
            setError('');
          }}
        >
          <FloppyDisk aria-hidden="true" />
          <span className="phone-hidden">
            {state.save?.running ? 'Saving…' : 'Save'}
          </span>
        </Button>
        <TunerButton disabled={!running} />
        <Button
          variant="outline"
          aria-label="Preset actions"
          aria-haspopup="dialog"
          title="MIDI assignments"
          disabled={disabled || busy || switching || !!edit || !!picker}
          onClick={() => setActionsOpen(true)}
        >
          <DotsThree aria-hidden="true" weight="bold" />
        </Button>
        {actionsOpen && (
          <AdjustmentDialog
            title="Preset actions"
            onCancel={() => setActionsOpen(false)}
          >
            <div className="menu-list">
              <button
                type="button"
                onClick={() => {
                  setActionsOpen(false);
                  requestMidiAssignments();
                }}
              >
                MIDI assignments…
                <span className="caption">
                  Assign this preset&apos;s scenes, switches and controls
                </span>
              </button>
            </div>
          </AdjustmentDialog>
        )}
        {state.device_owned ? (
          <Button
            variant="outline"
            aria-label={
              state.phase === 'starting' ? 'Cancel loading' : 'Stop audio'
            }
            disabled={!connected || busy || eqBusy || !!edit || !!picker}
            onClick={() => void command({ kind: 'stop' })}
          >
            <Stop aria-hidden="true" />
            <span className="phone-hidden">
              {state.phase === 'starting' ? 'Cancel' : 'Stop'}
            </span>
          </Button>
        ) : (
          <Button
            aria-label="Resume audio"
            disabled={!connected || busy}
            onClick={() => void command({ kind: 'restart' })}
          >
            <Play aria-hidden="true" />
            <span className="phone-hidden">Resume</span>
          </Button>
        )}
      </div>
      {performSwitching && (
        <div className="rig-switching" role="status" aria-live="polite">
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
          <p className="caption">
            Your first change created this preset in Mine. The original is
            unchanged.
          </p>
          <div className="action-row">
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
          </div>
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
          <div className="action-row">
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
          </div>
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
          <div className="action-row">
            <Button variant="outline" onClick={() => setDiscarding(null)}>
              Keep editing
            </Button>
            <Button onClick={() => void choose(discarding, true)}>
              Discard and open
            </Button>
          </div>
        </AdjustmentDialog>
      )}
      {(state.phase !== 'running' || switching) && (
        <p role="status" className="caption">
          {switching
            ? 'Changing preset…'
            : state.waiting_for_device
              ? WAITING_FOR_DEVICE
              : state.phase === 'starting'
                ? 'Preparing sound…'
                : state.phase === 'failed'
                  ? 'Audio needs attention'
                  : 'Audio stopped'}
        </p>
      )}
    </>
  );
}
