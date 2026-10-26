import { useEffect, useRef, useState } from 'react';
import {
  capabilities,
  nativeState,
  nativeCommand,
  type NativeSnapshot,
  type NativeAction,
  type Preset,
} from './api';
import { EditQueue } from './editQueue';
import { TouchAdjust } from './TouchAdjust';
import { Button } from './components/ui/button';

const blockLabels: Record<string, string> = {
  enabled: 'Enabled',
  normalize: 'Normalise',
  inputGain: 'Input gain',
  outputGain: 'Output gain',
  mix: 'Mix',
};
function controlValue(state: NativeSnapshot | null, target: string) {
  return (
    state?.block_controls.find((p) => p.id === target)?.value ??
    state?.parameters.find((p) => p.id === target)?.normalized ??
    0.5
  );
}

/** Confirmed native state only; failed operations are refreshed, never automatically replayed. */
export function NativeEditor({
  presets,
  connected,
}: {
  presets: Preset[];
  connected: boolean;
}) {
  const [state, setState] = useState<NativeSnapshot | null>(null);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState('');
  const [requestedTarget, setTarget] = useState('toneBass');
  const target =
    requestedTarget.startsWith('block:') &&
    !state?.block_controls.some((p) => p.id === requestedTarget)
      ? 'toneBass'
      : requestedTarget;
  const [value, setValue] = useState('0.5');
  const [name, setName] = useState('My preset');
  const [owner] = useState(() => crypto.randomUUID());
  const queue = useRef<EditQueue<NativeSnapshot> | null>(null);
  const alive = useRef(false);
  const [baseline, setBaseline] = useState(0.5);
  const running = useRef(false);
  useEffect(() => {
    alive.current = true;
    const pending = queue;
    return () => {
      alive.current = false;
      void pending.current?.cancel().catch(() => {});
    };
  }, []);
  useEffect(() => {
    let active = true;
    void capabilities()
      .then(async (c) => {
        if (!active) return;
        setAvailable(c.native_editor);
        if (c.native_editor) {
          const s = await nativeState();
          if (active)
            setState((previous) =>
              previous?.session === s.session && previous.revision > s.revision
                ? previous
                : s,
            );
        }
      })
      .catch((e: unknown) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!available) return;
    let active = true;
    const timer = setInterval(() => {
      if (!running.current)
        void nativeState()
          .then((s) => {
            if (active && !running.current)
              setState((previous) =>
                previous?.session === s.session &&
                previous.revision > s.revision
                  ? previous
                  : s,
              );
          })
          .catch(() => {});
    }, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [available]);
  function publish(next: NativeSnapshot, expectedSession?: string) {
    if (alive.current)
      setState((previous) =>
        previous && expectedSession && previous.session !== expectedSession
          ? previous
          : previous?.session === next.session &&
              previous.revision > next.revision
            ? previous
            : next,
      );
  }
  function fail(cause: unknown) {
    if (!alive.current) return;
    setError(String(cause));
    void nativeState()
      .then(publish)
      .catch(() => {
        if (alive.current) setState(null);
      });
  }
  async function send(action: NativeAction) {
    if (!state || running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      publish(await nativeCommand(state, action), state.session);
    } catch (cause) {
      fail(cause);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function begin() {
    if (!state || running.current || state.edit) return;
    setError('');
    setBusy(true);
    running.current = true;
    const token = crypto.randomUUID();
    const starting = controlValue(state, target);
    setValue(String(starting));
    setBaseline(starting);
    const session = state.session;
    let cursor = state;
    const ready = nativeCommand(cursor, { kind: 'begin', owner, token, target })
      .then((next) => {
        cursor = next;
        publish(next, session);
      })
      .finally(() => {
        running.current = false;
      });
    const next = new EditQueue<NativeSnapshot>(
      owner,
      token,
      ready,
      async (edit) => {
        running.current = true;
        try {
          // A lost preview reply may leave our cursor behind the daemon. Refresh
          // before recovery cancellation; the owner/token still guard the edit.
          if (edit.phase === 'cancel') {
            const latest = await nativeState();
            if (latest.session !== session)
              throw new Error('Native session changed; reopen the editor.');
            cursor = latest;
          }
          const action: NativeAction =
            edit.phase === 'cancel'
              ? { kind: 'cancel', owner, token }
              : {
                  kind: edit.phase,
                  owner,
                  token,
                  sequence: edit.sequence,
                  value: edit.value,
                };
          cursor = await nativeCommand(cursor, action);
          return cursor;
        } finally {
          running.current = false;
        }
      },
      (next) => publish(next, session),
      fail,
    );
    queue.current = next;
    try {
      await ready;
    } catch (cause) {
      if (queue.current === next) queue.current = null;
      fail(cause);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function finish(cancel: boolean) {
    const current = queue.current;
    if (!current) return;
    setBusy(true);
    try {
      if (cancel) await current.cancel();
      else await current.finish(Number(value));
      if (queue.current === current) queue.current = null;
    } catch (cause) {
      fail(cause);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (!available)
    return <p>Playback and editing are not available in this build.</p>;
  const parameter = state?.parameters.find((p) => p.id === target);
  const blockControl = state?.block_controls.find((p) => p.id === target);
  const step =
    blockControl?.step ??
    (target === 'osEnabled' ? 1 : target === 'osFactor' ? 0.5 : 0.01);
  const ours = state?.edit?.owner === owner && state.edit.target === target;
  const staged = target === 'osEnabled' || target === 'osFactor';
  const blocked = busy || !connected || !state;
  const valid =
    value.trim() !== '' &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0 &&
    Number(value) <= 1 &&
    (blockControl?.step !== 1 || Number(value) === 0 || Number(value) === 1);
  return (
    <section aria-label="Native preset editor">
      <h3>Native preset editor</h3>
      <p>
        Silent authoring with the TONE3000 engine. Edits do not change the saved
        preset currently playing; save a copy and start playback to hear it.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-grid">
        <label className="field">
          Preset to load
          <select
            value={selection}
            disabled={blocked || !!state?.edit}
            onChange={(e) => setSelection(e.target.value)}
          >
            <option value="">Choose a preset</option>
            <optgroup label="Originals">
              {presets.map((p) => (
                <option key={p.sha256} value={`original:${p.sha256}`}>
                  {p.name} · original
                </option>
              ))}
            </optgroup>
            <optgroup label="Owned copies">
              {state?.owned.map((p) => (
                <option key={p.id} value={`owned:${p.id}`}>
                  {p.preset.name} · owned
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <Button
          disabled={blocked || !selection || !!state?.edit}
          onClick={() => {
            const [kind, id] = selection.split(':');
            if (id) void send({ kind: 'load', id, owned: kind === 'owned' });
          }}
        >
          Load into native editor
        </Button>
      </div>
      <p role="status">
        {busy
          ? 'Applying native operation…'
          : state?.loaded
            ? `Native preset ready${state.dirty ? ' · Unsaved tone changes' : ''}`
            : 'No native preset loaded'}
      </p>
      <div className="form-grid">
        <label className="field">
          Native control
          <select
            value={target}
            disabled={blocked || !!state?.edit}
            onChange={(e) => {
              setTarget(e.target.value);
              setValue(String(controlValue(state, e.target.value)));
            }}
          >
            <option value="toneBass">Bass · tone</option>
            <option value="outputLevel">Output level · tone</option>
            <option value="inputCalibrationLevel">
              Input calibration · device
            </option>
            <option value="osEnabled">
              Oversampling enabled · device, staged
            </option>
            <option value="osFactor">
              Oversampling factor · device, staged
            </option>
            <optgroup label="Tone blocks">
              {state?.block_controls.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.lane} · {p.block_id.slice(0, 8)} ·{' '}
                  {blockLabels[p.parameter]}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <p data-testid="native-readback">
          Confirmed value: {blockControl?.value ?? parameter?.value ?? '—'} ·
          normalized {blockControl?.value ?? parameter?.normalized ?? '—'}
        </p>
        <Button
          disabled={blocked || !state?.loaded || !!state.edit}
          onClick={() => void begin()}
        >
          Begin native edit
        </Button>
        {ours && (
          <div className="native-touch">
            <TouchAdjust
              key={`${state.session}:${target}`}
              label="native value"
              value={valid ? Number(value) : NaN}
              baseline={baseline}
              min={0}
              max={1}
              step={step}
              disabled={blocked}
              format={(v) =>
                blockControl?.step === 1
                  ? v === 1
                    ? 'On'
                    : 'Off'
                  : `${Number((v * 100).toFixed(2))}% of range`
              }
              onChange={(v) => {
                setValue(String(v));
                if (!staged) queue.current?.preview(v);
              }}
            />
          </div>
        )}
        <label className="field">
          Normalized value (0–1)
          <input
            type="number"
            min="0"
            max="1"
            step={step}
            value={value}
            disabled={blocked || !ours}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <Button
          disabled={blocked || !ours || staged || !valid}
          onClick={() => queue.current?.preview(Number(value))}
        >
          Preview native change
        </Button>
        <Button
          disabled={blocked || !ours || !valid}
          onClick={() => void finish(false)}
        >
          Commit native change
        </Button>
        <Button disabled={blocked || !ours} onClick={() => void finish(true)}>
          Cancel native edit
        </Button>
      </div>
      {state?.edit && (
        <p>
          {ours ? 'Your edit is active.' : 'Another client is editing.'}{' '}
          Abandoned edits roll back after 30 seconds.
        </p>
      )}
      <p className="caption">
        Processing settings apply on commit. Calibration and oversampling stay
        with this session and are excluded from tone copies. Only the five
        controls shown here are currently qualified for editing.
      </p>
      <div className="form-grid">
        <label className="field">
          Owned preset name
          <input
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={blocked || !!state?.edit}
          />
        </label>
        <Button
          disabled={blocked || !state?.loaded || !!state.edit || !name.trim()}
          onClick={() => void send({ kind: 'save', name })}
        >
          Save owned copy
        </Button>
      </div>
      <p>
        {state?.owned.length ?? 0} owned copies. Imported originals remain
        unchanged.
      </p>
    </section>
  );
}
