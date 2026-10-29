import { GearIcon } from './GearIcon';
import { MidiControls } from './SceneMidi';
import { NativeAuthoring } from './NativeAuthoring';
import {
  Power,
  ArrowRight,
  Stack,
  SlidersHorizontal,
  Waveform,
  MusicNotes,
  ArrowsSplit,
  Plus,
  Swap,
  ImageSquare,
  SquaresFour,
  ArrowCounterClockwise,
  ArrowClockwise,
  ArrowLeft,
} from '@phosphor-icons/react';
import { RigPresetSelector } from './RigPresetSelector';
import {
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
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import { TouchAdjust } from './TouchAdjust';
import { EditQueue } from './editQueue';

/** The sounding worker owns these controls; no simulator or offline editor writes. */
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
  const [adjusting, setAdjusting] = useState(false);
  const [picker, setPicker] = useState<{
    target: string;
    name: string;
    opening: AudioState;
    insert?: boolean;
    format?: 'nam' | 'ir';
  } | null>(null);
  const [target, setTarget] = useState('outputLevel');
  const [group, setGroup] = useState<ControlGroup>('tone');
  const [draft, setDraft] = useState<{
    target: string;
    value: number;
    baseline: number;
    session: string;
    revision: number;
  } | null>(null);
  const adjustment = useRef<EditQueue<AudioState> | null>(null);
  const latestValue = useRef(0);
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
  function openAdjustment(control: AudioState['controls'][number]) {
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
    setAdjusting(true);
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
    if (!state || sending.current) return;
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
        <p>
          Choose a rig from Library to play. Audio setup is only needed when
          configuring your interface.
        </p>
        <div className="action-row">
          <Button onClick={onLibrary}>Browse presets</Button>
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
  const selectedLane = state.authoring?.layout?.right.some(
    (block) => block.id === selectedBlock,
  )
    ? 'right'
    : 'left';
  const orderedBlocks = state.authoring?.layout?.[selectedLane] ?? [];
  return (
    <section className="panel live-rig space-y-3" aria-label="Sounding rig">
      <RigPresetSelector
        state={state}
        disabled={disabled || !!draft || !!picker}
        onSelect={(id, owned) => void recall(id, owned)}
      />
      <div className="section-heading">
        <h2 className="flex items-center gap-2">
          <Waveform size={20} aria-hidden="true" />
          Signal chain
        </h2>
        <Button variant="outline" onClick={onLibrary}>
          <Stack aria-hidden="true" /> Browse library
        </Button>
        <span role="status" data-testid="live-status">
          {busy ? 'Applying…' : state.modified ? 'Edited' : 'Saved'}
        </span>
      </div>
      <div className="chain-toolbar">
        <div className="action-row" role="group" aria-label="Chain view">
          {(['compact', 'artwork'] as const).map((view) => (
            <Button
              key={view}
              variant={chainView === view ? 'secondary' : 'ghost'}
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
              {view === 'compact' ? (
                <SquaresFour aria-hidden="true" />
              ) : (
                <ImageSquare aria-hidden="true" />
              )}
              {view === 'compact' ? 'Compact' : 'Artwork'}
            </Button>
          ))}
        </div>
        <div className="action-row" role="group" aria-label="Tone history">
          <Button
            variant="ghost"
            disabled={disabled || !!draft || !state.authoring?.can_undo}
            onClick={() => void author({ kind: 'undo' })}
          >
            <ArrowCounterClockwise aria-hidden="true" /> Undo change
          </Button>
          <Button
            variant="ghost"
            disabled={disabled || !!draft || !state.authoring?.can_redo}
            onClick={() => void author({ kind: 'redo' })}
          >
            <ArrowClockwise aria-hidden="true" /> Redo change
          </Button>
          <Button
            variant="ghost"
            disabled={
              disabled ||
              !!draft ||
              !state.modified ||
              !state.configured ||
              state.configured.draft
            }
            onClick={() => setRestoreOpening(state)}
          >
            Reload saved
          </Button>
        </div>
      </div>
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
            <p role="status">The rig changed. Close and reopen Reload saved.</p>
          )}
        </AdjustmentDialog>
      )}
      {state.modified && (
        <p className="caption">
          Live edits · saved preset unchanged. Save a copy to keep this sound.
        </p>
      )}
      <div
        className="signal-rack"
        data-chain-view={chainView}
        aria-label="Sounding tone blocks"
      >
        {(['left', 'right'] as const).map((lane) => {
          const layout = state.authoring?.layout;
          const laneGroups = layout
            ? layout[lane].flatMap((b) =>
                groups.filter((c) => c.target === `block:${b.id}:enabled`),
              )
            : lane === 'left'
              ? groups
              : [];
          if (lane === 'right' && !laneGroups.length && !layout?.stereo)
            return null;
          return (
            <div
              className="signal-lane"
              key={lane}
              aria-label={`${lane} signal chain`}
            >
              <span className="signal-port">
                {layout?.stereo ? (lane === 'left' ? 'IN L' : 'IN R') : 'IN'}
              </span>
              <div className="signal-blocks">
                {laneGroups.map((c, index) => (
                  <div
                    key={c.target}
                    className="live-effect signal-block"
                    data-selected={selectedBlock === c.target.split(':')[1]}
                    data-bypassed={c.value !== 1}
                  >
                    <span className="signal-block-index">
                      {String(index + 1).padStart(2, '0')}{' '}
                      <ArrowRight aria-hidden="true" />
                    </span>
                    <Button
                      variant="ghost"
                      className="signal-block-select h-11 w-full justify-start px-1 text-left whitespace-normal"
                      aria-pressed={selectedBlock === c.target.split(':')[1]}
                      disabled={disabled || !!draft}
                      onClick={() => {
                        const prefix = c.target.slice(0, -7);
                        setTarget(
                          state.controls.find(
                            (item) =>
                              item.target.startsWith(prefix) && !item.toggle,
                          )?.target ?? c.target,
                        );
                        setDraft(null);
                      }}
                    >
                      <GearIcon
                        className="signal-model-icon"
                        gear={
                          state.models?.some(
                            (model) => model.target === c.target.slice(6, -8),
                          )
                            ? ''
                            : ((artwork &&
                              artwork.id === artworkId &&
                              artwork.owned === artworkOwned
                                ? artwork.items
                                : []
                              ).find(
                                (item) =>
                                  item.block_id === c.target.slice(6, -8),
                              )?.gear ?? '')
                        }
                      />
                      <span className="line-clamp-2">
                        {c.label.replace(/ · (left|right) · enabled$/, '')}
                      </span>
                    </Button>
                    {chainView === 'artwork' &&
                      state.configured &&
                      !state.configured.draft &&
                      !state.models?.some(
                        (m) => m.target === c.target.slice(6, -8),
                      ) && (
                        <ArtworkDeck
                          compact
                          id={state.configured.preset_id}
                          owned={state.configured.owned}
                          blockId={c.target.slice(6, -8)}
                        />
                      )}
                    <div className="live-effect-actions">
                      <span className="signal-block-state">
                        {c.value === 1 ? 'On' : 'Bypassed'}
                      </span>
                      <Button
                        className="effect-power h-11 w-11 shrink-0 p-0"
                        aria-label={`Enable ${c.label.replace(/ · (left|right) · enabled$/, '')}`}
                        title={
                          c.value === 1
                            ? 'On — tap to bypass'
                            : 'Bypassed — tap to enable'
                        }
                        variant={c.value === 1 ? 'secondary' : 'ghost'}
                        aria-pressed={c.value === 1}
                        disabled={disabled}
                        onClick={() =>
                          void apply(c.target, c.value === 1 ? 0 : 1)
                        }
                      >
                        <Power className="size-5" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                ))}
                {!laneGroups.length && (
                  <span className="signal-empty">Direct signal</span>
                )}
              </div>
              <span className="signal-port">
                OUT <ArrowRight aria-hidden="true" />
              </span>
            </div>
          );
        })}
      </div>
      {state.slots?.some((s) => s.position.lane === 0) && (
        <div className="action-row">
          {(['nam', 'ir'] as const).map((format) => (
            <Button
              key={format}
              variant="outline"
              disabled={disabled || !!draft}
              onClick={() => {
                const slot = state.slots!.find((s) => s.position.lane === 0)!;
                setPicker({
                  target: slot.target,
                  name: `slot ${slot.position.index + 1}`,
                  opening: state,
                  insert: true,
                  format,
                });
              }}
            >
              <Plus aria-hidden="true" />
              {format === 'nam' ? 'Add NAM' : 'Add IR'}
            </Button>
          ))}
        </div>
      )}
      {picker && (
        <ModelPicker
          name={picker.name}
          initialFormat={picker.format}
          intent={picker.insert ? 'add' : 'replace'}
          onClose={() => setPicker(null)}
          onAudition={async (asset) => {
            generation.current += 1;
            sending.current = true;
            setBusy(true);
            try {
              const next = await playbackCommand(picker.opening, {
                kind: 'replace_model',
                assignment: { target: picker.target, asset },
              });
              if (alive.current) {
                setState(next);
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
                  current.model_change?.request !== state.model_change?.request
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
      <div className="control-navigation" aria-label="Control groups">
        {(
          [
            ['tone', 'Tone', SlidersHorizontal],
            ['gate', 'Gate', Waveform],
            ['pitch', 'Pitch', MusicNotes],
            ['stereo', 'Stereo', ArrowsSplit],
          ] as const
        )
          .filter(([id]) =>
            state.controls.some(
              (c) =>
                !c.target.startsWith('block:') && controlGroup(c.target) === id,
            ),
          )
          .map(([id, label, Icon]) => (
            <Button
              key={id}
              variant={!selectedBlock && group === id ? 'secondary' : 'ghost'}
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
              <Icon aria-hidden="true" />
              {label}
            </Button>
          ))}
      </div>
      {selectedBlock && (
        <div className="effect-inspector" aria-label="Selected effect">
          <div className="effect-inspector-heading">
            <div className="min-w-0">
              <span className="eyebrow">Selected block</span>
              <h3 className="selected-effect-heading">
                {groups
                  .find((c) => c.target === `block:${selectedBlock}:enabled`)
                  ?.label.replace(/ · (left|right) · enabled$/, '')}
              </h3>
            </div>
            <Button
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
              <Swap aria-hidden="true" /> Change model
            </Button>
          </div>
          <div className="action-row" role="group" aria-label="Block position">
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
          {state.configured &&
            !state.configured.draft &&
            !state.models?.some((m) => m.target === selectedBlock) && (
              <ArtworkDeck
                key={`${state.configured.preset_id}:${selectedBlock}`}
                id={state.configured.preset_id}
                owned={state.configured.owned}
                blockId={selectedBlock}
              />
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
              className="live-value-trigger"
              key={item.target}
              disabled={disabled}
              aria-haspopup={item.toggle ? undefined : 'dialog'}
              aria-pressed={item.toggle ? item.value === 1 : undefined}
              aria-label={`Adjust sounding ${item.label}`}
              onClick={() => {
                setTarget(item.target);
                setDraft(null);
                if (item.toggle)
                  void apply(item.target, item.value === 1 ? 0 : 1);
                else openAdjustment(item);
              }}
            >
              <span>{shortControlLabel(item.label)}</span>
              <strong>{item.display}</strong>
            </button>
          ))}
      </div>
      {state.eq
        ?.filter((row) => selectedTarget.startsWith(`block:${row.block_id}:`))
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
                old?.session === next.session && old.revision > next.revision
                  ? old
                  : next,
              );
            }}
          />
        ))}
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
          status={state.authoring}
          selectedBlock={selectedBlock}
          disabled={unavailable || !!draft}
          busy={busy}
          session={state.session}
          revision={state.revision}
          author={author}
        />
      )}
      <details className="save-copy">
        <summary>Save copy</summary>
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
            variant="outline"
            disabled={disabled || !!draft || !copyName.trim()}
            onClick={() => void saveCopy()}
          >
            Save sounding copy
          </Button>
        </div>
      </details>
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
      {error && !adjusting && (
        <div role="alert">
          <p>{error}</p>
          <Button variant="outline" onClick={() => setError('')}>
            Acknowledge and refresh
          </Button>
        </div>
      )}
    </section>
  );
}
