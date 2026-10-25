import { useEffect, useRef, useState } from 'react';
import { sendCommand, type Snapshot } from './api';
import { EditQueue } from './editQueue';
import { Button } from './components/ui/button';

type Parameter = Snapshot['parameters'][number];
export function ControlEditor({
  parameter,
  state,
  connected,
  accept,
}: {
  parameter: Parameter;
  state: Snapshot;
  connected: boolean;
  accept: (next: Snapshot, session: string) => void;
}) {
  const [owner] = useState(() => crypto.randomUUID());
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(parameter.value);
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
    const token = crypto.randomUUID();
    const session = state.session;
    const report = (next: Snapshot) => {
      if (alive.current) accept(next, session);
    };
    const fail = (cause: unknown) => {
      if (alive.current) setError(String(cause));
    };
    const ready = sendCommand(
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
      (edit) => sendCommand({ type: 'edit', edit }, null, session),
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
      {!opened ? (
        <Button
          variant="outline"
          disabled={!connected || busy || !!state.edit}
          onClick={() => void begin()}
          aria-label={`Edit ${parameter.label}`}
        >
          Edit
        </Button>
      ) : (
        <fieldset aria-label={`Preview ${parameter.label}`}>
          <legend>Preview {parameter.label}</legend>
          <label className="field">
            Draft {parameter.label} (%)
            <input
              type="number"
              min={parameter.min * 100}
              max={parameter.max * 100}
              step={parameter.step * 100}
              value={
                Number.isFinite(draft) ? Math.round(draft * 10000) / 100 : ''
              }
              disabled={unavailable}
              onChange={(event) =>
                preview(
                  event.target.value === ''
                    ? NaN
                    : Number(event.target.value) / 100,
                )
              }
            />
          </label>
          <div className="editor-actions">
            <Button
              variant="outline"
              aria-label={`Decrease ${parameter.label}`}
              disabled={unavailable}
              onClick={() =>
                preview(
                  Math.max(
                    parameter.min,
                    (Number.isFinite(draft) ? draft : parameter.value) -
                      parameter.step,
                  ),
                )
              }
            >
              −
            </Button>
            <Button
              variant="outline"
              aria-label={`Increase ${parameter.label}`}
              disabled={unavailable}
              onClick={() =>
                preview(
                  Math.min(
                    parameter.max,
                    (Number.isFinite(draft) ? draft : parameter.value) +
                      parameter.step,
                  ),
                )
              }
            >
              +
            </Button>
            <Button
              disabled={
                unavailable ||
                !Number.isFinite(draft) ||
                draft < parameter.min ||
                draft > parameter.max
              }
              onClick={() => void finish(false)}
            >
              Commit
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
              ? 'Preview only until committed. Cancel restores the starting value. Idle previews expire after 30 seconds.'
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
      )}
      {state.edit?.target === parameter.id && !owned && (
        <p className="caption">Preview controlled by another editor.</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
