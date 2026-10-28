import { Power } from '@phosphor-icons/react';
import { LiveEq } from './LiveEq';
import { ArtworkDeck } from './AssetArtwork';
import { ModelPicker } from './ModelPicker';
import { useEffect, useRef, useState } from 'react';
import {
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
  const [imageControls, setImageControls] = useState(false);
  const [draft, setDraft] = useState<{
    target: string;
    value: number;
    baseline: number;
    session: string;
    revision: number;
  } | null>(null);
  const [settingDraft, setSettingDraft] = useState<{
    control: AudioState['controls'][number];
    value: number;
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
    async function refresh() {
      const requested = generation.current;
      try {
        const next = await playbackState();
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
        if (alive.current) timer = setTimeout(() => void refresh(), 1000);
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
      const next = await playbackCommand(state, {
        kind: 'set_control',
        target: id,
        value,
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
    adjustment.current = new EditQueue<AudioState>(
      'live',
      crypto.randomUUID(),
      Promise.resolve(),
      async (edit) => {
        const value = edit.phase === 'cancel' ? opening : edit.value;
        // Opening/closing without adjustment must not mark the session modified.
        if (
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
            kind: 'set_control',
            target: control.target,
            value,
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
          Open a preset in the library to author it, or use Audio setup to play
          a saved preset. Live controls appear here when its audio session is
          running.
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
  const disabled = !connected || busy || eqEditing || !!error || modelPending;
  const groups = state.controls.filter(
    (c) => c.target.startsWith('block:') && c.target.endsWith(':enabled'),
  );
  const selectedBlock = selectedTarget.startsWith('block:')
    ? selectedTarget.split(':')[1]
    : groups[0]?.target.split(':')[1];
  const layout = state.authoring?.layout;
  const lane = layout?.right.some((b) => b.id === selectedBlock)
    ? 'right'
    : 'left';
  const laneBlocks = layout?.[lane] ?? [];
  const position = laneBlocks.findIndex(
    (b) => b.id === selectedBlock && !b.insert,
  );
  function reorder(direction: number) {
    const next = position + direction;
    if (position < 0 || next < 0 || next >= laneBlocks.length) return;
    const ids = laneBlocks.map((b) => b.id);
    [ids[position], ids[next]] = [ids[next]!, ids[position]!];
    void author({
      kind: 'edit',
      edit: { kind: 'reorder', lane, block_ids: ids },
    });
  }
  return (
    <section className="panel live-rig space-y-3" aria-label="Sounding rig">
      <div className="section-heading">
        <h2>Chain</h2>
        <span role="status" data-testid="live-status">
          {busy
            ? 'Applying…'
            : state.modified
              ? 'Session modified'
              : 'Saved preset playing'}
        </span>
      </div>
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
        aria-label="Sounding tone blocks"
      >
        {groups.map((c) => (
          <div
            key={c.target}
            className="live-effect min-w-0 rounded-md border border-border p-2"
          >
            <Button
              variant="ghost"
              className="h-11 w-full justify-start px-1 text-left whitespace-normal"
              onClick={() => {
                const prefix = c.target.slice(0, -7);
                setTarget(
                  state.controls.find(
                    (item) => item.target.startsWith(prefix) && !item.toggle,
                  )?.target ?? c.target,
                );
                setDraft(null);
              }}
            >
              <span className="line-clamp-2">
                {c.label.replace(/ · enabled$/, '')}
              </span>
            </Button>
            {state.configured &&
              !state.configured.draft &&
              !state.models?.some(
                (m) => m.target === c.target.slice(6, -8),
              ) && (
                <ArtworkDeck
                  compact
                  key={state.configured.preset_id}
                  id={state.configured.preset_id}
                  owned={state.configured.owned}
                  blockId={c.target.slice(6, -8)}
                />
              )}
            <div className="live-effect-actions">
              <Button
                variant="outline"
                aria-label="Change model"
                className="min-w-0 flex-1"
                disabled={disabled || !!draft}
                onClick={() =>
                  setPicker({
                    target: c.target.slice(6, -8),
                    name: c.label.replace(/ · enabled$/, ''),
                    opening: state,
                  })
                }
              >
                Model
              </Button>
              <Button
                className="effect-power h-11 w-11 shrink-0 p-0"
                aria-label={`Enable ${c.label.replace(/ · enabled$/, '')}`}
                title={
                  c.value === 1
                    ? 'On — tap to bypass'
                    : 'Bypassed — tap to enable'
                }
                variant={c.value === 1 ? 'secondary' : 'ghost'}
                aria-pressed={c.value === 1}
                disabled={disabled}
                onClick={() => void apply(c.target, c.value === 1 ? 0 : 1)}
              >
                <Power className="size-5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ))}
      </div>
      {layout && (
        <details>
          <summary>Chain actions</summary>
          <div
            className="action-row"
            role="group"
            aria-label="Live chain actions"
          >
            <Button
              variant="outline"
              disabled={disabled || !!draft || !state.authoring?.can_undo}
              onClick={() => void author({ kind: 'undo' })}
            >
              Undo structure
            </Button>
            <Button
              variant="outline"
              disabled={disabled || !!draft || !state.authoring?.can_redo}
              onClick={() => void author({ kind: 'redo' })}
            >
              Redo structure
            </Button>
            <Button
              variant="outline"
              disabled={disabled || !!draft}
              onClick={() =>
                void author({
                  kind: 'edit',
                  edit: { kind: 'stereo', enabled: !layout.stereo },
                })
              }
            >
              {layout.stereo ? 'Use mono chain' : 'Use stereo chains'}
            </Button>
            {(['stereo', 'left', 'right', 'dual'] as const).map((mode) => (
              <Button
                key={mode}
                variant="outline"
                disabled={disabled || !!draft}
                aria-pressed={(layout.input_mode ?? 'stereo') === mode}
                onClick={() =>
                  void author({ kind: 'edit', edit: { kind: 'input', mode } })
                }
              >
                {mode === 'dual'
                  ? 'Dual mono'
                  : `${mode.charAt(0).toUpperCase()}${mode.slice(1)} input`}
              </Button>
            ))}
            {selectedBlock && position >= 0 && (
              <>
                <Button
                  variant="outline"
                  disabled={disabled || !!draft || position === 0}
                  onClick={() => reorder(-1)}
                >
                  Earlier
                </Button>
                <Button
                  variant="outline"
                  disabled={
                    disabled || !!draft || position === laneBlocks.length - 1
                  }
                  onClick={() => reorder(1)}
                >
                  Later
                </Button>
                <Button
                  variant="outline"
                  disabled={disabled || !!draft}
                  onClick={() =>
                    void author({
                      kind: 'edit',
                      edit: {
                        kind: 'duplicate',
                        block_id: selectedBlock,
                        lane,
                        index: position + 1,
                      },
                    })
                  }
                >
                  Duplicate block
                </Button>
                {layout.stereo && (
                  <Button
                    variant="outline"
                    disabled={disabled || !!draft}
                    onClick={() =>
                      void author({
                        kind: 'edit',
                        edit: {
                          kind: 'move',
                          block_id: selectedBlock,
                          lane: lane === 'left' ? 'right' : 'left',
                          index: 0,
                        },
                      })
                    }
                  >
                    Move to {lane === 'left' ? 'right' : 'left'} chain
                  </Button>
                )}
                <Button
                  variant="outline"
                  disabled={disabled || !!draft}
                  onClick={() =>
                    void author({ kind: 'remove', block_id: selectedBlock })
                  }
                >
                  Remove block
                </Button>
              </>
            )}
          </div>
        </details>
      )}
      {!!state.authoring?.settings?.length && (
        <details>
          <summary>DSP settings</summary>
          <div
            className="action-row"
            role="group"
            aria-label="Prepared DSP settings"
          >
            {state.authoring.settings.map((setting) => (
              <Button
                key={setting.target}
                variant="outline"
                disabled={disabled || !!draft}
                onClick={() =>
                  setSettingDraft({
                    control: setting,
                    value: setting.value,
                    session: state.session,
                    revision: state.revision,
                  })
                }
              >
                {setting.label} · {setting.display}
              </Button>
            ))}
          </div>
        </details>
      )}
      {settingDraft && (
        <AdjustmentDialog
          title={settingDraft.control.label}
          onCancel={() => {
            if (!busy) setSettingDraft(null);
          }}
        >
          <TouchAdjust
            label="Prepared setting value"
            value={settingDraft.value}
            baseline={settingDraft.control.value}
            min={0}
            max={1}
            step={
              state.authoring?.setting_steps?.[settingDraft.control.target] ??
              (settingDraft.control.toggle ? 1 : 0.01)
            }
            disabled={busy}
            onChange={(value) =>
              setSettingDraft((old) => (old ? { ...old, value } : old))
            }
            format={(value) =>
              settingDraft.control.toggle
                ? value === 1
                  ? 'On'
                  : 'Off'
                : `${(value * 100).toFixed(1)}%`
            }
            commitHint="Audio restarts when applied."
          />
          <div className="action-row">
            <Button
              disabled={
                busy ||
                !Number.isFinite(settingDraft.value) ||
                state.session !== settingDraft.session ||
                state.revision !== settingDraft.revision
              }
              onClick={() => {
                void author({
                  kind: 'parameter',
                  parameter: settingDraft.control.target,
                  value: settingDraft.value,
                }).then(() => {
                  if (alive.current) setSettingDraft(null);
                });
              }}
            >
              Apply
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setSettingDraft(null)}
            >
              Cancel
            </Button>
          </div>
        </AdjustmentDialog>
      )}
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
      <div className="section-heading">
        <h3>Controls</h3>
        <div className="flex gap-1">
          <Button
            variant={
              !selectedTarget.startsWith('block:') && !imageControls
                ? 'secondary'
                : 'ghost'
            }
            aria-pressed={
              !selectedTarget.startsWith('block:') && !imageControls
            }
            onClick={() => {
              setTarget('outputLevel');
              setImageControls(false);
              setDraft(null);
            }}
          >
            Global
          </Button>
          {state.controls.some((c) => c.target === 'spreadEnabled') && (
            <Button
              variant={
                !selectedTarget.startsWith('block:') && imageControls
                  ? 'secondary'
                  : 'ghost'
              }
              aria-pressed={
                !selectedTarget.startsWith('block:') && imageControls
              }
              onClick={() => {
                setTarget('spreadEnabled');
                setImageControls(true);
                setDraft(null);
              }}
            >
              Stereo
            </Button>
          )}
        </div>
      </div>
      {imageControls && !selectedTarget.startsWith('block:') && (
        <p className="text-sm text-muted-foreground">
          Spread widens a mono chain into stereo.
        </p>
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
                  imageControls ===
                    (item.target.startsWith('spread') ||
                      item.target === 'outputBalance')),
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
              <span>{item.label}</span>
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
                kind: 'set_eq',
                block_id: row.block_id,
                edit,
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
              v === control.value
                ? control.display
                : `${Math.round(v * 100)}% · sending`
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
