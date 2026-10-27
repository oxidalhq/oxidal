import { ArtworkDeck } from './AssetArtwork';
import { useEffect, useRef, useState } from 'react';
import { playbackCommand, playbackState, type AudioState } from './api';
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
  const [copyName, setCopyName] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [target, setTarget] = useState('outputLevel');
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
  const disabled = !connected || busy || !!error;
  const groups = state.controls.filter(
    (c) => c.target.startsWith('block:') && c.target.endsWith(':enabled'),
  );
  return (
    <section className="panel live-rig space-y-3" aria-label="Sounding rig">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Sounding session</span>
          <h2>Live controls</h2>
        </div>
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
              className="h-auto w-full justify-start px-1 text-left whitespace-normal"
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
              {c.label.replace(/ · enabled$/, '')}
            </Button>
            {state.configured && (
              <ArtworkDeck
                compact
                key={state.configured.preset_id}
                id={state.configured.preset_id}
                owned={state.configured.owned}
                blockId={c.target.slice(6, -8)}
              />
            )}
            <Button
              className="effect-power mt-1"
              variant={c.value === 1 ? 'secondary' : 'ghost'}
              aria-pressed={c.value === 1}
              disabled={disabled}
              onClick={() => void apply(c.target, c.value === 1 ? 0 : 1)}
            >
              {c.value === 1 ? 'On' : 'Bypassed'}
            </Button>
          </div>
        ))}
      </div>
      <div className="section-heading">
        <h3>Controls</h3>
        <Button
          variant="ghost"
          onClick={() => {
            setTarget('outputLevel');
            setDraft(null);
          }}
        >
          Global
        </Button>
      </div>
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
                : !item.target.startsWith('block:')),
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
