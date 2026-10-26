import { useEffect, useRef, useState } from 'react';
import { playbackCommand, playbackState, type AudioState } from './api';
import { Button } from './components/ui/button';
import { TouchAdjust } from './TouchAdjust';

/** The sounding worker owns these controls; no simulator or offline editor writes. */
export function LiveRig({
  connected,
  onPlaying,
}: {
  connected: boolean;
  onPlaying: (name: string | null) => void;
}) {
  const [state, setState] = useState<AudioState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState('outputLevel');
  const [draft, setDraft] = useState<{
    target: string;
    value: number;
    session: string;
    revision: number;
  } | null>(null);
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
  if (state?.phase !== 'running') return null;
  const control =
    state.controls.find((c) => c.target === target) ?? state.controls[0];
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
    <section className="panel live-rig space-y-4" aria-label="Sounding rig">
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
      <p className="caption">
        Changes here affect the running audio. Session adjustments reset on
        restart; saving the live session is still pending.
      </p>
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
        aria-label="Sounding tone blocks"
      >
        {groups.map((c) => (
          <div
            key={c.target}
            className="min-w-0 rounded-md border border-current/20 p-2"
          >
            <Button
              variant="outline"
              className="h-auto w-full justify-start text-left whitespace-normal"
              onClick={() => {
                setTarget(c.target);
                setDraft(null);
              }}
            >
              {c.label.replace(/ · enabled$/, '')}
            </Button>
            <Button
              className="mt-2 w-full"
              variant={c.value === 1 ? 'default' : 'outline'}
              aria-pressed={c.value === 1}
              disabled={disabled}
              onClick={() => void apply(c.target, c.value === 1 ? 0 : 1)}
            >
              {c.value === 1 ? 'On' : 'Bypassed'}
            </Button>
          </div>
        ))}
      </div>
      <div className="form-grid">
        <label className="field">
          Sounding control
          <select
            value={control?.target ?? ''}
            disabled={busy}
            onChange={(e) => {
              setTarget(e.target.value);
              setDraft(null);
            }}
          >
            {state.controls.map((c) => (
              <option key={c.target} value={c.target}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <output data-testid="live-readback">
          Confirmed: {control?.display ?? '—'}
        </output>
      </div>
      {control &&
        (control.toggle ? (
          <Button
            disabled={disabled}
            aria-pressed={control.value === 1}
            onClick={() =>
              void apply(control.target, control.value === 1 ? 0 : 1)
            }
          >
            {control.label}: {control.value === 1 ? 'On' : 'Off'}
          </Button>
        ) : (
          <>
            <TouchAdjust
              label="sounding value"
              commitHint="Adjust here, then Apply to sound. This does not save a preset."
              value={activeDraft?.value ?? control.value}
              baseline={control.value}
              min={0}
              max={1}
              step={0.01}
              disabled={disabled || stale}
              format={(v) =>
                v === control.value
                  ? control.display
                  : `${Math.round(v * 100)}% · pending`
              }
              onChange={(value) =>
                setDraft({
                  target: control.target,
                  value,
                  session: state.session,
                  revision: state.revision,
                })
              }
            />
            <div className="editor-actions">
              <Button
                disabled={disabled || !activeDraft || stale}
                onClick={() =>
                  activeDraft && void apply(control.target, activeDraft.value)
                }
              >
                Apply to sound
              </Button>
              <Button
                variant="outline"
                disabled={!activeDraft || busy}
                onClick={() => setDraft(null)}
              >
                Discard adjustment
              </Button>
            </div>
          </>
        ))}
      {stale && (
        <p role="alert">
          The sounding session changed. Discard this adjustment before editing
          again.
        </p>
      )}
      {error && (
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
