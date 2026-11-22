import {
  CaretDown,
  DotsThree,
  Lightning,
  PencilSimple,
  Plus,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@oxidal/design-system/components/dropdown-menu';
import { RelativeAdjustment as TouchAdjust } from '@oxidal/design-system/components/number-field';
import { InlineFader, Slider } from '@oxidal/design-system/components/slider';
import { Switch } from '@oxidal/design-system/components/switch';
import { Toggle } from '@oxidal/design-system/components/toggle';
import { glyphFor } from '@oxidal/design-system/lib/block-glyphs';
import { shortValue } from '@oxidal/design-system/lib/preview';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';
import { RigAudioUnavailable } from '@oxidal/design-system/patterns/rig-audio-unavailable';
import { RigHeading } from '@oxidal/design-system/patterns/rig-heading';
import {
  BlockEditor,
  type BlockModel,
} from '@oxidal/design-system/widgets/block-editor';
import { SourceCard } from '@oxidal/design-system/widgets/block-source';
import { RouteView } from '@oxidal/design-system/widgets/route-view';
import {
  BlockPanelControl,
  SelectedBlockPanel,
} from '@oxidal/design-system/widgets/selected-block-panel';

import { AddBlockChooser } from './AddBlockChooser';
import { AdjustmentDialog } from './AdjustmentDialog';
import {
  artworkPath,
  type AssetArtwork,
  type AudioAction,
  type AudioState,
  type Lv2Plugin,
  playbackCommand,
  playbackState,
  presetArtwork,
  publishRig,
  removalPreview,
  removePreset,
  rigLibrary,
  rigNativeSources,
} from './api';
import { ArtworkDeck } from './AssetArtwork';
import { BlockBandGains } from './BlockBandGains';
import { BoostControl } from './BoostControl';
import { ChainView } from './ChainView';
import { EditQueue } from './editQueue';
import { SaveSoundVersion } from './features/library/SaveSoundVersion';
import { StageControls } from './features/stage/StageControls';
import { GearIcon } from './GearIcon';
import type { VersionTarget } from './generated/contract';
import { GuitarPicker } from './GuitarSettings';
import { LevelMatch } from './LevelMatch';
import { WAITING_FOR_DEVICE } from './lib/deviceWait';
import { errorDetails, friendlyError } from './lib/friendlyError';
import { gearLabel } from './lib/gearLabel';
import { LiveEq } from './LiveEq';
import { MasterLevel } from './MasterLevel';
import { requestMidiAssignments } from './midiNavigation';
import { ModelPicker } from './ModelPicker';
import { NativeAuthoring } from './NativeAuthoring';
import { NativeModelStepper } from './NativeModelStepper';
import { setPerform, usePerform } from './performState';
import { PerformView } from './PerformView';
import {
  boostKey,
  choiceKey,
  playScenes,
  type PresetChoice,
  tone3000Key,
} from './presetChoices';
import { blockKind, type RigLaneVM } from './rigChain';
import {
  assertAuditionOwner,
  confirmedControlDisplay,
  type ControlGroup,
  controlGroup,
  movedBlockOrder,
  shortControlLabel,
} from './rigControls';
import { RigPresetSelector } from './RigPresetSelector';
import { MidiControls } from './SceneMidi';
import { SlotChooser } from './SlotChooser';
import { type Placement, playingTone, presetWithEffect } from './slotEffects';
import { TunerButton } from './TunerButton';
import { requestTuner } from './tunerNavigation';
import { useToneSource } from './useToneSource';
import { useWorkspaceState } from './workspaceMemory';

/** The sounding worker owns these controls; no simulator or offline editor writes. */
const blockName = (label: string) =>
  label.replace(/(?: · (?:left|right))? · enabled$/, '');

export function LiveRig({
  connected,
  onPlaying,
  onLibrary,
  onAudioSetup,
  hideInactive = false,
}: {
  connected: boolean;
  onPlaying: (name: string | null) => void;
  onLibrary: () => void;
  onAudioSetup: () => void;
  hideInactive?: boolean;
}) {
  const [state, setState] = useState<AudioState | null>(null);
  const [editingChain, setEditingChain] = useState(false);
  const [chainView, setChainView] = useState<'compact' | 'artwork'>(() => {
    try {
      return localStorage.getItem('oxidal-chain-view') === 'artwork'
        ? 'artwork'
        : 'compact';
    } catch {
      return 'compact';
    }
  });
  const [restoreOpening, setRestoreOpening] = useState<AudioState | null>(null);
  const [artwork, setArtwork] = useState<{
    id: string;
    owned: boolean;
    items: AssetArtwork[];
  } | null>(null);
  const artworkId = state?.configured?.preset_id;
  const artworkOwned = state?.configured?.owned ?? false;
  useEffect(() => {
    const abort = new AbortController();
    if (artworkId)
      void presetArtwork(artworkId, artworkOwned, abort.signal)
        .then((items) => {
          if (!abort.signal.aborted)
            setArtwork({ id: artworkId, owned: artworkOwned, items });
        })
        .catch(() => {
          if (!abort.signal.aborted) setArtwork(null);
        });
    return () => abort.abort();
  }, [artworkId, artworkOwned]);

  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [eqEditing, setEqEditing] = useState(false);
  const [copyName, setCopyName] = useState('');
  const [saveOpening, setSaveOpening] = useState<AudioState | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [picker, setPicker] = useState<{
    target: string;
    name: string;
    opening: AudioState;
    request?: number;
    insert?: boolean;
    format?: 'nam' | 'ir';
  } | null>(null);
  const [insertion, setInsertion] = useState<{
    opening: AudioState;
    format: 'nam' | 'ir';
  } | null>(null);
  const { on: performance } = usePerform();
  const setPerformance = (on: boolean) => setPerform({ on });
  useEffect(() => {
    if (state?.copy_on_edit) setPerform({ on: false });
  }, [state?.copy_on_edit]);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  // An empty slot the player tapped, and a preset with effects being made.
  const [slot, setSlot] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [matching, setMatching] = useState<AudioState | null>(null);
  const [selection, setSelection] = useWorkspaceState('native-selection', {
    session: '',
    target: 'outputLevel',
  });
  // Session identity prevents remembered block IDs from selecting a different rig.
  const target =
    selection.session === state?.session ? selection.target : 'outputLevel';
  const phone = useVerticalRig();
  const [fullBlock, setFullBlock] = useState<string | null>(null);
  const [quickBlock, setQuickBlock] = useState<string | null>(null);
  // A closed phone sheet must not reopen on top of a different dialog
  // when a desktop window is later resized back to phone width.
  if (!phone && quickBlock !== null) setQuickBlock(null);
  const [minimisedSession, setMinimisedSession] = useState<string | null>(null);
  const selectedId = target.startsWith('block:')
    ? target.split(':')[1]
    : undefined;
  const nativeLayout = state?.authoring?.layout;
  const providerToneId =
    [...(nativeLayout?.left ?? []), ...(nativeLayout?.right ?? [])].find(
      (b) => b.id === selectedId && !b.insert,
    )?.tone_id ?? null;
  const { source: toneSource } = useToneSource(
    state?.models?.some((model) => model.target === selectedId)
      ? null
      : providerToneId,
  );
  function setTarget(next: string) {
    setSelection({ session: state?.session ?? '', target: next });
  }
  const [group, setGroup] = useWorkspaceState<ControlGroup>(
    'native-control-group',
    'tone',
  );
  const inspector = useRef<HTMLDivElement>(null);
  function revealInspector() {
    requestAnimationFrame(() => {
      inspector.current?.scrollIntoView?.({
        block: 'nearest',
        behavior: 'instant',
      });
      inspector.current?.focus({ preventScroll: true });
    });
  }
  const [draft, setDraft] = useState<{
    target: string;
    value: number;
    baseline: number;
    session: string;
    revision: number;
  } | null>(null);
  const adjustment = useRef<EditQueue<AudioState> | null>(null);
  const latestValue = useRef(0);
  // Set by a fader drag so the row's trailing click does not open the dialog.
  const dragged = useRef(false);
  const alive = useRef(false);
  const sending = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    let toolActive = false;
    async function refresh() {
      const requested = generation.current;
      try {
        const next = await playbackState();
        toolActive =
          !!next.authoring?.tools &&
          (next.authoring.tools.tuner_enabled ||
            next.authoring.tools.balance.state === 'listening' ||
            next.authoring.tools.alignment.state === 'listening');
        if (
          alive.current &&
          !sending.current &&
          requested === generation.current
        ) {
          if (!adjustment.current) setError('');
          setState((old) =>
            old?.session === next.session && old.revision > next.revision
              ? old
              : next,
          );
          onPlaying(
            next.phase === 'running'
              ? (next.preset_name ?? 'Saved preset')
              : null,
          );
        }
      } catch (cause) {
        if (alive.current) setError(friendlyError(cause, 'update the rig'));
      } finally {
        if (alive.current)
          timer = setTimeout(() => void refresh(), toolActive ? 150 : 1000);
      }
    }
    void refresh();
    return () => {
      alive.current = false;
      clearTimeout(timer);
      // Navigation keeps the latest audible edit; it does not silently undo it.
      void adjustment.current?.finish(latestValue.current).catch(() => {});
    };
  }, [onPlaying]);
  async function apply(id: string, value: number, opening = state) {
    if (!opening || sending.current) return null;
    generation.current += 1;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const token = crypto.randomUUID();
      const started = await playbackCommand(opening, {
        kind: 'authoring',
        action: {
          kind: 'gesture',
          edit: { phase: 'begin', owner: 'live', token, target: id },
        },
      });
      const next = await playbackCommand(started, {
        kind: 'authoring',
        action: {
          kind: 'gesture',
          edit: { phase: 'commit', owner: 'live', token, sequence: 1, value },
        },
      });
      if (alive.current) {
        setState(next);
        setDraft(null);
        setAdjusting(false);
      }
      return next;
    } catch (cause) {
      if (alive.current) {
        setError(friendlyError(cause, 'update the rig'));
        setDraft(null);
      }
      // A lost response is refreshed, never replayed into a newer sounding session.
      try {
        const next = await playbackState();
        if (alive.current) {
          setState(next);
          onPlaying(
            next.phase === 'running'
              ? (next.preset_name ?? 'Saved preset')
              : null,
          );
        }
      } catch {
        /* Preserve last confirmed state. */
      }
      return null;
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function recall(choice: PresetChoice) {
    if (!state || sending.current || adjustment.current || eqEditing) return;
    sending.current = true;
    generation.current += 1;
    setBusy(true);
    setError('');
    try {
      if (choice.kind === 'scenes') {
        // The scenes engine takes over the interface; the Rig page follows it.
        await playScenes(choice.revision);
        const next = await playbackState();
        if (alive.current) setState(next);
        return;
      }
      const resumeCurrent =
        state.phase === 'stopped' && tone3000Key(state) === choiceKey(choice);
      const next = await playbackCommand(
        state,
        resumeCurrent
          ? { kind: 'resume' }
          : { kind: 'load_preset', preset_id: choice.id, owned: choice.owned },
      );
      if (alive.current) {
        setState(next);
        setTarget('outputLevel');
        setGroup('tone');
        setDraft(null);
        onPlaying(next.preset_name ?? 'Saved preset');
      }
    } catch (cause) {
      if (alive.current) {
        setError(friendlyError(cause, 'update the rig'));
        const next = await playbackState().catch(() => null);
        if (next) setState(next);
      }
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  /** A TONE3000 chain cannot hold effects: make a new preset with effects
   * around it, then play that. The original stays as it is. */
  async function addEffect(plugin: Lv2Plugin, placement: Placement) {
    const configured = state?.configured;
    if (!configured || configured.draft) return;
    setSlot(null);
    setAdding(false);
    setMaking(true);
    setError('');
    try {
      const [sources, library] = await Promise.all([
        rigNativeSources(),
        rigLibrary(),
      ]);
      const tone = playingTone(sources, configured.preset_id, configured.owned);
      if (!tone) throw new Error('This preset is not in the library.');
      const made = presetWithEffect({
        tone,
        name: state?.preset_name ?? tone.preset.name,
        plugin,
        placement,
        profile: library.native_profile,
      });
      const document = await publishRig(made.publish);
      await playScenes(document.revision);
    } catch (cause) {
      if (alive.current) setError(friendlyError(cause, 'update the rig'));
    } finally {
      if (alive.current) setMaking(false);
    }
  }
  async function reloadSaved(opening: AudioState) {
    if (
      !opening.configured ||
      opening.configured.draft ||
      sending.current ||
      adjustment.current ||
      eqEditing
    )
      return;
    sending.current = true;
    generation.current += 1;
    setBusy(true);
    setError('');
    setRestoreOpening(null);
    try {
      // Ordinary recall intentionally retains a working session. Explicit discard
      // instead starts the immutable saved file without its working receipt/models.
      const stopped = await playbackCommand(opening, { kind: 'stop' });
      const next = await playbackCommand(stopped, {
        kind: 'start',
        settings: { ...opening.configured, working: null },
      });
      if (alive.current) {
        setState(next);
        setTarget('outputLevel');
        setGroup('tone');
        onPlaying(next.preset_name ?? 'Saved preset');
      }
    } catch (cause) {
      // A lost response may already have applied: refresh, never repeat Stop/Start.
      if (alive.current) {
        setError(friendlyError(cause, 'update the rig'));
        const next = await playbackState().catch(() => null);
        if (next) setState(next);
      }
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function configureMidi(
    settings: NonNullable<NonNullable<AudioState['configured']>['midi']> | null,
  ) {
    if (!state || sending.current) return;
    generation.current += 1;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await playbackCommand(state, { kind: 'midi', settings });
      if (alive.current) setState(next);
    } catch (cause) {
      if (alive.current) {
        setError(friendlyError(cause, 'update the rig'));
        const latest = await playbackState().catch(() => null);
        if (latest) setState(latest);
      }
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function author(
    action: Extract<AudioAction, { kind: 'authoring' }>['action'],
  ) {
    if (!state || sending.current || adjustment.current || eqEditing) return;
    generation.current += 1;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await playbackCommand(state, { kind: 'authoring', action });
      if (alive.current) {
        setState(next);
        setDraft(null);
      }
    } catch (cause) {
      if (alive.current) setError(friendlyError(cause, 'update the rig'));
      // Never replay a structural write after a lost reply.
      try {
        const next = await playbackState();
        if (alive.current) setState(next);
      } catch {
        /* Polling can recover. */
      }
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function openAdjustment(
    control: AudioState['controls'][number],
    inline = false,
  ) {
    if (!state || sending.current || adjustment.current) return;
    const opening = control.value;
    let cursor = state;
    latestValue.current = opening;
    setDraft({
      target: control.target,
      value: opening,
      baseline: opening,
      session: state.session,
      revision: state.revision,
    });
    // Dragging a row's fader adjusts in place; tapping the row opens the dialog.
    if (!inline) setAdjusting(true);
    setError('');
    const token = crypto.randomUUID();
    generation.current += 1;
    const ready = playbackCommand(cursor, {
      kind: 'authoring',
      action: {
        kind: 'gesture',
        edit: { phase: 'begin', owner: 'live', token, target: control.target },
      },
    }).then((next) => {
      cursor = next;
      if (!alive.current) return;
      setState(next);
      // Beginning the adjustment advances the revision; the draft follows it,
      // otherwise the dialog would mistake its own begin for a changed session.
      setDraft((old) =>
        old?.target === control.target && old.session === next.session
          ? { ...old, revision: next.revision }
          : old,
      );
    });
    void ready.catch((cause) => {
      if (alive.current) setError(friendlyError(cause, 'update the rig'));
    });
    adjustment.current = new EditQueue<AudioState>(
      'live',
      token,
      ready,
      async (edit) => {
        const value = edit.phase === 'cancel' ? opening : edit.value;
        // Opening/closing without adjustment must not mark the session modified.
        if (
          edit.phase === 'preview' &&
          cursor.controls.find((item) => item.target === control.target)
            ?.value === value
        )
          return cursor;
        generation.current += 1;
        sending.current = true;
        try {
          // Each accepted value advances our cursor. Never refresh and replay a
          // failed command: another client or a recalled rig may own the sound.
          cursor = await playbackCommand(cursor, {
            kind: 'authoring',
            action: { kind: 'gesture', edit },
          });
          return cursor;
        } finally {
          sending.current = false;
        }
      },
      (next) => {
        if (!alive.current) return;
        setState((old) =>
          old?.session === next.session && old.revision > next.revision
            ? old
            : next,
        );
        setDraft((old) =>
          old?.session === next.session && old.target === control.target
            ? { ...old, revision: next.revision }
            : old,
        );
      },
      (cause) => {
        if (!alive.current) return;
        setError(friendlyError(cause, 'update the rig'));
        void playbackState()
          .then((next) => {
            if (alive.current) setState(next);
          })
          .catch(() => {});
      },
    );
  }
  async function finishAdjustment(cancel: boolean) {
    const queue = adjustment.current;
    if (!queue) return;
    setBusy(true);
    try {
      if (cancel) await queue.cancel();
      else await queue.finish(latestValue.current);
    } catch (cause) {
      if (alive.current) setError(friendlyError(cause, 'update the rig'));
    } finally {
      if (adjustment.current === queue) adjustment.current = null;
      if (alive.current) {
        setDraft(null);
        setAdjusting(false);
        setBusy(false);
      }
    }
  }
  async function saveCopy(target?: VersionTarget) {
    if (!state || !saveOpening || sending.current) return;
    if (
      state.session !== saveOpening.session ||
      state.revision !== saveOpening.revision
    ) {
      setError('The rig changed. Close and reopen Save copy.');
      return;
    }
    generation.current += 1;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const name = copyName.trim();
      const next = await playbackCommand(
        state,
        target
          ? { kind: 'save_version', name, target }
          : { kind: 'save_copy', name },
      );
      if (alive.current) {
        setState(next);
        setDraft(null);
        setSaveOpening(null);
      }
    } catch (cause) {
      if (alive.current) setError(friendlyError(cause, 'update the rig'));
      // Do not repeat a write after a lost response. Polling retrieves its saved identity.
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function resolveAutomaticCopy(keep: boolean) {
    const opening = state;
    const copy = opening?.copy_on_edit;
    if (!opening || !copy || sending.current) return;
    generation.current += 1;
    sending.current = true;
    setBusy(true);
    setError('');
    let sourceRestored = false;
    try {
      const next = await playbackCommand(opening, {
        kind: 'resolve_copy',
        keep,
      });
      sourceRestored = !keep;
      if (alive.current) setState(next);
      if (!keep) {
        const preview = await removalPreview({
          entry_kind: 'owned',
          id: copy.copy_id,
        });
        if (preview.blocked)
          throw new Error(
            `The automatic copy could not be discarded: ${preview.blocked}`,
          );
        await removePreset({
          entry_kind: 'owned',
          id: copy.copy_id,
          expected_preview: preview.token,
          delete_models: false,
        });
      }
    } catch (cause) {
      if (alive.current) {
        setError(
          sourceRestored
            ? `The original is playing, but the copy remains in Mine: ${errorDetails(cause)}`
            : friendlyError(cause, 'update the rig'),
        );
        const next = await playbackState().catch(() => null);
        if (next) setState(next);
      }
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (state?.phase !== 'running') {
    if (hideInactive) return null;
    if (state?.phase === 'unavailable' && !state.waiting_for_device) {
      return (
        <RigAudioUnavailable
          onLibrary={onLibrary}
          onAudioSetup={onAudioSetup}
          onTuner={requestTuner}
          error={error || state.error}
        />
      );
    }
    return (
      <section className="panel space-y-3" aria-label="Rig playback">
        <h2>
          {!state
            ? 'Checking audio…'
            : state.waiting_for_device
              ? 'Waiting for your audio interface'
              : state.phase === 'unavailable'
                ? 'Audio playback unavailable'
                : state.phase === 'starting'
                  ? 'Preparing sound…'
                  : state.phase === 'stopping'
                    ? 'Stopping audio…'
                    : state.phase === 'failed'
                      ? 'Audio needs attention'
                      : 'Audio stopped'}
        </h2>
        {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
        {state?.waiting_for_device ? (
          <p role="status">{WAITING_FOR_DEVICE}</p>
        ) : state?.phase === 'stopped' && state.configured ? (
          <p>
            Resume picks up where you left off
            {state.preset_name ? ` with ${state.preset_name}` : ''}, including
            unsaved edits. To start a different preset, choose its name below.
          </p>
        ) : (
          <p>
            Choose a rig from Library to play. Audio setup is only needed when
            configuring your interface.
          </p>
        )}
        {state?.phase === 'stopped' &&
          state.configured &&
          !state.waiting_for_device && (
            <RigPresetSelector
              phase="stopped"
              current={{
                key: tone3000Key(state),
                name: state.preset_name,
                modified: state.modified,
                refresh: state.saved_copy,
              }}
              disabled={
                !connected ||
                busy ||
                !!draft ||
                !!picker ||
                !!state.copy_on_edit
              }
              onSelect={(choice) => void recall(choice)}
            />
          )}
        <div className="action-row">
          {state?.phase === 'stopped' && state.configured && (
            <Button
              disabled={!connected || busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const next = await playbackCommand(state, { kind: 'resume' });
                  if (alive.current) setState(next);
                } catch (cause) {
                  if (alive.current)
                    setError(friendlyError(cause, 'update the rig'));
                } finally {
                  if (alive.current) setBusy(false);
                }
              }}
            >
              Resume{state.preset_name ? ` ${state.preset_name}` : ''}
            </Button>
          )}
          <Button
            variant={
              state?.phase === 'stopped' && state.configured
                ? 'outline'
                : 'default'
            }
            onClick={onLibrary}
          >
            Browse presets
          </Button>
          <Button variant="outline" onClick={onAudioSetup}>
            Audio setup
          </Button>
          <TunerButton />
        </div>
      </section>
    );
  }
  const control =
    state.controls.find((c) => c.target === target) ?? state.controls[0];
  const selectedTarget = control?.target ?? '';
  const activeDraft = draft?.target === control?.target ? draft : null;
  // The adjust dialog follows the edit itself, so a knob can open it without
  // changing which block is selected.
  const adjusted = state.controls.find((c) => c.target === draft?.target);
  const draftStale =
    !!draft &&
    (draft.session !== state.session || draft.revision !== state.revision);
  const stale =
    !!activeDraft &&
    (activeDraft.session !== state.session ||
      activeDraft.revision !== state.revision);
  const modelPending =
    !!state.model_change &&
    ['verifying', 'preparing', 'ready', 'applying'].includes(
      state.model_change.phase,
    );
  // An unrelated error never locks the rig: commands carry their own session
  // and revision checks, so a stale one fails safely (7.22).
  const unavailable = !connected || busy || eqEditing || modelPending;
  const disabled =
    unavailable ||
    state.authoring?.tools?.balance.state === 'listening' ||
    state.authoring?.tools?.alignment.state === 'listening';
  const groups = state.controls.filter(
    (c) => c.target.startsWith('block:') && c.target.endsWith(':enabled'),
  );
  const selectedBlock = selectedTarget.startsWith('block:')
    ? selectedTarget.split(':')[1]
    : undefined;
  // Six performance knobs (Nano Cortex style): five rig controls saved with the
  // preset, plus the unit Level below them. Dragging never changes the selection.
  const knob = (target: string | undefined) =>
    target ? state.controls.find((c) => c.target === target) : undefined;
  const toneOn = knob('toneEqEnabled')?.value !== 0;
  const knobs = [
    { label: 'Gain', item: knob('inputLevel'), hint: '' },
    {
      label: 'Bass',
      item: knob('toneBass'),
      hint: toneOn ? '' : 'Tone stack off',
    },
    {
      label: 'Mid',
      item: knob('toneMid'),
      hint: toneOn ? '' : 'Tone stack off',
    },
    {
      label: 'Treble',
      item: knob('toneTreble'),
      hint: toneOn ? '' : 'Tone stack off',
    },
    {
      label: 'Amount',
      item: knob(selectedBlock && `block:${selectedBlock}:mix`),
      hint: selectedBlock ? 'No mix on this block' : 'Select a block',
    },
  ];
  const knobStrip = knobs.some((k) => k.item) ? (
    <div
      className="grid grid-cols-5 border-b border-border"
      role="group"
      aria-label="Performance knobs"
    >
      {knobs.map(({ label, item, hint }) => (
        <Button
          variant="ghost"
          key={label}
          type="button"
          className="group/knob grid h-auto min-h-13 place-content-center justify-items-center gap-0.5 rounded-none border-r border-border px-0.5 py-1 last:border-r-0 min-[481px]:min-h-16 min-[481px]:gap-1"
          data-inactive={!item || !!hint || undefined}
          aria-haspopup="dialog"
          title={item ? item.label : hint}
          disabled={disabled || !item}
          onClick={() => item && openAdjustment(item)}
        >
          <span className="sr-only">Adjust </span>
          <span className="small-caps text-2xs text-muted-foreground min-[481px]:text-xs">
            {label}
          </span>{' '}
          <strong className="font-mono text-md leading-none font-medium tabular-nums group-data-inactive/knob:text-muted-foreground min-[481px]:text-xl">
            {item ? item.display : '—'}
          </strong>
        </Button>
      ))}
    </div>
  ) : null;
  const selectedLane = state.authoring?.layout?.right.some(
    (block) => block.id === selectedBlock,
  )
    ? 'right'
    : 'left';
  const orderedBlocks = state.authoring?.layout?.[selectedLane] ?? [];
  const chainLanes: RigLaneVM[] = (['left', 'right'] as const).flatMap(
    (lane) => {
      const layout = state.authoring?.layout;
      // Empty slots keep their place in the chain, as + tiles.
      const slotIds = new Set(state.slots?.map((slot) => slot.target));
      const laneGroups: ((typeof groups)[number] | { empty: string })[] = layout
        ? layout[lane].flatMap(
            (b): ((typeof groups)[number] | { empty: string })[] =>
              b.insert && slotIds.has(b.id)
                ? [{ empty: b.id }]
                : groups.filter((c) => c.target === `block:${b.id}:enabled`),
          )
        : lane === 'left'
          ? groups
          : [];
      if (
        lane === 'right' &&
        !laneGroups.some((c) => !('empty' in c)) &&
        !layout?.stereo
      )
        return [];
      return [
        {
          id: lane,
          input: layout?.stereo ? (lane === 'left' ? 'IN L' : 'IN R') : 'IN',
          blocks: laneGroups.map((c) => {
            if ('empty' in c)
              return {
                id: c.empty,
                label: 'Empty slot',
                kind: blockKind(''),
                on: false,
                face: null,
                empty: true,
              };
            const id = c.target.slice(6, -8);
            const model = state.models?.find((m) => m.target === id);
            const gear = model
              ? ''
              : ((artwork &&
                artwork.id === artworkId &&
                artwork.owned === artworkOwned
                  ? artwork.items
                  : []
                ).find((item) => item.block_id === id)?.gear ?? '');
            const kind = blockKind(gear);
            const showArtwork =
              chainView === 'artwork' &&
              !!state.configured &&
              !state.configured.draft;
            return {
              id,
              label: blockName(c.label),
              kind,
              caption: gear
                ? gearLabel(gear)
                : kind === 'other'
                  ? 'Tone block'
                  : undefined,
              preview:
                ['inputGain', 'outputGain']
                  .map(
                    (gain) =>
                      state.controls.find(
                        (item) => item.target === `block:${id}:${gain}`,
                      )?.display,
                  )
                  .map((value) =>
                    value?.endsWith(' dB')
                      ? shortValue({ value: parseFloat(value), unit: 'dB' })
                      : value,
                  )
                  .filter(Boolean)
                  .join(' · ') || undefined,
              on: c.value === 1,
              face: !showArtwork ? (
                <GearIcon gear={gear} />
              ) : model ? (
                <ArtworkDeck tile model id={model.asset} />
              ) : (
                <ArtworkDeck
                  tile
                  id={state.configured!.preset_id}
                  owned={state.configured!.owned}
                  blockId={id}
                />
              ),
            };
          }),
        },
      ];
    },
  );
  const selectNativeBlock = (id: string) => {
    const prefix = `block:${id}:`;
    setTarget(
      state.controls.find(
        (item) => item.target.startsWith(prefix) && !item.toggle,
      )?.target ?? `block:${id}:enabled`,
    );
    setDraft(null);
    setFullBlock(null);
    setQuickBlock(phone ? id : null);
    if (!phone) revealInspector();
  };
  const selectedEnabled = groups.find(
    (item) => item.target === `block:${selectedBlock}:enabled`,
  );
  const selectedModel = state.models?.find(
    (item) => item.target === selectedBlock,
  );
  const selectedArtwork =
    !selectedModel &&
    artwork?.id === artworkId &&
    artwork?.owned === artworkOwned
      ? artwork?.items.find((item) => item.block_id === selectedBlock)
      : undefined;
  const selectedControls = state.controls.filter(
    (item) =>
      selectedBlock &&
      item.target.startsWith(`block:${selectedBlock}:`) &&
      !item.target.endsWith(':enabled'),
  );
  const selectedEq = state.eq?.find((row) => row.block_id === selectedBlock);
  const selectedName = selectedEnabled ? blockName(selectedEnabled.label) : '';
  const selectedCaption =
    toneSource?.kind === 'tone3000' && toneSource.gear
      ? toneSource.gear
      : selectedArtwork?.gear
        ? gearLabel(selectedArtwork.gear)
        : 'Tone block';
  const isDb = (target: string) => /:(?:inputGain|outputGain)$/.test(target);
  const normalize = (target: string, value: number) =>
    isDb(target) ? value / 48 + 0.5 : value / 100;
  const blockFields = selectedControls.map((item) => {
    const db = isDb(item.target);
    const value = draft?.target === item.target ? draft.value : item.value;
    return {
      id: item.target,
      label: shortControlLabel(item.label),
      toggle: item.toggle,
      min: db ? -24 : 0,
      max: db ? 24 : item.toggle ? 1 : 100,
      unit: db ? 'dB' : item.toggle ? '' : '%',
      step: db ? 0.5 : 1,
      main: !item.toggle,
      value: item.toggle
        ? value
        : Number((db ? (value - 0.5) * 48 : value * 100).toFixed(1)),
    };
  });
  function previewBlockValue(id: string, value: number) {
    const item = selectedControls.find((control) => control.target === id);
    if (!item || adjusting || (draft && draft.target !== id)) return;
    if (!adjustment.current) {
      setTarget(id);
      openAdjustment(item, true);
    }
    if (adjustment.current) {
      const normalized = normalize(id, value);
      latestValue.current = normalized;
      setDraft((old) =>
        old?.target === id ? { ...old, value: normalized } : old,
      );
      adjustment.current.preview(normalized);
    }
  }
  function commitBlockSlider(id: string, value: number) {
    if (adjusting || (draft && draft.target !== id)) return;
    const normalized = normalize(id, value);
    if (adjustment.current) {
      latestValue.current = normalized;
      void finishAdjustment(false);
    } else void apply(id, normalized);
  }
  const laneBlocks =
    chainLanes
      .find((lane) => lane.id === selectedLane)
      ?.blocks.filter((block) => !block.empty) ?? [];
  const position = laneBlocks.findIndex((block) => block.id === selectedBlock);
  const flattened = chainLanes.flatMap((lane) =>
    lane.blocks.filter((block) => !block.empty),
  );
  const adjacent = flattened.findIndex((block) => block.id === selectedBlock);
  const previousBlock = adjacent > 0 ? flattened[adjacent - 1] : undefined;
  const nextBlock = adjacent >= 0 ? flattened[adjacent + 1] : undefined;
  async function auditionNativeModel(
    opening: AudioState,
    target: string,
    asset: string,
    request?: number,
  ) {
    if (sending.current || adjustment.current || eqEditing)
      throw new Error('Finish the active adjustment first.');
    generation.current += 1;
    sending.current = true;
    setBusy(true);
    try {
      const current = await playbackState();
      assertAuditionOwner(opening, current, request, current.model_change);
      const next = await playbackCommand(current, {
        kind: 'replace_model',
        assignment: { target, asset },
      });
      if (alive.current) {
        setState(next);
        setError('');
      }
      return next;
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function changeBlockModel() {
    if (selectedBlock && state)
      setPicker({
        target: selectedBlock,
        name: selectedEnabled
          ? blockName(selectedEnabled.label)
          : 'Selected block',
        opening: state,
      });
  }
  function editBlockEq(blockId: string) {
    if (!state) return null;
    return (
      <LiveEq
        key={`${state.session}:${blockId}`}
        state={state}
        blockId={blockId}
        send={(current, edit) =>
          playbackCommand(current, {
            kind: 'authoring',
            action: { kind: 'eq', block_id: blockId, edit },
          })
        }
        gesture={(current, edit) =>
          playbackCommand(current, {
            kind: 'authoring',
            action: { kind: 'gesture', edit },
          })
        }
        disabled={!connected || busy || !!draft || modelPending}
        onEditing={setEqEditing}
        onChange={(next) => {
          generation.current += 1;
          setState((old) =>
            old?.session === next.session && old.revision > next.revision
              ? old
              : next,
          );
        }}
      />
    );
  }
  const artDetails = selectedBlock &&
    (selectedModel || (state.configured && !state.configured.draft)) && (
      <details className="disclosure">
        <summary>Model information &amp; offline images</summary>
        {selectedModel ? (
          <ArtworkDeck model id={selectedModel.asset} />
        ) : (
          state.configured && (
            <ArtworkDeck
              key={`${state.configured.preset_id}:${selectedBlock}`}
              id={state.configured.preset_id}
              owned={state.configured.owned}
              blockId={selectedBlock}
            />
          )
        )}
      </details>
    );
  const selectedKind = flattened.find(
    (block) => block.id === selectedBlock,
  )?.kind;
  const blockModel: BlockModel | null =
    selectedBlock && selectedEnabled
      ? {
          id: selectedBlock,
          label: selectedName,
          caption: selectedCaption,
          kind:
            !selectedKind || selectedKind === 'other' ? 'lv2' : selectedKind,
          on: selectedEnabled.value === 1,
          origin: toneSource,
          controls: blockFields,
        }
      : null;
  const fullSelected = !!selectedBlock && fullBlock === selectedBlock;
  function setNativeFull(open: boolean) {
    if (!open && adjustment.current && !adjusting) void finishAdjustment(true);
    setFullBlock(open ? (selectedBlock ?? null) : null);
  }
  const blockActions = selectedBlock && orderedBlocks.length > 1 && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || !!draft}
          aria-label={`More for ${selectedName}`}
        >
          <DotsThree />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {([-1, 1] as const).map((direction) => {
          const order = movedBlockOrder(
            orderedBlocks,
            selectedBlock,
            direction,
          );
          return (
            <DropdownMenuItem
              key={direction}
              disabled={!order}
              onSelect={() => {
                if (order)
                  void author({
                    kind: 'edit',
                    edit: {
                      kind: 'reorder',
                      lane: selectedLane,
                      block_ids: order,
                    },
                  });
              }}
            >
              {direction === -1 ? 'Move earlier' : 'Move later'}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const sharedEditor = blockModel && selectedEnabled && (
    <BlockEditor
      key={`${state.session}:${selectedBlock}`}
      block={blockModel}
      open={!adjusting && phone && quickBlock === selectedBlock}
      onOpenChange={(open) => {
        if (!open && adjustment.current && !adjusting)
          void finishAdjustment(true);
        setQuickBlock(open ? (selectedBlock ?? null) : null);
      }}
      anchor={null}
      fullOpen={!adjusting && fullSelected}
      onFullOpenChange={setNativeFull}
      disabled={disabled}
      onControl={(_block, id, value) => void apply(id, value)}
      onToggle={(_block, on) => void apply(selectedEnabled.target, on ? 1 : 0)}
      onSwap={changeBlockModel}
      visual={
        selectedEq && (
          <BlockBandGains
            bands={selectedEq.eq.bands}
            enabled={selectedEq.eq.enabled}
            compact
            onOpen={() => {
              setQuickBlock(null);
              setNativeFull(true);
            }}
          />
        )
      }
      fullVisual={selectedEq && editBlockEq(selectedEq.block_id)}
      details={
        <>
          {phone && blockActions}
          {toneSource && (
            <details className="disclosure">
              <summary>Source details</summary>
              <SourceCard source={toneSource} />
            </details>
          )}
          {artDetails}
        </>
      }
      renderSlider={(control) => (
        <Slider
          label={control.label}
          min={control.min}
          max={control.max}
          step={control.step}
          value={[control.value]}
          disabled={disabled || (!!draft && draft.target !== control.id)}
          readout={
            <button
              type="button"
              className="relative min-h-0 border-0 bg-transparent p-0 before:absolute before:-inset-x-1 before:-top-2 before:-bottom-0.5 before:content-['']"
              aria-haspopup="dialog"
              disabled={disabled || !!draft}
              onClick={() => {
                const item = selectedControls.find(
                  ({ target }) => target === control.id,
                );
                if (!item) return;
                setTarget(control.id);
                openAdjustment(item);
              }}
            >
              <span className="sr-only">Edit exact {control.label} </span>
              {control.value.toFixed(control.step && control.step >= 1 ? 0 : 1)}
              {control.unit ? ` ${control.unit}` : ''}
            </button>
          }
          onValueChange={([value]) => {
            if (value !== undefined) previewBlockValue(control.id, value);
          }}
          onValueCommit={([value]) => {
            if (value !== undefined) commitBlockSlider(control.id, value);
          }}
          onPointerCancel={() => void finishAdjustment(true)}
        />
      )}
    />
  );
  const desktopBlock =
    !phone && selectedBlock && selectedEnabled ? (
      <SelectedBlockPanel
        title={selectedName}
        caption={selectedCaption}
        position={
          position < 0
            ? ''
            : `${chainLanes.length < 2 ? 'Main line' : selectedLane === 'right' ? 'Right chain' : 'Left chain'} · ${position + 1} of ${laneBlocks.length}`
        }
        source={toneSource}
        glyph={
          selectedArtwork?.gear ? glyphFor(selectedArtwork.gear) : undefined
        }
        pictureUrl={
          selectedArtwork?.key &&
          selectedArtwork.cached &&
          state.configured &&
          !selectedModel
            ? artworkPath(
                state.configured.preset_id,
                state.configured.owned,
                selectedArtwork.key,
              )
            : undefined
        }
        on={selectedEnabled.value === 1}
        onPrevious={
          !disabled && !draft && previousBlock
            ? () => selectNativeBlock(previousBlock.id)
            : undefined
        }
        onNext={
          !disabled && !draft && nextBlock
            ? () => selectNativeBlock(nextBlock.id)
            : undefined
        }
        onMinimise={() => setMinimisedSession(state.session)}
        minimised={minimisedSession === state.session}
        onExpand={() => setMinimisedSession(null)}
        preview={selectedControls
          .filter((item) => !item.toggle)
          .slice(0, 4)
          .map((item) => `${shortControlLabel(item.label)} ${item.display}`)
          .join(' · ')}
        renderSwitch={(id) => (
          <Switch
            id={id}
            checked={selectedEnabled.value === 1}
            disabled={disabled || !!draft}
            onCheckedChange={(on) =>
              void apply(selectedEnabled.target, on ? 1 : 0)
            }
          />
        )}
        onChange={changeBlockModel}
        changeDisabled={disabled || !!draft}
        onAllControls={() => setNativeFull(true)}
        controlCount={selectedControls.length}
        modelStepper={
          <NativeModelStepper
            key={`${state.session}:${selectedBlock}`}
            state={state}
            block={selectedBlock}
            name={selectedName}
            gear={
              selectedArtwork?.gear ??
              (toneSource?.kind === 'tone3000' ? toneSource.gear : undefined)
            }
            disabled={disabled || !!draft || !!picker || fullSelected}
            onAudition={(opening, asset) =>
              auditionNativeModel(opening, selectedBlock, asset)
            }
          />
        }
        actions={blockActions}
        visual={
          selectedEq ? (
            <BlockBandGains
              bands={selectedEq.eq.bands}
              enabled={selectedEq.eq.enabled}
              onOpen={() => setNativeFull(true)}
            />
          ) : null
        }
        controls={blockFields
          .filter((field) => field.main)
          .slice(0, 4)
          .map((field) => (
            <BlockPanelControl
              key={field.id}
              caption={field.label}
              field={{
                label: `${selectedName} ${field.label}`,
                value: field.value,
                min: field.min,
                max: field.max,
                unit: field.unit,
                step: field.step,
                fine: 0.1,
                disabled: disabled || (!!draft && draft.target !== field.id),
                onDragStart: () => {
                  const item = selectedControls.find(
                    (control) => control.target === field.id,
                  );
                  if (item) {
                    setTarget(field.id);
                    openAdjustment(item, true);
                  }
                },
                onDragEnd: (cancelled) => void finishAdjustment(cancelled),
                onChange: (value) => {
                  if (adjustment.current) previewBlockValue(field.id, value);
                  else void apply(field.id, normalize(field.id, value));
                },
              }}
            />
          ))}
      />
    ) : null;
  if (performance)
    return (
      <>
        <PerformView
          now={{
            session: state.session,
            playing: state.phase === 'running',
            name: state.preset_name,
            modified: state.modified,
          }}
          lanes={chainLanes}
          disabled={disabled || !!draft || !!picker}
          onToggle={(id) => {
            const enabled = groups.find(
              (c) => c.target === `block:${id}:enabled`,
            );
            if (enabled)
              void apply(enabled.target, enabled.value === 1 ? 0 : 1);
          }}
          onEdit={() => setPerformance(false)}
          knobs={knobStrip}
          selector={
            <RigPresetSelector
              phase={state.phase}
              current={{
                key: tone3000Key(state),
                name: state.preset_name,
                modified: state.modified,
                refresh: state.saved_copy,
              }}
              disabled={disabled || !!draft || !!picker}
              pads
              all
              onSelect={(choice) => void recall(choice)}
            />
          }
        />
        {error && <p role="alert">{error}</p>}
      </>
    );
  return (
    <section
      className="instrument-surface live-rig landscape:max-h-[500px]:p-0 space-y-2 py-0 max-[600px]:p-0 [&_.caption]:my-2 [&>[data-slot=rig-heading]]:-mx-page [&>details]:border-t [&>details]:border-border [&>details]:py-1 [&>details[open]>summary]:mb-2 [&>details[open]>summary]:text-foreground"
      aria-label="Sounding rig"
    >
      <RigHeading
        playing={state.phase === 'running'}
        identity={
          <RigPresetSelector
            heading
            phase={state.phase}
            current={{
              key: tone3000Key(state),
              name: state.preset_name,
              modified: state.modified,
              refresh: state.saved_copy,
            }}
            disabled={disabled || !!draft || !!picker || !!state.copy_on_edit}
            onSelect={(choice) => void recall(choice)}
          />
        }
      >
        <StageControls connected={connected} compact />
        <Button
          variant="outline"
          aria-label="Perform view"
          disabled={disabled || !!draft || !!picker}
          onClick={() => setPerformance(true)}
        >
          <Lightning aria-hidden="true" />
          <span className="phone-hidden">Perform</span>
        </Button>
        <TunerButton />
        {/* Save and the preset actions form one split button. */}
        <div className="inline-flex shrink-0" role="group" aria-label="Save">
          <Button
            className="rounded-r-none"
            aria-label="Save copy"
            title="Save a copy for offline use"
            variant={state.modified ? 'default' : 'outline'}
            disabled={disabled || !!draft || !!picker}
            onClick={() => {
              setCopyName(state.preset_name ?? 'My preset');
              setSaveOpening(state);
            }}
          >
            Save
          </Button>
          <Button
            variant={state.modified ? 'default' : 'outline'}
            aria-label="Preset actions"
            aria-haspopup="dialog"
            title="MIDI, Revert, Match level and appearance"
            className="min-w-9 rounded-l-none border-l-current/35 px-2"
            disabled={disabled || !!draft || !!picker}
            onClick={() => setActionsOpen(true)}
          >
            <CaretDown aria-hidden="true" />
          </Button>
        </div>
        <Toggle
          size="sm"
          pressed={editingChain}
          onPressedChange={setEditingChain}
          disabled={disabled || !!draft}
        >
          <PencilSimple /> Edit
        </Toggle>
      </RigHeading>
      {state.copy_on_edit && (
        <div
          className="rounded-md border border-border bg-card p-3"
          role="status"
        >
          <strong>Editing a copy of {state.copy_on_edit.source_name}</strong>
          <p className="caption">
            Your first change created this preset in Mine. The TONE3000 original
            is unchanged.
          </p>
          <div className="action-row">
            <Button
              disabled={busy}
              onClick={() => void resolveAutomaticCopy(true)}
            >
              Keep copy
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void resolveAutomaticCopy(false)}
            >
              Discard copy
            </Button>
          </div>
        </div>
      )}
      <span
        role="status"
        data-testid="live-status"
        className="sr-only"
        data-edited={state.modified}
      >
        {busy ? 'Applying…' : state.modified ? 'Unsaved edits' : 'Saved'}
      </span>
      {error && !adjusting && (
        <div
          className="error flex flex-wrap items-center gap-2 [&>p]:m-0 [&>p]:min-w-48 [&>p]:flex-1"
          role="alert"
        >
          <p>{error}</p>
          <Button variant="outline" onClick={() => setError('')}>
            Acknowledge and refresh
          </Button>
        </div>
      )}
      <div
        className="rig-workspace grid grid-cols-[minmax(0,1fr)] items-start gap-3"
        data-inspecting={!!selectedBlock}
      >
        <div className="rig-chain-column min-w-0 space-y-3">
          {editingChain && (
            <div className="flex min-h-touch flex-wrap items-center gap-0.5 [&>h3]:mr-auto [&>h3]:font-semibold">
              <h3>Chain</h3>
              {!!state.slots?.length && (
                <Button
                  variant="ghost"
                  aria-label="Add block"
                  disabled={disabled || !!draft}
                  onClick={() => setAdding(true)}
                >
                  <Plus aria-hidden="true" />
                  Add
                </Button>
              )}
              <Button
                variant="ghost"
                aria-label="Undo change"
                title="Undo the last chain edit"
                disabled={disabled || !!draft || !state.authoring?.can_undo}
                onClick={() => void author({ kind: 'undo' })}
              >
                Undo
              </Button>
              <Button
                variant="ghost"
                aria-label="Redo change"
                title="Redo the last undone chain edit"
                disabled={disabled || !!draft || !state.authoring?.can_redo}
                onClick={() => void author({ kind: 'redo' })}
              >
                Redo
              </Button>
            </div>
          )}
          {adding && !state.configured && (
            <AddBlockChooser
              onCancel={() => setAdding(false)}
              onChoose={(format) => {
                setAdding(false);
                setInsertion({ opening: state, format });
              }}
            />
          )}
          {matching && (
            <AdjustmentDialog
              title="Match preset level"
              onCancel={() => setMatching(null)}
            >
              <LevelMatch
                output={state.controls.find((c) => c.target === 'outputLevel')}
                disabled={disabled || busy}
                preset={state.preset_name ?? 'Current preset'}
                stale={
                  state.session !== matching.session ||
                  state.revision !== matching.revision
                }
                onApply={async (value) => {
                  const updated = await apply('outputLevel', value, matching);
                  const reported = updated?.controls.find(
                    (c) => c.target === 'outputLevel',
                  );
                  if (
                    !updated ||
                    updated.session !== matching.session ||
                    !reported ||
                    Math.abs(reported.value - value) > 0.0001
                  )
                    return false;
                  setMatching((current) =>
                    current === matching ? updated : current,
                  );
                  return true;
                }}
                onClose={() => setMatching(null)}
              />
            </AdjustmentDialog>
          )}
          {actionsOpen && (
            <AdjustmentDialog
              title="Preset actions"
              onCancel={() => setActionsOpen(false)}
            >
              <div className="grid divide-y divide-border [&>button]:h-auto [&>button]:justify-start [&>button]:rounded-none [&>button]:py-2.5 [&>button]:text-left [&>button]:whitespace-normal">
                <Button
                  variant="ghost"
                  type="button"
                  disabled={disabled || !!draft || !!picker}
                  onClick={() => {
                    setActionsOpen(false);
                    requestMidiAssignments();
                  }}
                >
                  MIDI assignments…
                  <span className="caption">
                    Assign this preset&apos;s switches and controls
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  aria-label="Reload saved"
                  disabled={
                    disabled ||
                    !!draft ||
                    !state.modified ||
                    !state.configured ||
                    state.configured.draft
                  }
                  onClick={() => {
                    setActionsOpen(false);
                    setRestoreOpening(state);
                  }}
                >
                  Revert to saved…
                  <span className="caption">
                    Discards edits since the last save
                  </span>
                </Button>
                <Button
                  variant="ghost"
                  type="button"
                  disabled={
                    disabled ||
                    !!draft ||
                    state.phase !== 'running' ||
                    !state.controls.some((c) => c.target === 'outputLevel')
                  }
                  onClick={() => {
                    setActionsOpen(false);
                    setMatching(state);
                  }}
                >
                  Match level…
                  <span className="caption">
                    Play for eight seconds to level this preset with the others
                  </span>
                </Button>
              </div>
              <div
                className="mt-3 flex flex-wrap items-center gap-2 [&_[aria-pressed=true]]:bg-foreground [&_[aria-pressed=true]]:text-background [&>span]:mr-auto [&>span]:font-semibold"
                role="group"
                aria-label="Chain appearance"
              >
                <span>Chain appearance</span>
                {(
                  [
                    ['compact', 'Connected icons', 'Icons'],
                    ['artwork', 'Model artwork', 'Artwork'],
                  ] as const
                ).map(([view, label, text]) => (
                  <Button
                    key={view}
                    variant="outline"
                    aria-label={label}
                    aria-pressed={chainView === view}
                    onClick={() => {
                      setChainView(view);
                      try {
                        localStorage.setItem('oxidal-chain-view', view);
                      } catch {
                        /* Optional preference. */
                      }
                    }}
                  >
                    {text}
                  </Button>
                ))}
              </div>
            </AdjustmentDialog>
          )}
          {restoreOpening && (
            <AdjustmentDialog
              title="Reload saved preset?"
              onCancel={() => setRestoreOpening(null)}
            >
              <p>
                This discards the live edits and reloads the saved version of{' '}
                {restoreOpening.preset_name}. Audio will briefly restart.
              </p>
              <div className="action-row">
                <Button
                  disabled={
                    disabled ||
                    state.session !== restoreOpening.session ||
                    state.revision !== restoreOpening.revision
                  }
                  onClick={() => {
                    void reloadSaved(restoreOpening);
                  }}
                >
                  Discard edits and reload
                </Button>
                <Button variant="ghost" onClick={() => setRestoreOpening(null)}>
                  Keep editing
                </Button>
              </div>
              {(state.session !== restoreOpening.session ||
                state.revision !== restoreOpening.revision) && (
                <p role="status">
                  The rig changed. Close and reopen Reload saved.
                </p>
              )}
            </AdjustmentDialog>
          )}
          {editingChain || chainView === 'artwork' ? (
            <ChainView
              label="Sounding tone blocks"
              appearance={chainView}
              disabled={disabled || !!draft || making}
              onAdd={(target) => setSlot(target)}
              selected={selectedBlock}
              onSelect={selectNativeBlock}
              lanes={chainLanes}
            />
          ) : (
            <div className="native-signal-route" data-chain-view={chainView}>
              {chainLanes.map((lane) => (
                <div key={lane.id}>
                  {chainLanes.length > 1 && (
                    <span className="small-caps">{lane.input}</span>
                  )}
                  <RouteView
                    label={
                      chainLanes.length > 1
                        ? lane.id + ' signal chain'
                        : 'Sounding tone blocks'
                    }
                    route={lane.blocks
                      .filter((block) => !block.empty)
                      .map((block) => ({
                        id: block.id,
                        label: block.label,
                        kind: block.kind === 'other' ? 'lv2' : block.kind,
                        caption: block.caption,
                        icon: block.face,
                        preview: block.preview,
                        on: block.on,
                      }))}
                    selected={selectedBlock}
                    disabled={disabled || !!draft || making}
                    onSelect={selectNativeBlock}
                  />
                </div>
              ))}
            </div>
          )}
          {making && <p role="status">Making a preset with that effect…</p>}
          {(slot || adding) && state.configured && (
            <SlotChooser
              sampleRate={state.configured.stream.input.sample_rate}
              presetName={state.preset_name ?? 'this preset'}
              modified={state.modified}
              allowEffects={!state.configured.draft}
              onCancel={() => {
                setSlot(null);
                setAdding(false);
              }}
              onModel={(format) => {
                if (!slot) {
                  setAdding(false);
                  setInsertion({ opening: state, format });
                  return;
                }
                const position = state.slots?.find((s) => s.target === slot);
                setPicker({
                  target: slot,
                  name: position
                    ? `${position.position.lane === 0 ? 'Left' : 'Right'} chain · position ${position.position.index + 1}`
                    : 'Empty slot',
                  opening: state,
                  insert: true,
                  format,
                });
                setSlot(null);
              }}
              onEffect={(plugin, placement) =>
                void addEffect(plugin, placement)
              }
            />
          )}
          {insertion && (
            <AdjustmentDialog
              title={`Add ${insertion.format.toUpperCase()} · position`}
              onCancel={() => setInsertion(null)}
            >
              <p className="caption">
                Choose an available position in the signal chain.
              </p>
              <div
                className="grid gap-2"
                aria-label="Available insertion positions"
              >
                {insertion.opening.slots?.map((slot) => (
                  <Button
                    key={slot.target}
                    variant="outline"
                    disabled={
                      disabled ||
                      state.session !== insertion.opening.session ||
                      state.revision !== insertion.opening.revision
                    }
                    onClick={() => {
                      setPicker({
                        target: slot.target,
                        name: `${slot.position.lane === 0 ? 'Left' : 'Right'} chain · position ${slot.position.index + 1}`,
                        opening: insertion.opening,
                        insert: true,
                        format: insertion.format,
                      });
                      setInsertion(null);
                    }}
                  >
                    {slot.position.lane === 0 ? 'Left' : 'Right'} chain ·
                    position {slot.position.index + 1}
                  </Button>
                ))}
              </div>
              {(state.session !== insertion.opening.session ||
                state.revision !== insertion.opening.revision) && (
                <p role="status">
                  The chain changed. Close and choose the position again.
                </p>
              )}
            </AdjustmentDialog>
          )}
          {picker && (
            <ModelPicker
              name={picker.name}
              initialFormat={picker.format}
              intent={picker.insert ? 'add' : 'replace'}
              comparison={
                picker.insert
                  ? undefined
                  : {
                      pending: modelPending,
                      appliedAsset:
                        state.model_change?.request === picker.request &&
                        state.model_change?.phase === 'applied'
                          ? state.model_change.assignment.asset
                          : undefined,
                      error:
                        state.model_change?.request === picker.request
                          ? state.model_change?.error
                          : undefined,
                      blocked: state.session !== picker.opening.session,
                    }
              }
              onClose={() => setPicker(null)}
              onAudition={async (asset) => {
                const next = await auditionNativeModel(
                  picker.opening,
                  picker.target,
                  asset,
                  picker.request,
                );
                if (alive.current)
                  setPicker({ ...picker, request: next.model_change?.request });
              }}
            />
          )}
          {modelPending && (
            <div className="flex flex-wrap items-center gap-2" role="status">
              <span>
                {state.model_change?.phase === 'applying'
                  ? 'Applying model…'
                  : 'Preparing model…'}
              </span>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  generation.current += 1;
                  sending.current = true;
                  setBusy(true);
                  try {
                    const current = await playbackState();
                    if (
                      current.session !== state.session ||
                      current.model_change?.request !==
                        state.model_change?.request
                    )
                      throw new Error(
                        'Model selection changed. Review it before cancelling.',
                      );
                    const next = await playbackCommand(current, {
                      kind: 'cancel_model',
                      request: state.model_change!.request,
                    });
                    if (alive.current) setState(next);
                  } catch (cause) {
                    if (alive.current)
                      setError(friendlyError(cause, 'update the rig'));
                  } finally {
                    sending.current = false;
                    if (alive.current) setBusy(false);
                  }
                }}
              >
                Cancel model
              </Button>
            </div>
          )}
          {state.model_change?.error && (
            <p role="alert">{state.model_change.error}</p>
          )}
        </div>
        <div
          className="rig-inspector-column min-w-0 scroll-mt-2 space-y-3 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          ref={inspector}
          tabIndex={-1}
          aria-label="Sound controls"
        >
          {desktopBlock}
          {sharedEditor}
          {!selectedBlock && (
            <>
              <div className="flex" aria-label="Control groups">
                {(
                  [
                    ['tone', 'Tone'],
                    ['gate', 'Gate'],
                    ['pitch', 'Pitch'],
                    ['stereo', 'Stereo'],
                  ] as const
                )
                  .filter(([id]) =>
                    state.controls.some(
                      (c) =>
                        !c.target.startsWith('block:') &&
                        controlGroup(c.target) === id,
                    ),
                  )
                  .map(([id, label]) => (
                    <Button
                      key={id}
                      variant="ghost"
                      aria-pressed={!selectedBlock && group === id}
                      disabled={disabled || !!draft}
                      onClick={() => {
                        setGroup(id);
                        setTarget(
                          state.controls.find(
                            (c) =>
                              !c.target.startsWith('block:') &&
                              controlGroup(c.target) === id,
                          )!.target,
                        );
                        setDraft(null);
                      }}
                    >
                      {label}
                    </Button>
                  ))}
              </div>
              <div
                className="grid border-t border-foreground"
                aria-label="Sounding controls"
              >
                {state.controls
                  .filter(
                    (item) =>
                      !item.target.startsWith('block:') &&
                      controlGroup(item.target) === group,
                  )
                  .map((item) => (
                    <Button
                      variant="ghost"
                      type="button"
                      className="live-value-trigger grid h-auto min-h-touch grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1 rounded-none border-b border-border px-0 py-2.5 text-left whitespace-normal data-toggle:items-center"
                      aria-label={`Adjust sounding ${shortControlLabel(item.label)} ${item.display}`}
                      data-toggle={item.toggle || undefined}
                      key={item.target}
                      disabled={disabled}
                      aria-haspopup={item.toggle ? undefined : 'dialog'}
                      aria-pressed={item.toggle ? item.value === 1 : undefined}
                      onClick={() => {
                        if (dragged.current) {
                          dragged.current = false;
                          return;
                        }
                        setTarget(item.target);
                        setDraft(null);
                        if (item.toggle)
                          void apply(item.target, item.value === 1 ? 0 : 1);
                        else openAdjustment(item);
                      }}
                    >
                      <span className="min-w-0 text-base wrap-anywhere">
                        {shortControlLabel(item.label)}
                      </span>{' '}
                      <strong className="text-right font-mono text-xl font-medium tabular-nums">
                        {item.display}
                      </strong>
                      {!item.toggle && (
                        <InlineFader
                          value={
                            draft?.target === item.target
                              ? draft.value
                              : item.value
                          }
                          dragging={draft?.target === item.target && !adjusting}
                          disabled={disabled}
                          onBegin={(value) => {
                            dragged.current = true;
                            setTarget(item.target);
                            openAdjustment(item, true);
                            latestValue.current = value;
                            setDraft((old) => (old ? { ...old, value } : old));
                            adjustment.current?.preview(value);
                          }}
                          onMove={(value) => {
                            latestValue.current = value;
                            setDraft((old) => (old ? { ...old, value } : old));
                            adjustment.current?.preview(value);
                          }}
                          onEnd={(cancel) => void finishAdjustment(cancel)}
                        />
                      )}
                    </Button>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>
      {/* Output row under the chain (7.28). */}
      <div className="grid gap-3 border-t border-border pt-3">
        {knobStrip}
        <MasterLevel
          extra={
            <>
              <GuitarPicker />
              {state.configured && !state.configured.draft && (
                <BoostControl
                  targets={[
                    {
                      key: boostKey.tone3000(
                        state.configured.preset_id,
                        state.configured.owned,
                      ),
                      label: state.preset_name ?? 'This preset',
                    },
                  ]}
                />
              )}
            </>
          }
        />
      </div>
      <output className="sr-only" data-testid="live-readback">
        Confirmed: {control?.display ?? '—'}
      </output>
      {adjusting && adjusted && (
        <AdjustmentDialog
          title={adjusted.label}
          onCancel={() => {
            if (!busy) void finishAdjustment(true);
          }}
        >
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <TouchAdjust
            label="sounding value"
            commitHint="Changes sound immediately. Done keeps edits; Cancel restores the opening value."
            value={draft?.value ?? adjusted.value}
            baseline={draft?.baseline ?? adjusted.value}
            min={0}
            max={1}
            step={0.01}
            disabled={disabled || draftStale}
            format={(v) =>
              confirmedControlDisplay(adjusted.display, v !== adjusted.value)
            }
            onChange={(value) => {
              latestValue.current = value;
              setDraft((old) => (old ? { ...old, value } : old));
              adjustment.current?.preview(value);
            }}
          />
          <div className="mt-2 flex flex-wrap gap-2 [&>button]:min-h-[48px] [&>button]:min-w-[48px]">
            <Button
              disabled={disabled || draftStale}
              onClick={() => void finishAdjustment(false)}
            >
              Done
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void finishAdjustment(true)}
            >
              Cancel
            </Button>
          </div>
          {draftStale && (
            <p role="alert">
              Sounding session changed. Cancel and reopen this control.
            </p>
          )}
        </AdjustmentDialog>
      )}
      <MidiControls
        trigger={false}
        configured={state.configured?.midi ?? null}
        disabled={disabled}
        preset={
          state.configured && !state.configured.draft && state.configured.owned
            ? {
                kind: 'owned' as const,
                id: state.configured.preset_id,
              }
            : undefined
        }
        onApply={configureMidi}
        control={{
          midi: state.midi,
          scenes: null,
          branches: [],
          controls: state.controls.map((c) => ({
            target: { kind: 'native', node: 'native', parameter: c.target },
            label: c.label,
            value: c.value,
            minimum: 0,
            maximum: 1,
            integer: c.toggle,
            toggle: c.toggle,
            logarithmic: false,
            display: c.display,
          })),
        }}
      />
      {state.authoring && (
        <NativeAuthoring
          historyControls={false}
          scope="split"
          settingsScope="unit"
          onEngineSettings={onAudioSetup}
          status={state.authoring}
          selectedBlock={selectedBlock}
          disabled={unavailable || !!draft}
          busy={busy}
          session={state.session}
          revision={state.revision}
          author={author}
        />
      )}
      {saveOpening && (
        <AdjustmentDialog
          title="Save copy"
          onCancel={() => {
            if (!busy) setSaveOpening(null);
          }}
        >
          <p className="caption">
            Keep this sound for offline use. The original preset stays
            unchanged.
          </p>
          <div className="form-grid">
            <label className="field">
              Name for sounding copy
              <input
                value={copyName}
                onChange={(e) => setCopyName(e.target.value)}
                maxLength={100}
                disabled={busy}
              />
            </label>
            <Button
              disabled={
                disabled ||
                !!draft ||
                !copyName.trim() ||
                state.session !== saveOpening.session ||
                state.revision !== saveOpening.revision
              }
              onClick={() => void saveCopy()}
            >
              {busy ? 'Saving…' : 'Save a copy'}
            </Button>
          </div>
          {state.configured?.owned && !state.configured.draft && (
            <SaveSoundVersion
              key={state.configured.preset_id}
              kind="owned"
              source={state.configured.preset_id}
              name={copyName}
              disabled={
                disabled ||
                !!draft ||
                busy ||
                state.session !== saveOpening.session ||
                state.revision !== saveOpening.revision
              }
              onSave={saveCopy}
            />
          )}
          {(state.session !== saveOpening.session ||
            state.revision !== saveOpening.revision) && (
            <p role="status">The rig changed. Close and reopen Save copy.</p>
          )}
          {error && <p role="alert">{error}</p>}
        </AdjustmentDialog>
      )}
      {!!draft && (
        <p className="caption">
          Finish the audible adjustment before saving a copy.
        </p>
      )}
      {state.saved_copy && (
        <p role="status" data-testid="live-saved">
          Copy saved in Library. Audio is still running.
        </p>
      )}
      {stale && !adjusting && (
        <p role="alert">
          The sounding session changed. Discard this adjustment before editing
          again.
        </p>
      )}
    </section>
  );
}
