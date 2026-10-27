import { ArtworkDeck } from './AssetArtwork';
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
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';

const blockLabels: Record<string, string> = {
  enabled: 'Enabled',
  normalize: 'Normalise',
  inputGain: 'Input gain',
  outputGain: 'Output gain',
  mix: 'Mix',
  slimSize: 'Requested NAM size · staged',
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
  const editableParameters = state?.parameters.filter((p) => p.writable) ?? [];
  const target =
    state?.block_controls.some((p) => p.id === requestedTarget) ||
    editableParameters.some((p) => p.id === requestedTarget)
      ? requestedTarget
      : (editableParameters.find((p) => p.id === 'toneBass')?.id ??
        editableParameters[0]?.id ??
        '');
  const [value, setValue] = useState('0.5');
  const [name, setName] = useState('My preset');
  const [owner] = useState(() => crypto.randomUUID());
  const queue = useRef<EditQueue<NativeSnapshot> | null>(null);
  const loader = useRef<HTMLDetailsElement>(null);
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
      if (action.kind === 'load' && loader.current) loader.current.open = false;
    } catch (cause) {
      fail(cause);
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function begin(controlTarget = target) {
    if (!state || running.current || state.edit) return;
    setError('');
    setBusy(true);
    running.current = true;
    const token = crypto.randomUUID();
    setTarget(controlTarget);
    const starting = controlValue(state, controlTarget);
    setValue(String(starting));
    setBaseline(starting);
    const session = state.session;
    let cursor = state;
    const ready = nativeCommand(cursor, {
      kind: 'begin',
      owner,
      token,
      target: controlTarget,
    })
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
  if (!state)
    return (
      <p role={error ? 'alert' : 'status'}>
        {error || 'Loading preset editor…'}
      </p>
    );
  const parameter = state?.parameters.find((p) => p.id === target);
  const blockControl = state?.block_controls.find((p) => p.id === target);
  const step =
    blockControl?.step ??
    (parameter?.toggle
      ? 1
      : parameter &&
          parameter.interval >= 1 &&
          parameter.maximum > parameter.minimum
        ? parameter.interval / (parameter.maximum - parameter.minimum)
        : 0.01);
  const ours = state?.edit?.owner === owner && state.edit.target === target;
  const staged = blockControl?.staged || parameter?.staged;
  const blocked = busy || !connected || !state;
  const valid =
    value.trim() !== '' &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0 &&
    Number(value) <= 1 &&
    (!(blockControl?.step === 1 || parameter?.toggle) ||
      Number(value) === 0 ||
      Number(value) === 1);
  const loadedName =
    state?.owned.find((p) => p.id === state.loaded)?.preset.name ??
    presets.find((p) => p.sha256 === state?.loaded)?.name;
  return (
    <section className="control-stack" aria-label="Native preset editor">
      <h3>{loadedName ?? 'Native preset editor'}</h3>
      <p className="caption">Silent draft · hear live adjustments on Rig.</p>
      {error && !ours && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <details
        ref={loader}
        key={`loader:${state?.loaded ?? 'empty'}`}
        open={!state?.loaded}
        className="control-help"
        data-testid="native-preset-loader"
      >
        <summary>{state?.loaded ? 'Change preset' : 'Choose a preset'}</summary>
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
            Load draft
          </Button>
        </div>
      </details>
      <p role="status" className="caption">
        {busy
          ? 'Applying native operation…'
          : state?.loaded
            ? `Native preset ready${state.dirty ? ' · Unsaved tone changes' : ''}`
            : 'No native preset loaded'}
      </p>
      {state?.loaded && (
        <div
          className="native-parameter-grid"
          role="group"
          aria-label="Draft tone controls"
        >
          {editableParameters
            .filter((p) => p.tone)
            .map((p) => (
              <button
                key={p.id}
                type="button"
                className="native-value-trigger"
                aria-label={`Adjust draft ${p.label}`}
                aria-haspopup="dialog"
                disabled={blocked || !!state.edit}
                onClick={() => void begin(p.id)}
              >
                <span>{p.label}</span>
                <strong>
                  {p.toggle ? (p.normalized ? 'On' : 'Off') : p.display}
                </strong>
              </button>
            ))}
        </div>
      )}
      {state?.loaded && (
        <ArtworkDeck
          key={state.loaded}
          id={state.loaded}
          owned={state.owned.some((p) => p.id === state.loaded)}
        />
      )}
      <details className="control-help" data-testid="native-control-browser">
        <summary>All controls &amp; block selection</summary>
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
              {[
                { label: 'Tone', tone: true },
                { label: 'Device processing', tone: false },
              ].map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {editableParameters
                    .filter((p) => p.tone === group.tone)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                        {!p.tone ? ' · device' : ''}
                        {p.staged ? ' · staged' : ''}
                      </option>
                    ))}
                </optgroup>
              ))}
              <optgroup label="Tone blocks">
                {state?.block_controls.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.lane} · {blockLabels[p.parameter]}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <button
            type="button"
            className="native-value-trigger"
            aria-label="Adjust native value"
            aria-haspopup="dialog"
            disabled={blocked || !state?.loaded || !target || !!state.edit}
            onClick={() => void begin()}
          >
            <span>
              {blockControl
                ? `${blockControl.name} · ${blockLabels[blockControl.parameter]}`
                : (parameter?.label ?? target)}
            </span>
            <strong>
              {blockControl
                ? blockControl.step === 1
                  ? blockControl.value
                    ? 'On'
                    : 'Off'
                  : `${Math.round(blockControl.value * 100)}%`
                : (parameter?.display ?? '—')}
            </strong>
            <span className="sr-only" data-testid="native-readback">
              Confirmed value: {blockControl?.value ?? parameter?.value ?? '—'}{' '}
              · normalized {blockControl?.value ?? parameter?.normalized ?? '—'}
            </span>
          </button>
        </div>
      </details>
      {ours && (
        <AdjustmentDialog
          title={
            blockControl
              ? `${blockControl.name} · ${blockLabels[blockControl.parameter]}`
              : (parameter?.label ?? target)
          }
          onCancel={() => {
            if (!blocked) void finish(true);
          }}
        >
          <p className="caption">
            {staged
              ? 'Applied on Done · no preview during adjustment.'
              : 'Previewing this draft · Done keeps the change.'}
          </p>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
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
                blockControl?.step === 1 || parameter?.toggle
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
          <details className="exact-entry">
            <summary>Enter value</summary>
            <label className="field">
              Normalized value (0–1)
              <input
                type="number"
                min="0"
                max="1"
                step={step}
                value={value}
                disabled={blocked || !ours}
                onChange={(e) => {
                  const next = e.target.value;
                  setValue(next);
                  if (
                    !staged &&
                    next.trim() !== '' &&
                    Number.isFinite(Number(next)) &&
                    Number(next) >= 0 &&
                    Number(next) <= 1 &&
                    (!(blockControl?.step === 1 || parameter?.toggle) ||
                      Number(next) === 0 ||
                      Number(next) === 1)
                  )
                    queue.current?.preview(Number(next));
                }}
              />
            </label>
          </details>
          <div className="editor-actions">
            <Button
              disabled={blocked || !ours || !valid}
              onClick={() => void finish(false)}
            >
              Done
            </Button>
            <Button
              disabled={blocked || !ours}
              onClick={() => void finish(true)}
            >
              Cancel
            </Button>
          </div>
        </AdjustmentDialog>
      )}
      <div className="editor-actions" aria-label="Draft history">
        <Button
          variant="secondary"
          disabled={blocked || !!state?.edit || !state?.can_undo}
          onClick={() => void send({ kind: 'undo' })}
        >
          Undo
        </Button>
        <Button
          variant="secondary"
          disabled={blocked || !!state?.edit || !state?.can_redo}
          onClick={() => void send({ kind: 'redo' })}
        >
          Redo
        </Button>
        {blockControl && (
          <Button
            disabled={blocked || !!state?.edit}
            onClick={() =>
              void send({
                kind: 'remove_block',
                block_id: blockControl.block_id,
              })
            }
          >
            Remove selected block
          </Button>
        )}
      </div>

      {state?.edit && (
        <p>
          {ours ? 'Your edit is active.' : 'Another client is editing.'}{' '}
          Abandoned edits roll back after 30 seconds.
        </p>
      )}
      <details className="control-help">
        <summary>Draft &amp; processing help</summary>
        <p>
          This editor is silent. Save a copy and start it to hear structural
          draft changes. Rig controls adjust the playing session immediately.
        </p>
        <p>
          Undo/redo belongs to this draft; loading or saving starts new history.
          Calibration and oversampling are session settings, excluded from saved
          tones.
        </p>
      </details>
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
      <p className="caption">Originals stay unchanged.</p>
    </section>
  );
}
