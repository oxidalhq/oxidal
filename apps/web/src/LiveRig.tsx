import { GearIcon } from './GearIcon';
import { ChainView, LedToggle } from './ChainView';
import { PerformView } from './PerformView';
import './RigControls.css';
import { blockKind, type RigLaneVM } from './rigChain';
import { useWorkspaceState } from './workspaceMemory';
import { MidiControls } from './SceneMidi';
import { NativeAuthoring } from './NativeAuthoring';
import {
  ArrowRight,
  Plus,
  DotsThree,
  ArrowLeft,
  X,
} from '@phosphor-icons/react';
import { RigPresetSelector } from './RigPresetSelector';
import {
  assertAuditionOwner,
  movedBlockOrder,
  controlGroup,
  shortControlLabel,
  confirmedControlDisplay,
  type ControlGroup,
} from './rigControls';
import { LiveEq } from './LiveEq';
import { ArtworkDeck } from './AssetArtwork';
import { ModelPicker } from './ModelPicker';
import { useEffect, useRef, useState } from 'react';
import {
  presetArtwork,
  type AssetArtwork,
  playbackCommand,
  playbackState,
  type AudioState,
  type AudioAction,
} from './api';
import { AddBlockChooser } from './AddBlockChooser';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import { TouchAdjust } from './TouchAdjust';
import { DragFader } from './DragFader';
import { LevelMatch } from './LevelMatch';
import { MasterLevel } from './MasterLevel';
import { EditQueue } from './editQueue';

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
  const [performance, setPerformance] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [matching, setMatching] = useState(false);
  const [selection, setSelection] = useWorkspaceState('native-selection', {
    session: '',
    target: 'outputLevel',
  });
  // Session identity prevents remembered block IDs from selecting a different rig.
  const target =
    selection.session === state?.session ? selection.target : 'outputLevel';
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
        if (alive.current) setError(String(cause));
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
  async function apply(id: string, value: number) {
    if (!state || sending.current) return;
    generation.current += 1;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const token = crypto.randomUUID();
      const started = await playbackCommand(state, {
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
    } catch (cause) {
      if (alive.current) {
        setError(String(cause));
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
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function recall(id: string, owned: boolean) {
    if (!state || sending.current || adjustment.current || eqEditing) return;
    sending.current = true;
    generation.current += 1;
    setBusy(true);
    setError('');
    try {
      const next = await playbackCommand(state, {
        kind: 'load_preset',
        preset_id: id,
        owned,
      });
      if (alive.current) {
        setState(next);
        setTarget('outputLevel');
        setGroup('tone');
        setDraft(null);
        onPlaying(next.preset_name ?? 'Saved preset');
      }
    } catch (cause) {
      if (alive.current) {
        setError(String(cause));
        const next = await playbackState().catch(() => null);
        if (next) setState(next);
      }
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
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
        setError(String(cause));
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
        setError(String(cause));
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
      if (alive.current) setError(String(cause));
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
      if (alive.current) setState(next);
    });
    void ready.catch((cause) => {
      if (alive.current) setError(String(cause));
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
        setError(String(cause));
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
      if (alive.current) setError(String(cause));
    } finally {
      if (adjustment.current === queue) adjustment.current = null;
      if (alive.current) {
        setDraft(null);
        setAdjusting(false);
        setBusy(false);
      }
    }
  }
  async function saveCopy() {
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
      const next = await playbackCommand(state, {
        kind: 'save_copy',
        name: copyName.trim(),
      });
      if (alive.current) {
        setState(next);
        setDraft(null);
        setSaveOpening(null);
      }
    } catch (cause) {
      if (alive.current) setError(String(cause));
      // Do not repeat a write after a lost response. Polling retrieves its saved identity.
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  if (state?.phase !== 'running') {
    if (hideInactive) return null;
    return (
      <section className="panel space-y-3" aria-label="Rig playback">
        <h2>
          {!state
            ? 'Checking audio…'
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
        {state?.phase === 'stopped' && state.configured ? (
          <p>
            Resume picks up where you left off
            {state.preset_name ? ` with ${state.preset_name}` : ''}, including
            unsaved edits. Or choose another rig from Library.
          </p>
        ) : (
          <p>
            Choose a rig from Library to play. Audio setup is only needed when
            configuring your interface.
          </p>
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
                  if (alive.current) setError(String(cause));
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
        </div>
      </section>
    );
  }
  const control =
    state.controls.find((c) => c.target === target) ?? state.controls[0];
  const selectedTarget = control?.target ?? '';
  const activeDraft = draft?.target === control?.target ? draft : null;
  const stale =
    !!activeDraft &&
    (activeDraft.session !== state.session ||
      activeDraft.revision !== state.revision);
  const modelPending =
    !!state.model_change &&
    ['verifying', 'preparing', 'ready', 'applying'].includes(
      state.model_change.phase,
    );
  const unavailable =
    !connected || busy || eqEditing || !!error || modelPending;
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
    <div className="knob-strip" role="group" aria-label="Performance knobs">
      {knobs.map(({ label, item, hint }) => {
        const shown =
          item && draft?.target === item.target ? draft.value : item?.value;
        return (
          <div
            key={label}
            className="knob-cell"
            data-inactive={!item || !!hint || undefined}
            title={item?.label}
          >
            <span className="knob-label">{label}</span>
            <strong className="knob-value">{item ? item.display : '—'}</strong>
            {item ? (
              <DragFader
                value={shown ?? 0}
                dragging={draft?.target === item.target && !adjusting}
                disabled={disabled}
                onBegin={(value) => {
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
            ) : (
              <span className="knob-hint">{hint}</span>
            )}
            {item && hint && <span className="knob-hint">{hint}</span>}
          </div>
        );
      })}
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
      const laneGroups = layout
        ? layout[lane].flatMap((b) =>
            groups.filter((c) => c.target === `block:${b.id}:enabled`),
          )
        : lane === 'left'
          ? groups
          : [];
      if (lane === 'right' && !laneGroups.length && !layout?.stereo) return [];
      return [
        {
          id: lane,
          input: layout?.stereo ? (lane === 'left' ? 'IN L' : 'IN R') : 'IN',
          blocks: laneGroups.map((c) => {
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
            const showArtwork =
              chainView === 'artwork' &&
              !!state.configured &&
              !state.configured.draft;
            return {
              id,
              label: blockName(c.label),
              kind: blockKind(gear),
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
  if (performance)
    return (
      <>
        <PerformView
          state={state}
          lanes={chainLanes}
          disabled={disabled || !!draft || !!picker}
          onToggle={(id) => {
            const enabled = groups.find(
              (c) => c.target === `block:${id}:enabled`,
            );
            if (enabled)
              void apply(enabled.target, enabled.value === 1 ? 0 : 1);
          }}
          onRecall={(id, owned) => void recall(id, owned)}
          onEdit={() => setPerformance(false)}
          knobs={knobStrip}
        />
        {error && <p role="alert">{error}</p>}
      </>
    );
  return (
    <section
      className="instrument-surface live-rig space-y-3"
      aria-label="Sounding rig"
    >
      <div className="rig-performance-header">
        <RigPresetSelector
          state={state}
          disabled={disabled || !!draft || !!picker}
          onSelect={(id, owned) => void recall(id, owned)}
        />
        <Button
          className="preset-save"
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
          variant="ghost"
          size="icon"
          aria-label="Preset actions"
          className="preset-actions"
          disabled={disabled || !!draft || !!picker}
          onClick={() => setActionsOpen(true)}
        >
          <DotsThree aria-hidden="true" />
        </Button>
      </div>
      {knobStrip}
      <MasterLevel />
      <span
        role="status"
        data-testid="live-status"
        className="sr-only"
        data-edited={state.modified}
      >
        {busy ? 'Applying…' : state.modified ? 'Unsaved edits' : 'Saved'}
      </span>
      {error && !adjusting && (
        <div className="error rig-recovery" role="alert">
          <p>{error}</p>
          <Button variant="outline" onClick={() => setError('')}>
            Acknowledge and refresh
          </Button>
        </div>
      )}
      <div className="rig-workspace" data-inspecting={!!selectedBlock}>
        <div className="rig-chain-column">
          <div className="chain-bar">
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
          {adding && (
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
              onCancel={() => setMatching(false)}
            >
              <LevelMatch
                output={state.controls.find((c) => c.target === 'outputLevel')}
                disabled={disabled || busy}
                onApply={(value) => apply('outputLevel', value)}
                onClose={() => setMatching(false)}
              />
            </AdjustmentDialog>
          )}
          {actionsOpen && (
            <AdjustmentDialog
              title="Preset actions"
              onCancel={() => setActionsOpen(false)}
            >
              <div className="menu-list">
                <button
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
                </button>
                <button
                  type="button"
                  disabled={disabled || !!draft || !!picker}
                  onClick={() => {
                    setActionsOpen(false);
                    setPerformance(true);
                  }}
                >
                  Perform view
                </button>
                <button
                  type="button"
                  disabled={
                    disabled ||
                    !!draft ||
                    state.phase !== 'running' ||
                    !state.controls.some((c) => c.target === 'outputLevel')
                  }
                  onClick={() => {
                    setActionsOpen(false);
                    setMatching(true);
                  }}
                >
                  Match level…
                  <span className="caption">
                    Play for eight seconds to level this preset with the others
                  </span>
                </button>
              </div>
              <div
                className="menu-choice"
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
          <ChainView
            label="Sounding tone blocks"
            appearance={chainView}
            disabled={disabled || !!draft}
            selected={selectedBlock}
            onSelect={(id) => {
              const prefix = `block:${id}:`;
              setTarget(
                state.controls.find(
                  (item) => item.target.startsWith(prefix) && !item.toggle,
                )?.target ?? `block:${id}:enabled`,
              );
              setDraft(null);
              revealInspector();
            }}
            lanes={chainLanes}
          />
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
                generation.current += 1;
                sending.current = true;
                setBusy(true);
                try {
                  const current = await playbackState();
                  assertAuditionOwner(
                    picker.opening,
                    current,
                    picker.request,
                    current.model_change,
                  );
                  const next = await playbackCommand(current, {
                    kind: 'replace_model',
                    assignment: { target: picker.target, asset },
                  });
                  if (alive.current) {
                    setState(next);
                    setPicker({
                      ...picker,
                      request: next.model_change?.request,
                    });
                    setError('');
                  }
                } finally {
                  sending.current = false;
                  if (alive.current) setBusy(false);
                }
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
                    if (alive.current) setError(String(cause));
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
          className="rig-inspector-column"
          ref={inspector}
          tabIndex={-1}
          aria-label="Sound controls"
        >
          {!selectedBlock && (
            <div className="control-navigation" aria-label="Control groups">
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
          )}
          {selectedBlock && (
            <div className="effect-inspector" aria-label="Selected effect">
              <div className="effect-inspector-heading">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Show rig controls"
                  onClick={() => {
                    setTarget('outputLevel');
                    setGroup('tone');
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
                <div className="min-w-0">
                  <span className="eyebrow">
                    {selectedLane === 'left' ? 'Left' : 'Right'} chain ·
                    selected block
                  </span>
                  <h3 className="selected-effect-heading">
                    {groups
                      .find(
                        (c) => c.target === `block:${selectedBlock}:enabled`,
                      )
                      ?.label.replace(/(?: · (?:left|right))? · enabled$/, '')}
                  </h3>
                </div>
                {(() => {
                  const enabled = groups.find(
                    (c) => c.target === `block:${selectedBlock}:enabled`,
                  );
                  return (
                    enabled && (
                      <LedToggle
                        on={enabled.value === 1}
                        label={`${blockName(enabled.label)} on`}
                        disabled={disabled}
                        onToggle={() =>
                          void apply(
                            enabled.target,
                            enabled.value === 1 ? 0 : 1,
                          )
                        }
                      />
                    )
                  );
                })()}
                <Button
                  aria-label="Change model"
                  title="Choose another model"
                  variant="outline"
                  disabled={disabled || !!draft}
                  onClick={() =>
                    setPicker({
                      target: selectedBlock,
                      name:
                        groups.find(
                          (c) => c.target === `block:${selectedBlock}:enabled`,
                        )?.label ?? 'Selected block',
                      opening: state,
                    })
                  }
                >
                  Change model
                </Button>
              </div>
              {orderedBlocks.length > 1 && (
                <div
                  className="action-row"
                  role="group"
                  aria-label="Block position"
                >
                  {([-1, 1] as const).map((direction) => {
                    const order = movedBlockOrder(
                      orderedBlocks,
                      selectedBlock,
                      direction,
                    );
                    return (
                      <Button
                        key={direction}
                        variant="ghost"
                        disabled={disabled || !!draft || !order}
                        onClick={() => {
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
                        {direction === -1 ? (
                          <ArrowLeft aria-hidden="true" />
                        ) : (
                          <ArrowRight aria-hidden="true" />
                        )}
                        {direction === -1 ? 'Move earlier' : 'Move later'}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="live-parameter-grid" aria-label="Sounding controls">
            {state.controls
              .filter(
                (item) =>
                  !item.target.endsWith(':enabled') &&
                  (selectedTarget.startsWith('block:')
                    ? item.target.startsWith(
                        selectedTarget.slice(
                          0,
                          selectedTarget.lastIndexOf(':') + 1,
                        ),
                      )
                    : !item.target.startsWith('block:') &&
                      controlGroup(item.target) === group),
              )
              .map((item) => (
                <button
                  type="button"
                  className="live-value-trigger value-row"
                  data-toggle={item.toggle || undefined}
                  key={item.target}
                  disabled={disabled}
                  aria-haspopup={item.toggle ? undefined : 'dialog'}
                  aria-pressed={item.toggle ? item.value === 1 : undefined}
                  aria-label={`Adjust sounding ${item.label}`}
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
                  <span className="value-row-label">
                    {shortControlLabel(item.label)}
                  </span>
                  <strong className="value-row-value">{item.display}</strong>
                  {!item.toggle && (
                    <DragFader
                      value={
                        draft?.target === item.target ? draft.value : item.value
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
                </button>
              ))}
          </div>
          {state.eq
            ?.filter((row) =>
              selectedTarget.startsWith(`block:${row.block_id}:`),
            )
            .map((row) => (
              <LiveEq
                key={`${state.session}:${row.block_id}`}
                state={state}
                blockId={row.block_id}
                send={(current, edit) =>
                  playbackCommand(current, {
                    kind: 'authoring',
                    action: { kind: 'eq', block_id: row.block_id, edit },
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
                    old?.session === next.session &&
                    old.revision > next.revision
                      ? old
                      : next,
                  );
                }}
              />
            ))}
          {selectedBlock &&
            (state.models?.some((m) => m.target === selectedBlock) ||
              (state.configured && !state.configured.draft)) && (
              <details className="disclosure">
                <summary>Model information &amp; offline images</summary>
                {state.models?.find((m) => m.target === selectedBlock) ? (
                  <ArtworkDeck
                    model
                    id={
                      state.models.find((m) => m.target === selectedBlock)!
                        .asset
                    }
                  />
                ) : state.configured && !state.configured.draft ? (
                  <ArtworkDeck
                    key={`${state.configured.preset_id}:${selectedBlock}`}
                    id={state.configured.preset_id}
                    owned={state.configured.owned}
                    blockId={selectedBlock}
                  />
                ) : null}
              </details>
            )}
        </div>
      </div>
      <output className="sr-only" data-testid="live-readback">
        Confirmed: {control?.display ?? '—'}
      </output>
      {adjusting && control && control.target === target && (
        <AdjustmentDialog
          title={control.label}
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
            value={activeDraft?.value ?? control.value}
            baseline={activeDraft?.baseline ?? control.value}
            min={0}
            max={1}
            step={0.01}
            disabled={disabled || stale}
            format={(v) =>
              confirmedControlDisplay(control.display, v !== control.value)
            }
            onChange={(value) => {
              latestValue.current = value;
              setDraft((old) => (old ? { ...old, value } : old));
              adjustment.current?.preview(value);
            }}
          />
          <div className="editor-actions">
            <Button
              disabled={disabled || stale}
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
          {stale && (
            <p role="alert">
              Sounding session changed. Cancel and reopen this control.
            </p>
          )}
        </AdjustmentDialog>
      )}
      <MidiControls
        configured={state.configured?.midi ?? null}
        disabled={disabled}
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
              {busy ? 'Saving…' : 'Save sounding copy'}
            </Button>
          </div>
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
