import { SceneMidi } from './SceneMidi';
import { ModelPicker } from './ModelPicker';
import { LiveEq } from './LiveEq';
import { RecoveryNotice } from './RecoveryNotice';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rigNodeLabel } from './rigDraft';
import { Button } from './components/ui/button';
import { AdjustmentDialog } from './AdjustmentDialog';
import { TouchAdjust } from './TouchAdjust';
import { EditQueue } from './editQueue';
import { lv2Control } from './lv2Control';
import {
  rigAudioState,
  rigAudioCommand,
  rigDocument,
  type RigAudioState,
  type RigAudioAction,
  type RigControl,
  type RigDocument,
} from './api';

const key = (c: RigControl) => JSON.stringify(c.target);
/** Actual mixed readback only; an edited document never masquerades as sounding. */
export function MixedRig({
  connected,
  onPlaying,
  onPresent,
  otherPlaying,
}: {
  connected: boolean;
  onPlaying: (name: string | null) => void;
  onPresent: (present: boolean) => void;
  otherPlaying: boolean;
}) {
  const [state, setState] = useState<RigAudioState | null>(null);
  const [document, setDocument] = useState<RigDocument | null>(null);
  const [selection, setSelection] = useState<{
    revision: string;
    node: string;
  } | null>(() => {
    try {
      const v: unknown = JSON.parse(
        sessionStorage.getItem('oxidal.mixed.selection') ?? 'null',
      );
      return v &&
        typeof v === 'object' &&
        'revision' in v &&
        typeof v.revision === 'string' &&
        'node' in v &&
        typeof v.node === 'string'
        ? { revision: v.revision, node: v.node }
        : null;
    } catch {
      return null;
    }
  });
  const [picker, setPicker] = useState<{
    opening: RigAudioState;
    node: string;
    target: string;
    name: string;
    insert: boolean;
    format?: 'nam' | 'ir';
    allowedFormat?: 'nam' | 'ir';
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [eqBusy, setEqBusy] = useState(false);
  const [nativeSelection, setNativeSelection] = useState<{
    node: string;
    target: string;
  } | null>(null);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [name, setName] = useState('');
  const [edit, setEdit] = useState<{
    control: RigControl;
    value: number;
  } | null>(null);
  const current = useRef<RigAudioState | null>(null);
  const alive = useRef(false);
  const sending = useRef(false);
  const generation = useRef(0);
  const queue = useRef<EditQueue<RigAudioState> | null>(null);
  const latest = useRef(0);
  const accept = useCallback((next: RigAudioState) => {
    if (!alive.current) return;
    if (
      current.current?.session === next.session &&
      current.current.revision > next.revision
    )
      return;
    current.current = next;
    setState(next);
  }, []);
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const requested = generation.current;
      try {
        const next = await rigAudioState();
        if (
          alive.current &&
          !sending.current &&
          requested === generation.current
        ) {
          accept(next);
          setReadError('');
        }
      } catch (cause) {
        if (alive.current) setReadError(String(cause));
      } finally {
        if (alive.current) timer = setTimeout(() => void tick(), 750);
      }
    };
    void tick();
    return () => {
      alive.current = false;
      clearTimeout(timer);
      void queue.current?.finish(latest.current).catch(() => {});
    };
  }, [accept]);
  const revision = state?.configured?.revision;
  useEffect(() => {
    let active = true;
    if (revision)
      void rigDocument(revision)
        .then((d) => {
          if (active) {
            setDocument(d);
            setName(d.manifest.name);
          }
        })
        .catch((e: unknown) => {
          if (active) setError(String(e));
        });
    return () => {
      active = false;
    };
  }, [revision]);
  const matching = document?.revision === revision ? document : null;
  useEffect(() => {
    onPlaying(
      state?.phase === 'running' ? (matching?.manifest.name ?? 'Rig') : null,
    );
  }, [state?.phase, matching, onPlaying]);
  useEffect(() => {
    onPresent(
      !!state?.configured && state.phase !== 'unavailable' && !otherPlaying,
    );
  }, [state?.configured, state?.phase, otherPlaying, onPresent]);
  async function command(action: RigAudioAction) {
    if (!current.current || sending.current) return;
    generation.current++;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      accept(await rigAudioCommand(current.current, action));
    } catch (cause) {
      setError(String(cause));
      try {
        accept(await rigAudioState());
      } catch {
        /* retain confirmed state */
      }
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function switchPrepared(revision: string) {
    const cursor = current.current;
    if (!cursor?.control || !cursor.configured) return;
    await command({
      kind: 'switch',
      command: {
        session: cursor.control.session,
        expected_revision: cursor.control.revision,
        revision,
        fade_frames: Math.max(
          2,
          Math.round(cursor.configured.stream.input.sample_rate / 100),
        ),
      },
    });
  }
  function open(control: RigControl) {
    if (!current.current?.control || queue.current || sending.current) return;
    let cursor = current.current;
    const opening = control.value;
    latest.current = opening;
    setEdit({ control, value: opening });
    setError('');
    queue.current = new EditQueue<RigAudioState>(
      'mixed',
      crypto.randomUUID(),
      Promise.resolve(),
      async (e) => {
        const value = e.phase === 'cancel' ? opening : e.value;
        if (
          cursor.control?.controls.find((c) => key(c) === key(control))
            ?.value === value
        )
          return cursor;
        if (!cursor.control) throw new Error('Sounding controls changed');
        generation.current++;
        sending.current = true;
        try {
          cursor = await rigAudioCommand(cursor, {
            kind: 'control',
            command: {
              session: cursor.control.session,
              expected_revision: cursor.control.revision,
              target: control.target,
              value,
            },
          });
          return cursor;
        } finally {
          sending.current = false;
        }
      },
      accept,
      (e) => {
        if (alive.current) setError(String(e));
      },
    );
  }
  async function finish(cancel: boolean) {
    const pending = queue.current;
    if (!pending) return;
    setBusy(true);
    try {
      if (cancel) await pending.cancel();
      else await pending.finish(latest.current);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      queue.current = null;
      if (alive.current) {
        setEdit(null);
        setBusy(false);
      }
    }
  }
  if (
    !state ||
    state.phase === 'unavailable' ||
    !state.configured ||
    (otherPlaying && state.phase !== 'running')
  )
    return null;
  const running = state.phase === 'running';
  const nodes =
    matching?.manifest.oxidal?.graph.nodes.filter(
      (n) => !['input', 'output', 'split'].includes(n.kind),
    ) ?? [];
  const selected =
    nodes.find(
      (n) =>
        selection && selection.revision === revision && n.id === selection.node,
    ) ?? nodes.find((n) => n.kind !== 'output');
  const stageRole = matching?.manifest.tone3000.instances.find(
    (n) => n.id === selected?.instance,
  )?.processingRole;
  const stageLabels: Record<string, string> = {
    enabled: stageRole === 'cab' ? 'IR enabled' : 'Capture enabled',
    normalize: 'Normalize',
    inputGain: 'Input gain',
    outputGain: 'Output gain',
    mix: 'Mix',
  };
  const controls = (
    state.control?.controls.filter((c) => c.target.node === selected?.id) ?? []
  ).map((c) => {
    // A guarded stage has exactly one source block; its selected tile supplies
    // context. Keep qualified globals and whole/multi-block labels unchanged.
    if (
      (stageRole === 'amp' || stageRole === 'cab') &&
      c.target.kind === 'native' &&
      c.target.parameter.startsWith('block:')
    ) {
      const label = stageLabels[c.target.parameter.split(':').at(-1)!];
      if (label) return { ...c, label };
    }
    return c;
  });
  const currentSave =
    state.save?.source_session === state.control?.session ? state.save : null;
  const changed =
    !!state.control &&
    state.control.modified &&
    !(
      state.save?.saved_revision &&
      state.save.source_session === state.control.session &&
      state.save.source_control_revision === state.control.revision
    );
  const modelChange = state.control?.model_change;
  const modelPending =
    !!modelChange &&
    ['verifying', 'preparing', 'ready', 'applying'].includes(
      modelChange.progress.phase,
    );
  const disabled =
    !connected || busy || eqBusy || !running || !!readError || modelPending;
  const nativeModels = state.control?.slots?.find(
    (s) => s.node === selected?.id,
  );
  const slots = nativeModels?.slots ?? [];
  const wholeNative =
    !!nativeModels && stageRole !== 'amp' && stageRole !== 'cab';
  const eqBlocks =
    state.control?.eq?.find((e) => e.node === selected?.id)?.blocks ?? [];
  const nativeTarget =
    nativeSelection && nativeSelection.node === selected?.id
      ? nativeSelection.target
      : 'global';
  const eqBlock = wholeNative
    ? eqBlocks.find((e) => e.block_id === nativeTarget)
    : eqBlocks[0];
  const visibleControls = controls
    .filter((c) => {
      if (c.target.kind === 'bypass') return false;
      if (!wholeNative || c.target.kind !== 'native') return true;
      const p = c.target.parameter;
      if (eqBlock) return p.startsWith(`block:${eqBlock.block_id}:`);
      return (
        !p.startsWith('block:') &&
        (nativeTarget === 'stereo') ===
          (p.startsWith('spread') || p === 'outputBalance')
      );
    })
    .map((c) => {
      if (!eqBlock || !wholeNative || c.target.kind !== 'native') return c;
      const suffix = c.target.parameter.split(':').at(-1)!;
      const labels: Record<string, string> = {
        enabled: 'Enabled',
        normalize: 'Normalize',
        inputGain: 'Input gain',
        outputGain: 'Output gain',
        mix: 'Mix',
      };
      return { ...c, label: labels[suffix] ?? c.label };
    });
  const scale = edit
    ? lv2Control({
        minimum: edit.control.minimum,
        maximum: edit.control.maximum,
        integer: edit.control.integer,
        toggled: edit.control.toggle,
        logarithmic: edit.control.logarithmic,
      })
    : undefined;
  return (
    <section className="panel space-y-3" aria-label="Sounding mixed rig">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="section-heading min-w-0 flex-1">
          <h2>Chain</h2>
          <span role="status">
            {state.phase === 'starting'
              ? 'Preparing sound…'
              : running
                ? changed
                  ? 'Session modified'
                  : 'Playing'
                : state.phase === 'failed'
                  ? 'Audio needs attention'
                  : 'Audio stopped'}
          </span>
        </div>
        {state.device_owned ? (
          <Button
            variant="outline"
            disabled={!connected || busy || eqBusy || !!edit || !!picker}
            onClick={() => void command({ kind: 'stop' })}
          >
            {state.phase === 'starting' ? 'Cancel loading' : 'Stop audio'}
          </Button>
        ) : (
          <Button
            disabled={!connected || busy}
            onClick={() => void command({ kind: 'restart' })}
          >
            Resume audio
          </Button>
        )}
      </div>
      {!!state.control?.scenes?.scenes.length && (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Rig scenes"
          aria-busy={state.control.scene_transitioning}
        >
          {state.control.scenes.scenes.map((scene) => (
            <Button
              key={scene.id}
              className="h-auto min-h-12 max-w-full min-w-20 whitespace-normal"
              variant={
                state.control?.scene === scene.id ? 'default' : 'outline'
              }
              aria-pressed={state.control?.scene === scene.id}
              disabled={disabled || !!edit}
              onClick={() => {
                const control = current.current?.control;
                if (control)
                  void command({
                    kind: 'scene',
                    command: {
                      session: control.session,
                      expected_revision: control.revision,
                      scene: scene.id,
                    },
                  });
              }}
            >
              {scene.name}
            </Button>
          ))}
        </div>
      )}
      {!!state.control?.prepared?.length && (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Prepared presets"
        >
          {state.control.prepared.map((p) => (
            <Button
              key={p.revision}
              className="h-auto min-h-11 max-w-full min-w-0 text-left whitespace-normal"
              variant="outline"
              disabled={disabled || !!edit || !!p.error}
              onClick={() => void switchPrepared(p.revision)}
            >
              <span className="min-w-0 break-words">
                {p.name}
                {p.error ? ' · Unavailable' : p.modified ? ' · Modified' : ''}
              </span>
            </Button>
          ))}
        </div>
      )}
      <SceneMidi
        state={state}
        disabled={disabled || !!edit}
        onCommand={command}
      />
      <RecoveryNotice message={state.recovery_error} />
      {(error || readError || state.error) && (
        <p role="alert" className="error">
          {error || readError || state.error}
        </p>
      )}
      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Mixed signal chain"
      >
        {nodes.map((n, index) => {
          const bypass = state.control?.controls.find(
            (c) => c.target.kind === 'bypass' && c.target.node === n.id,
          );
          const plugin = matching?.manifest.oxidal?.lv2.find(
            (p) => p.id === n.instance,
          );
          const role = matching?.manifest.tone3000.instances.find(
            (i) => i.id === n.instance,
          )?.processingRole;
          const activeModel = state.control?.controls.find(
            (c) =>
              c.target.kind === 'native' &&
              c.target.node === n.id &&
              c.target.parameter.startsWith('block:') &&
              c.target.parameter.endsWith(':enabled'),
          );
          const modelName = activeModel?.label.replace(
            / · (left|right) · enabled$/,
            '',
          );
          const label =
            (modelName && (role === 'amp' || role === 'cab')
              ? `${role === 'amp' ? 'Amp' : 'Cab'} · ${modelName}`
              : undefined) ??
            rigNodeLabel(matching, n.id) ??
            (n.kind === 'tone3000'
              ? 'TONE3000'
              : n.kind === 'lv2'
                ? (plugin?.pluginUri.split(/[/#]/).pop() ?? 'Effect')
                : 'Mix');
          return (
            <div key={n.id} data-node={n.id} className="flex min-w-0 gap-2">
              <Button
                className="h-11 min-w-0 flex-1 justify-start gap-1 px-2 text-left text-sm"
                variant={n.id === selected?.id ? 'secondary' : 'outline'}
                disabled={!!edit || !!picker}
                aria-pressed={n.id === selected?.id}
                onClick={() => {
                  if (!revision) return;
                  const selected = { revision, node: n.id };
                  setSelection(selected);
                  try {
                    sessionStorage.setItem(
                      'oxidal.mixed.selection',
                      JSON.stringify(selected),
                    );
                  } catch {
                    /* browsing preferences are optional */
                  }
                }}
              >
                <span className="shrink-0">{index + 1} ·</span>
                <span className="truncate">{label}</span>
              </Button>
              {bypass && (
                <Button
                  className="h-11 min-w-16 shrink-0 px-2 text-sm"
                  variant="outline"
                  aria-label={`Bypass ${index + 1} ${label}`}
                  aria-pressed={bypass.value === 1}
                  disabled={disabled || !!edit}
                  onClick={() =>
                    void command({
                      kind: 'control',
                      command: {
                        session: state.control!.session,
                        expected_revision: state.control!.revision,
                        target: bypass.target,
                        value: bypass.value === 1 ? 0 : 1,
                      },
                    })
                  }
                >
                  {bypass.value === 1 ? 'Bypassed' : 'On'}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {running && selected && wholeNative && (
        <div
          className="flex flex-wrap gap-2"
          aria-label="Native model controls"
        >
          {['global', 'stereo', ...eqBlocks.map((b) => b.block_id)].map(
            (target, index) => {
              const control = controls.find(
                (c) =>
                  c.target.kind === 'native' &&
                  c.target.parameter === `block:${target}:enabled`,
              );
              const title = control?.label.replace(/ · enabled$/, '');
              return (
                <Button
                  key={target}
                  variant={nativeTarget === target ? 'secondary' : 'outline'}
                  aria-label={
                    index < 2
                      ? target === 'global'
                        ? 'Global'
                        : 'Stereo'
                      : `Select model ${index - 1}`
                  }
                  aria-pressed={nativeTarget === target}
                  disabled={disabled || !!edit}
                  className="h-auto min-h-11 max-w-full min-w-0 whitespace-normal"
                  onClick={() =>
                    setNativeSelection({ node: selected.id, target })
                  }
                >
                  <span className="min-w-0 break-words">
                    {index < 2
                      ? target === 'global'
                        ? 'Global'
                        : 'Stereo'
                      : `${index - 1} · ${title ?? 'Model'}`}
                  </span>
                </Button>
              );
            },
          )}
          {eqBlock && (
            <Button
              variant="outline"
              disabled={disabled || !!edit}
              onClick={() =>
                setPicker({
                  opening: state,
                  node: selected.id,
                  target: eqBlock.block_id,
                  name: 'Selected model',
                  insert: false,
                })
              }
            >
              Change model
            </Button>
          )}
          {slots.some((s) => s.position.lane === 0) &&
            (['nam', 'ir'] as const).map((format) => (
              <Button
                key={format}
                variant="outline"
                disabled={disabled || !!edit}
                onClick={() =>
                  setPicker({
                    opening: state,
                    node: selected.id,
                    target: slots.find((s) => s.position.lane === 0)!.target,
                    name: format.toUpperCase(),
                    insert: true,
                    format,
                  })
                }
              >
                Add {format.toUpperCase()}
              </Button>
            ))}
        </div>
      )}
      {running && selected && nativeModels && !wholeNative && eqBlock && (
        <Button
          variant="outline"
          disabled={disabled || !!edit}
          onClick={() =>
            setPicker({
              opening: state,
              node: selected.id,
              target: eqBlock.block_id,
              name: stageRole === 'cab' ? 'Cab IR' : 'Amp capture',
              insert: false,
              allowedFormat: stageRole === 'cab' ? 'ir' : 'nam',
            })
          }
        >
          {stageRole === 'cab' ? 'Change cab IR' : 'Change amp capture'}
        </Button>
      )}
      {modelPending && (
        <div className="flex flex-wrap items-center gap-2" role="status">
          <span>
            {modelChange.progress.phase === 'applying'
              ? 'Applying model…'
              : 'Preparing model…'}
          </span>
          <Button
            variant="outline"
            disabled={busy}
            onClick={async () => {
              generation.current++;
              sending.current = true;
              setBusy(true);
              try {
                const fresh = await rigAudioState();
                if (
                  fresh.control?.session !== state.control?.session ||
                  fresh.control?.model_change?.node !== modelChange.node ||
                  fresh.control?.model_change?.progress.request !==
                    modelChange.progress.request
                )
                  throw new Error(
                    'Model selection changed. Review it before cancelling.',
                  );
                accept(
                  await rigAudioCommand(fresh, {
                    kind: 'model',
                    command: {
                      session: fresh.control.session,
                      expected_revision: fresh.control.revision,
                      node: modelChange.node,
                      operation: { kind: 'cancel' },
                    },
                  }),
                );
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
      {modelChange?.progress.error && (
        <p role="alert" className="error">
          {modelChange.progress.error}
        </p>
      )}
      {picker && (
        <ModelPicker
          name={picker.name}
          initialFormat={picker.format}
          allowedFormat={picker.allowedFormat}
          intent={picker.insert ? 'add' : 'replace'}
          onClose={() => setPicker(null)}
          onAudition={async (asset) => {
            generation.current++;
            sending.current = true;
            setBusy(true);
            try {
              const control = picker.opening.control!;
              accept(
                await rigAudioCommand(picker.opening, {
                  kind: 'model',
                  command: {
                    session: control.session,
                    expected_revision: control.revision,
                    node: picker.node,
                    operation: {
                      kind: 'prepare',
                      assignment: { target: picker.target, asset },
                    },
                  },
                }),
              );
              if (alive.current) setError('');
            } finally {
              sending.current = false;
              if (alive.current) setBusy(false);
            }
          }}
        />
      )}
      {running && (
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
          aria-label="Selected effect controls"
        >
          {visibleControls.map((c) => (
            <Button
              key={key(c)}
              className="h-auto min-h-16 flex-col items-start gap-1 p-3 text-left whitespace-normal"
              variant="outline"
              disabled={disabled || !!edit}
              onClick={() => open(c)}
              aria-label={`Adjust ${c.label}`}
            >
              <span className="break-words">{c.label}</span>
              <strong className="font-mono">{c.display}</strong>
            </Button>
          ))}
          {!matching ? (
            <p>Reading chain…</p>
          ) : (
            !nodes.length && <p>Input → Output</p>
          )}
        </div>
      )}
      {running && selected && eqBlock && (
        <div className="space-y-2">
          <LiveEq
            key={`${state.control!.session}:${selected.id}:${eqBlock.block_id}`}
            state={{ ...state, eq: eqBlocks }}
            blockId={eqBlock.block_id}
            disabled={
              !connected || busy || !!edit || !!readError || modelPending
            }
            onEditing={(editing) => {
              generation.current++;
              sending.current = editing;
              setEqBusy(editing);
            }}
            onChange={accept}
            send={async (current, edit) => {
              const next = await rigAudioCommand(current, {
                kind: 'eq',
                command: {
                  session: current.control!.session,
                  expected_revision: current.control!.revision,
                  node: selected.id,
                  block_id: eqBlock.block_id,
                  edit,
                },
              });
              return {
                ...next,
                eq:
                  next.control?.eq?.find((e) => e.node === selected.id)
                    ?.blocks ?? [],
              };
            }}
          />
        </div>
      )}
      {edit && (
        <AdjustmentDialog
          title={edit.control.label}
          onCancel={() => {
            if (!busy) void finish(true);
          }}
        >
          <TouchAdjust
            label={edit.control.label}
            value={scale?.normalized(edit.value) ?? edit.value}
            baseline={
              scale?.normalized(edit.control.value) ?? edit.control.value
            }
            min={scale ? 0 : edit.control.minimum}
            max={scale ? 1 : edit.control.maximum}
            step={0.001}
            snap={scale?.snap}
            nudge={scale?.nudge}
            disabled={disabled}
            onChange={(v) => {
              const value = scale?.native(v) ?? v;
              latest.current = value;
              setEdit({ ...edit, value });
              queue.current?.preview(value);
            }}
            format={scale?.format ?? String}
          />
          <div className="action-row">
            <Button disabled={busy} onClick={() => void finish(false)}>
              Done
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void finish(true)}
            >
              Cancel
            </Button>
          </div>
          {error && <p role="alert">{error}</p>}
        </AdjustmentDialog>
      )}
      <div className="form-grid">
        <label className="field">
          Preset name
          <input
            disabled={!matching}
            value={name}
            maxLength={128}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Button
          disabled={
            disabled ||
            !matching ||
            !!edit ||
            !!state.save?.running ||
            !name.trim()
          }
          onClick={() => void command({ kind: 'save', name: name.trim() })}
        >
          {state.save?.running ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {currentSave?.error && <p role="alert">{currentSave.error}</p>}
      {currentSave?.saved_revision && (
        <p role="status">
          {changed
            ? 'Saved earlier settings · newer edits remain'
            : 'Saved for offline use'}
        </p>
      )}
    </section>
  );
}
