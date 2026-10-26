import { useEffect, useRef, useState } from 'react';
import {
  capabilities,
  nativeState,
  nativeCommand,
  type NativeSnapshot,
  type NativeAction,
  type Preset,
} from './api';
import { Button } from './components/ui/button';

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
  const [target, setTarget] = useState('toneBass');
  const [value, setValue] = useState('0.5');
  const [name, setName] = useState('My preset');
  const [owner] = useState(() => crypto.randomUUID());
  const token = useRef('');
  const sequence = useRef(0);
  const running = useRef(false);
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
  async function send(action: NativeAction) {
    if (!state || running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      setState(await nativeCommand(state, action));
    } catch (cause) {
      setError(String(cause));
      try {
        setState(await nativeState());
      } catch {
        setState(null);
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  if (!available)
    return <p>Playback and editing are not available in this build.</p>;
  const parameter = state?.parameters.find((p) => p.id === target);
  const ours = state?.edit?.owner === owner;
  const staged = target === 'osEnabled' || target === 'osFactor';
  const blocked = busy || !connected || !state;
  return (
    <section aria-label="Native preset editor">
      <h3>Native preset editor</h3>
      <p>
        Offline editing with the TONE3000 engine. Live audio output is
        unavailable.
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
              setValue(
                String(
                  state?.parameters.find((p) => p.id === e.target.value)
                    ?.normalized ?? 0.5,
                ),
              );
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
          </select>
        </label>
        <p data-testid="native-readback">
          Confirmed value: {parameter?.value ?? '—'} · normalized{' '}
          {parameter?.normalized ?? '—'}
        </p>
        <Button
          disabled={blocked || !state?.loaded || !!state.edit}
          onClick={() => {
            token.current = crypto.randomUUID();
            sequence.current = 0;
            setValue(String(parameter?.normalized ?? 0.5));
            void send({ kind: 'begin', owner, token: token.current, target });
          }}
        >
          Begin native edit
        </Button>
        <label className="field">
          Normalized value (0–1)
          <input
            type="number"
            min="0"
            max="1"
            step="0.01"
            value={value}
            disabled={blocked || !ours}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <Button
          disabled={blocked || !ours || staged || value === ''}
          onClick={() =>
            void send({
              kind: 'preview',
              owner,
              token: token.current,
              sequence: ++sequence.current,
              value: Number(value),
            })
          }
        >
          Preview native change
        </Button>
        <Button
          disabled={blocked || !ours || value === ''}
          onClick={() =>
            void send({
              kind: 'commit',
              owner,
              token: token.current,
              sequence: ++sequence.current,
              value: Number(value),
            })
          }
        >
          Commit native change
        </Button>
        <Button
          disabled={blocked || !ours}
          onClick={() =>
            void send({ kind: 'cancel', owner, token: token.current })
          }
        >
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
