import './RigControls.css';
import { useEffect, useRef, useState } from 'react';
import { type AudioAction, type AudioState } from './api';
import { AdjustmentDialog } from './AdjustmentDialog';
import { TouchAdjust } from './TouchAdjust';
import { EditQueue } from './editQueue';
import { Button } from './components/ui/button';

type Gesture = Extract<
  Extract<AudioAction, { kind: 'authoring' }>['action'],
  { kind: 'gesture' }
>['edit'];
type Edit = Extract<AudioAction, { kind: 'set_eq' }>['edit'];
type Band = NonNullable<AudioState['eq']>[number]['eq']['bands'][number];
type Field = 'freqHz' | 'gainDb' | 'q';
const fields = {
  freqHz: { label: 'Frequency', min: 20, max: 20000, step: 1, unit: 'Hz' },
  gainDb: { label: 'Gain', min: -15, max: 15, step: 0.1, unit: 'dB' },
  q: { label: 'Q', min: 0.1, max: 10, step: 0.01, unit: '' },
} as const;
const bandNames = ['Low', '1', '2', '3', '4', 'High'];

/** Direct audible EQ. The same revision-owned queue powers touch preview and Cancel. */
type EqSession = Pick<AudioState, 'session' | 'revision' | 'eq'>;

export function LiveEq<S extends EqSession>({
  state,
  blockId,
  disabled,
  onChange,
  onEditing,
  send,
  gesture,
}: {
  state: S;
  blockId: string;
  disabled: boolean;
  onChange: (state: S) => void;
  onEditing: (editing: boolean) => void;
  send: (state: S, edit: Edit) => Promise<S>;
  gesture?: (state: S, edit: Gesture) => Promise<S>;
}) {
  const [index, setIndex] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{
    field: Field;
    value: number;
    baseline: number;
    session: string;
    revision: number;
  } | null>(null);
  const queue = useRef<EditQueue<S> | null>(null);
  const latest = useRef(0);
  const mounted = useRef(false);
  const cursor = useRef(state);
  const notify = useRef(onEditing);
  useEffect(() => {
    notify.current = onEditing;
  }, [onEditing]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void queue.current?.finish(latest.current).catch(() => {});
      notify.current(false);
    };
  }, []);
  const row = state.eq?.find((item) => item.block_id === blockId);
  if (!row) return null;
  const selected = row.eq.bands[index];
  if (!selected) return null;
  const band: Band = selected;
  const stale =
    !!draft &&
    (state.session !== draft.session || state.revision > draft.revision);
  const locked = disabled || busy || stale;
  const display = (field: Field, value: number) =>
    `${Number(value.toFixed(field === 'freqHz' ? 0 : 2))} ${fields[field].unit}`.trim();
  function accept(next: S) {
    cursor.current = next;
    if (mounted.current) {
      setDraft((old) => (old ? { ...old, revision: next.revision } : old));
      onChange(next);
    }
  }
  async function apply(edit: Edit) {
    if (locked || draft) return;
    setBusy(true);
    onEditing(true);
    setError('');
    try {
      accept(await send(state, edit));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
      onEditing(false);
    }
  }
  function open(field: Field) {
    if (locked || queue.current) return;
    const opening = band[field];
    const original: Band = { ...band };
    cursor.current = state;
    latest.current = opening;
    setDraft({
      field,
      value: opening,
      baseline: opening,
      session: state.session,
      revision: state.revision,
    });
    setError('');
    onEditing(true);
    const token = crypto.randomUUID();
    const ready = gesture
      ? gesture(cursor.current, {
          phase: 'begin',
          owner: 'eq',
          token,
          target: `eq:${blockId}:${index}:${field}`,
        }).then(accept)
      : Promise.resolve();
    void ready.catch((cause) => {
      if (mounted.current) setError(String(cause));
    });
    queue.current = new EditQueue<S>(
      'eq',
      token,
      ready,
      async (edit) => {
        const value = edit.phase === 'cancel' ? opening : edit.value;
        const current = cursor.current.eq?.find(
          (item) => item.block_id === blockId,
        )?.eq.bands[index];
        if (!current)
          throw new Error('EQ target changed. Reopen this control.');
        if ((!gesture || edit.phase === 'preview') && current[field] === value)
          return cursor.current;
        const next = gesture
          ? await gesture(cursor.current, edit)
          : await send(cursor.current, {
              kind: 'band',
              index,
              band: { ...original, [field]: value },
            });
        cursor.current = next;
        return next;
      },
      accept,
      (cause) => {
        if (mounted.current) setError(String(cause));
      },
    );
  }
  async function finish(cancel: boolean) {
    const active = queue.current;
    if (!active || busy) return;
    setBusy(true);
    try {
      if (cancel) await active.cancel();
      else await active.finish(latest.current);
    } catch (cause) {
      setError(String(cause));
    } finally {
      queue.current = null;
      setBusy(false);
      setDraft(null);
      onEditing(false);
    }
  }
  return (
    <section
      className="space-y-2 rounded-md border border-border p-2"
      aria-label="Block EQ"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto">EQ</h3>
        <Button
          variant={row.eq.enabled ? 'secondary' : 'outline'}
          aria-pressed={row.eq.enabled}
          disabled={locked || !!draft}
          onClick={() =>
            void apply({ kind: 'enabled', value: !row.eq.enabled })
          }
        >
          EQ on
        </Button>
        <Button
          variant="outline"
          aria-label="EQ position"
          disabled={locked || !!draft}
          onClick={() => void apply({ kind: 'pre', value: !row.eq.pre })}
        >
          {row.eq.pre ? 'Before model' : 'After model'}
        </Button>
        <Button
          variant="outline"
          disabled={locked || !!draft}
          onClick={() => void apply({ kind: 'reset' })}
        >
          Reset EQ
        </Button>
      </div>
      <div className="grid grid-cols-6 gap-1" aria-label="EQ bands">
        {bandNames.map((name, i) => (
          <Button
            key={name}
            className="min-w-0 px-1"
            variant={index === i ? 'secondary' : 'ghost'}
            aria-label={`EQ band ${name}`}
            aria-pressed={index === i}
            disabled={locked || !!draft}
            onClick={() => setIndex(i)}
          >
            {name}
          </Button>
        ))}
      </div>
      {(index === 0 || index === 5) && (
        <div className="flex flex-wrap gap-2">
          {(index === 0
            ? (['lowcut', 'lowshelf'] as const)
            : (['highshelf', 'highcut'] as const)
          ).map((type) => (
            <Button
              key={type}
              variant={band.type === type ? 'secondary' : 'outline'}
              aria-pressed={band.type === type}
              disabled={locked || !!draft}
              onClick={() =>
                void apply({ kind: 'band', index, band: { ...band, type } })
              }
            >
              {type.endsWith('cut') ? 'Cut' : 'Shelf'}
            </Button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(fields) as Field[]).map((field) => (
          <button
            key={field}
            type="button"
            className="value-cell min-w-0"
            aria-label={`Adjust EQ ${fields[field].label}`}
            aria-haspopup="dialog"
            disabled={
              locked ||
              !!draft ||
              (field === 'gainDb' && band.type.endsWith('cut'))
            }
            onClick={() => open(field)}
          >
            <span>{fields[field].label}</span>
            <strong>{display(field, band[field])}</strong>
          </button>
        ))}
      </div>
      {error && !draft && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {draft && (
        <AdjustmentDialog
          title={`EQ · ${fields[draft.field].label}`}
          onCancel={() => void finish(true)}
        >
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <TouchAdjust
            label={`EQ ${fields[draft.field].label}`}
            value={draft.value}
            baseline={draft.baseline}
            min={fields[draft.field].min}
            max={fields[draft.field].max}
            step={fields[draft.field].step}
            disabled={locked || !!error}
            format={(value) => display(draft.field, value)}
            onChange={(value) => {
              latest.current = value;
              setDraft({ ...draft, value });
              queue.current?.preview(value);
            }}
          />
          <div className="editor-actions">
            <Button
              disabled={locked || !!error}
              onClick={() => void finish(false)}
            >
              Done
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void finish(true)}
            >
              Cancel
            </Button>
          </div>
          {stale && (
            <p role="alert">Session changed. Close and reopen this control.</p>
          )}
        </AdjustmentDialog>
      )}
    </section>
  );
}
