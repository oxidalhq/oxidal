import type { ControlScale } from './lv2Control';
import { useEffect, useRef, useState } from 'react';
import { sendCommand, type Snapshot } from './api';
import { TouchAdjust } from './TouchAdjust';
import { EditQueue } from './editQueue';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';

type Parameter = Snapshot['parameters'][number];
export function ControlEditor({
  parameter,
  state,
  connected,
  accept,
  send = sendCommand,
  scale,
  formatValue = (value: number) => `${Number((value * 100).toFixed(2))}%`,
}: {
  parameter: Parameter;
  state: Snapshot;
  connected: boolean;
  accept: (next: Snapshot, session: string) => void;
  send?: typeof sendCommand;
  formatValue?: (value: number) => string;
  scale?: ControlScale;
}) {
  const [owner] = useState(() => crypto.randomUUID());
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(parameter.value);
  const [baseline, setBaseline] = useState(parameter.value);
  const [error, setError] = useState('');
  const queue = useRef<EditQueue | null>(null);
  const alive = useRef(false);
  useEffect(() => {
    const lifecycle = alive;
    const pending = queue;
    lifecycle.current = true;
    return () => {
      lifecycle.current = false;
      // Cancel after an in-flight begin/preview, never before it. The server lease
      // rolls back if the page/network disappears before this can reach it.
      void pending.current?.cancel().catch(() => {});
    };
  }, []);
  async function begin() {
    setError('');
    setBusy(true);
    setDraft(parameter.value);
    setBaseline(parameter.value);
    const token = crypto.randomUUID();
    const session = state.session;
    const report = (next: Snapshot) => {
      if (alive.current) accept(next, session);
    };
    const fail = (cause: unknown) => {
      if (alive.current) setError(String(cause));
    };
    const ready = send(
      {
        type: 'edit',
        edit: { phase: 'begin', owner, token, target: parameter.id },
      },
      state.revision,
      session,
    ).then(report);
    const next = new EditQueue(
      owner,
      token,
      ready,
      (edit) => send({ type: 'edit', edit }, null, session),
      report,
      fail,
    );
    queue.current = next;
    try {
      await ready;
      if (alive.current) setOpened(true);
    } catch (cause) {
      fail(cause);
      if (queue.current === next) queue.current = null;
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function preview(value: number) {
    setDraft(value);
    if (
      Number.isFinite(value) &&
      value >= parameter.min &&
      value <= parameter.max
    )
      queue.current?.preview(value);
  }
  async function finish(cancel: boolean) {
    setBusy(true);
    try {
      if (cancel) await queue.current?.cancel();
      else await queue.current?.finish(draft);
      if (alive.current) {
        setOpened(false);
        queue.current = null;
      }
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const owned =
    state.edit?.owner === owner && state.edit.target === parameter.id;
  const unavailable = !connected || busy || !owned;
  return (
    <div className="control-editor">
      <button
        type="button"
        className="parameter-touch"
        disabled={!connected || busy || !!state.edit}
        onClick={() => void begin()}
        aria-label={`Adjust ${parameter.label} value`}
        aria-haspopup="dialog"
      >
        <svg className="parameter-dial" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="26" className="dial-track" />
          <circle
            cx="32"
            cy="32"
            r="26"
            className="dial-value"
            pathLength="100"
            strokeDasharray={`${Math.max(0, Math.min(100, ((parameter.value - parameter.min) / (parameter.max - parameter.min)) * 100))} 100`}
          />
        </svg>
        <output data-testid={`value-${parameter.id}`}>
          {formatValue(parameter.value)}
        </output>
      </button>
      {opened && (
        <AdjustmentDialog
          title={parameter.label}
          onCancel={() => {
            if (!busy) void finish(true);
          }}
        >
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <fieldset aria-label={`Preview ${parameter.label}`}>
            <legend className="sr-only">Preview {parameter.label}</legend>
            <TouchAdjust
              label={parameter.label}
              value={draft}
              baseline={baseline}
              min={parameter.min}
              max={parameter.max}
              step={scale ? 0.001 : parameter.step}
              snap={scale?.snap}
              nudge={scale?.nudge}
              disabled={unavailable}
              onChange={preview}
              format={formatValue}
            />
            <details className="exact-entry">
              <summary>Enter value</summary>
              <label className="field">
                Draft {parameter.label}
                {scale ? '' : ' (%)'}
                <input
                  type="number"
                  min={scale?.min ?? parameter.min * 100}
                  max={scale?.max ?? parameter.max * 100}
                  step={scale?.step ?? parameter.step * 100}
                  value={
                    Number.isFinite(draft)
                      ? scale
                        ? Number(scale.native(draft).toPrecision(8))
                        : Math.round(draft * 10000) / 100
                      : ''
                  }
                  disabled={unavailable}
                  onChange={(event) =>
                    preview(
                      event.target.value === ''
                        ? NaN
                        : scale
                          ? scale.normalized(Number(event.target.value))
                          : Number(event.target.value) / 100,
                    )
                  }
                />
              </label>
            </details>
            <div className="editor-actions">
              <Button
                disabled={
                  unavailable ||
                  !Number.isFinite(draft) ||
                  draft < parameter.min ||
                  draft > parameter.max
                }
                onClick={() => void finish(false)}
              >
                Done
              </Button>
              <Button
                variant="outline"
                disabled={!connected || busy}
                onClick={() => void finish(true)}
              >
                Cancel
              </Button>
            </div>
            <p className="caption">
              {owned
                ? 'Done keeps this adjustment. Cancel restores the opening value.'
                : 'This edit ended or was superseded. Your draft is retained; close and reopen to edit again.'}
            </p>
            {!owned && (
              <Button
                variant="outline"
                onClick={() => {
                  setOpened(false);
                  queue.current = null;
                }}
              >
                Close editor
              </Button>
            )}
          </fieldset>
        </AdjustmentDialog>
      )}
      {state.edit?.target === parameter.id && !owned && (
        <p className="caption">Preview controlled by another editor.</p>
      )}
      {error && !opened && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
