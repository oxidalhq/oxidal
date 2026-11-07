import { friendlyError } from './lib/friendlyError';
import { Plus, Stop, FloppyDisk, Eraser } from '@phosphor-icons/react';
import { ChainView, LedToggle } from './ChainView';
import { GearIcon } from './GearIcon';
import { blockKind } from './rigChain';
import { RigComposer } from './RigComposer';
import { lv2Effect, type DraftEffect } from './rigDraft';
import { rigAudioState } from './api';
import { lv2Control } from './lv2Control';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { AdjustmentDialog } from './AdjustmentDialog';
import { ControlEditor } from './ControlEditor';
import { ModelPicker } from './ModelPicker';
import {
  graphAudioState,
  graphAudioCommand,
  graphLibrary,
  installedLv2,
  playbackState,
  playbackCommand,
  type GraphAudioState,
  type GraphAudioAction,
  type GraphSettings,
  type Lv2Plugin,
  type SavedGraph,
  type AudioState,
  type Action,
  type Snapshot,
} from './api';

const emptyRig: GraphSettings['rig'] = {
  nodes: [
    { id: 'in', kind: 'input', level: 1 },
    { id: 'out', kind: 'output', level: 1 },
  ],
  edges: [{ from: 'in', to: 'out' }],
};
/** Installed-effect authoring uses the real graph worker, never the simulator. */
export function GraphAuthor({
  connected,
  liveOnly = false,
  onPlaying,
  onOpenRig,
}: {
  connected: boolean;
  liveOnly?: boolean;
  onPlaying?: (name: string | null) => void;
  onOpenRig?: () => void;
}) {
  const [state, setState] = useState<GraphAudioState | null>(null);
  const [audio, setAudio] = useState<AudioState | null>(null);
  const [library, setLibrary] = useState<SavedGraph[]>([]);
  const [draft, setDraft] = useState<{
    libraryId?: string;
    rig: GraphSettings['rig'];
    bindings: GraphSettings['bindings'];
    recall?: GraphSettings['recall'];
    sampleRate?: number;
  }>({ rig: emptyRig, bindings: [] });
  const [typedName, setName] = useState<string | null>(null);
  const name =
    typedName ??
    (liveOnly || state?.phase === 'running'
      ? (state?.configured?.name ??
        library.find((item) => item.id === state?.saved_copy)?.preset.name ??
        'New preset')
      : 'New preset');
  const [catalog, setCatalog] = useState<Lv2Plugin[]>([]);
  const [picker, setPicker] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [namPicker, setNamPicker] = useState<'nam' | 'ir' | null>(null);
  const [mixedDraft, setMixedDraft] = useState<DraftEffect[] | null>(null);
  const newNative = useRef<AudioState | null>(null);
  const [query, setQuery] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = useRef<GraphAudioState | null>(null);
  const alive = useRef(false);
  const sending = useRef(false);
  const generation = useRef(0);
  const scan = useRef<AbortController | null>(null);
  const accept = useCallback(
    (next: GraphAudioState, expectedSession?: string) => {
      if (!alive.current) return;
      const previous = current.current;
      if (expectedSession && previous && previous.session !== expectedSession)
        return;
      if (
        previous?.session === next.session &&
        previous.revision > next.revision
      )
        return;
      current.current = next;
      setState(next);
    },
    [],
  );
  useEffect(() => {
    alive.current = true;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const request = generation.current;
      try {
        const [next, native] = await Promise.all([
          graphAudioState(),
          playbackState(),
        ]);
        if (active && request === generation.current) {
          accept(next);
          setAudio(native);
        }
      } catch (cause) {
        if (active && !liveOnly)
          setError(friendlyError(cause, 'read installed effects'));
      } finally {
        if (active) timer = setTimeout(() => void tick(), 750);
      }
    };
    void tick();
    void graphLibrary()
      .then((items) => {
        if (active) setLibrary(items);
      })
      .catch((cause: unknown) => {
        if (active && !liveOnly)
          setError(friendlyError(cause, 'read installed effects'));
      });
    return () => {
      active = false;
      alive.current = false;
      clearTimeout(timer);
      scan.current?.abort();
    };
  }, [accept, liveOnly]);
  const running = state?.phase === 'running';
  const configured = state?.configured;
  const stream = configured?.stream ?? audio?.configured?.stream;
  const sampleRate = stream?.input.sample_rate ?? 48000;
  useEffect(() => {
    onPlaying?.(running ? name : null);
  }, [running, onPlaying, name]);
  async function command(action: GraphAudioAction) {
    if (!current.current || sending.current) return;
    const session = current.current.session;
    generation.current += 1;
    sending.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await graphAudioCommand(current.current, action);
      accept(next, session);
      if (action.kind === 'save_copy') {
        const items = await graphLibrary();
        if (alive.current) setLibrary(items);
      }
    } catch (cause) {
      if (alive.current)
        setError(friendlyError(cause, 'build the effects chain'));
    } finally {
      sending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function loadCatalog() {
    scan.current?.abort();
    const controller = new AbortController();
    scan.current = controller;
    setScanning(true);
    setError('');
    try {
      const plugins = await installedLv2(sampleRate);
      if (alive.current && scan.current === controller) setCatalog(plugins);
    } catch (cause) {
      if (!controller.signal.aborted && alive.current)
        setError(friendlyError(cause, 'build the effects chain'));
    } finally {
      if (alive.current && scan.current === controller) setScanning(false);
    }
  }
  function add(plugin: Lv2Plugin) {
    const node = `fx-${crypto.randomUUID()}`;
    const output = draft.rig.nodes.find((n) => n.kind === 'output')!;
    const values = plugin.ports
      .filter((p) => p.control && p.input)
      .map((p) => ({
        target: `${node}.${p.symbol}`,
        normalized: p.logarithmic
          ? Math.log(p.default! / p.minimum!) /
            Math.log(p.maximum! / p.minimum!)
          : (p.default! - p.minimum!) / (p.maximum! - p.minimum!),
      }));
    setDraft({
      ...draft,
      rig: {
        nodes: [
          ...draft.rig.nodes.filter((n) => n.id !== output.id),
          { id: node, kind: 'lv2', level: 1 },
          output,
        ],
        edges: [
          ...draft.rig.edges.map((edge) =>
            edge.to === output.id ? { ...edge, to: node } : edge,
          ),
          { from: node, to: output.id },
        ],
      },
      bindings: [...draft.bindings, { node, uri: plugin.uri }],
      recall: draft.recall
        ? { ...draft.recall, values: [...draft.recall.values, ...values] }
        : null,
    });
    setPicker(false);
  }
  async function addNam(asset: string) {
    if (!stream || draft.bindings.length || running)
      throw new Error('Choose an empty rig and audio device first');
    setBusy(true);
    generation.current += 1;
    try {
      let next = await playbackState();
      if (
        newNative.current &&
        next.session === newNative.current.session &&
        next.configured?.preset_id ===
          newNative.current.configured?.preset_id &&
        next.phase === 'running'
      ) {
        // Retry an assignment failure against the same created working rig.
      } else {
        if (next.device_owned)
          throw new Error(
            'Stop the current audio session before creating another preset',
          );
        next = await playbackCommand(next, {
          kind: 'create',
          stream,
          name: name.trim(),
        });
        newNative.current = next;
      }
      const slot = next.slots?.find((s) => s.position.lane === 0);
      if (!slot)
        throw new Error('No insertion slot available in this working rig');
      const updated = await playbackCommand(next, {
        kind: 'replace_model',
        assignment: { target: slot.target, asset },
      });
      if (alive.current) {
        setAudio(updated);
        setNamPicker(null);
        onOpenRig?.();
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function send(
    action: Action,
    revision: number | null,
    session: string,
  ): Promise<Snapshot> {
    const previous = current.current;
    if (!previous?.control || previous.control.session !== session)
      throw new Error('Audio session changed; reopen the control');
    generation.current += 1;
    const next = await graphAudioCommand(previous, {
      kind: 'control',
      command: {
        session,
        protocol: 1,
        request_id: crypto.randomUUID(),
        expected_revision: revision,
        action,
      },
    });
    if (!next.control) throw new Error('Graph controls unavailable');
    accept(next, previous.session);
    return next.control;
  }
  useEffect(() => {
    if (!running) return;
    const controller = new AbortController();
    void installedLv2(sampleRate)
      .then((plugins) => {
        if (!controller.signal.aborted) setCatalog(plugins);
      })
      .catch(() => {
        /* Controls still have authoritative native readback. */
      });
    return () => controller.abort();
  }, [running, sampleRate]);
  function controlScale(target: string) {
    const dot = target.indexOf('.');
    const binding = configured?.bindings.find(
      (b) => b.node === target.slice(0, dot),
    );
    const port = catalog
      .find((p) => p.uri === binding?.uri)
      ?.ports.find((p) => p.symbol === target.slice(dot + 1));
    return port ? lv2Control(port) : undefined;
  }
  async function compose() {
    setBusy(true);
    setError('');
    try {
      const mixed = await rigAudioState();
      if (mixed.phase === 'unavailable')
        throw new Error('Mixed playback is not enabled on this device.');
      if (draft.sampleRate !== undefined && draft.sampleRate !== sampleRate)
        throw new Error(
          'Match this draft’s sample rate in Audio setup before composing.',
        );
      if (draft.recall?.bypassed || draft.recall?.mappings.mappings.length)
        throw new Error(
          'Turn off global bypass and remove MIDI mappings before converting this draft.',
        );
      const plugins = await installedLv2(sampleRate);
      // Only a serial draft can be represented by this editor. Never flatten a DAG.
      const chain = draft.rig.nodes;
      if (
        chain[0]?.kind !== 'input' ||
        chain.at(-1)?.kind !== 'output' ||
        chain.slice(1, -1).some((n) => n.kind !== 'lv2' || n.level !== 1) ||
        draft.rig.edges.length !== chain.length - 1 ||
        chain
          .slice(1)
          .some(
            (n, i) =>
              !draft.rig.edges.some(
                (e) => e.from === chain[i]!.id && e.to === n.id,
              ),
          )
      )
        throw new Error(
          'This routing needs the full graph editor; start an empty draft for serial composition.',
        );
      const effects = chain.slice(1, -1).map((node) => {
        const uri = draft.bindings.find((b) => b.node === node.id)?.uri;
        const plugin = plugins.find((p) => p.uri === uri);
        if (!plugin)
          throw new Error('A required effect is no longer installed.');
        const effect = lv2Effect(plugin);
        if (effect.kind === 'lv2')
          for (const port of plugin.ports.filter((p) => p.input && p.control)) {
            const value = draft.recall?.values.find(
              (v) => v.target === `${node.id}.${port.symbol}`,
            )?.normalized;
            if (value !== undefined) {
              const scale = lv2Control(port);
              if (!scale)
                throw new Error('An effect has unsupported control scaling.');
              effect.controls[port.symbol] = scale.native(value);
            }
          }
        return effect;
      });
      if (alive.current) setMixedDraft(effects);
    } catch (cause) {
      if (alive.current)
        setError(friendlyError(cause, 'build the effects chain'));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (!liveOnly && mixedDraft)
    return (
      <RigComposer
        connected={connected}
        initial={mixedDraft}
        initialName={name}
        onOpenRig={() => onOpenRig?.()}
        onBack={() => setMixedDraft(null)}
      />
    );
  if (liveOnly && !running) return null;
  const disabled =
    !connected || busy || !state || state.phase === 'unavailable';
  const active = running ? configured : draft;
  const effects = active?.rig.nodes.filter((n) => n.kind === 'lv2') ?? [];
  const selectedEffect = effects.some((n) => n.id === selected)
    ? selected
    : effects[0]?.id;
  return (
    <section
      className={liveOnly ? 'panel space-y-3' : 'space-y-3'}
      aria-label="Effects authoring"
    >
      <div className="section-heading">
        <h2>{running ? 'Live controls' : 'New preset'}</h2>
        {running && (
          <span role="status">
            {state.saved_copy ? 'Saved copy' : 'Live session'}
          </span>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {!liveOnly && !running && (
        <>
          <label className="field">
            Preset name
            <input
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="action-row">
            <Button
              variant="outline"
              disabled={!connected || busy}
              onClick={() => void compose()}
            >
              <Plus aria-hidden="true" /> Add saved tone
            </Button>
            <Button
              disabled={!connected || busy || (!state && !audio)}
              onClick={() => {
                setPicker(true);
                if (state?.phase !== 'unavailable') void loadCatalog();
              }}
            >
              <Plus aria-hidden="true" /> Add effect
            </Button>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setDraft({ rig: emptyRig, bindings: [] });
                setName('New preset');
              }}
            >
              <Eraser aria-hidden="true" /> Clear draft
            </Button>
          </div>
          <p className="caption">
            Add NAM, IR or installed effects. Use a saved tone to compose a
            native/LV2 chain.
          </p>
        </>
      )}
      <ChainView
        label="Effects chain"
        selected={selectedEffect}
        onSelect={setSelected}
        lanes={[
          {
            id: 'main',
            input: 'IN',
            blocks: effects.map((node) => {
              const binding = active?.bindings.find((b) => b.node === node.id);
              const plugin = catalog.find((p) => p.uri === binding?.uri);
              const title =
                plugin?.name ?? binding?.uri.split(/[/#]/).pop() ?? 'Effect';
              const hint = `${title} ${binding?.uri ?? ''}`;
              return {
                id: node.id,
                label: title,
                kind: blockKind('', hint),
                // LV2 hosting exposes one rig-wide bypass, not per-block bypass.
                on: !state?.control?.bypassed,
                face: <GearIcon gear="" name={hint} />,
              };
            }),
          },
        ]}
      />
      {running && state.control && (
        <>
          <div className="action-row">
            <LedToggle
              on={!state.control.bypassed}
              kind="lv2"
              label="All effects on"
              disabled={disabled || !!state.control.edit}
              onToggle={() =>
                void command({
                  kind: 'control',
                  command: {
                    session: state.control!.session,
                    protocol: 1,
                    request_id: crypto.randomUUID(),
                    expected_revision: state.control!.revision,
                    action: {
                      type: 'set',
                      target: 'rig.bypass',
                      value: state.control!.bypassed ? 0 : 1,
                    },
                  },
                })
              }
            />
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => void command({ kind: 'stop' })}
            >
              <Stop aria-hidden="true" /> Stop audio
            </Button>
          </div>
          {effects.map((node, index) => {
            if (node.id !== selectedEffect) return null;
            const binding = configured?.bindings.find(
              (b) => b.node === node.id,
            );
            const plugin = catalog.find((p) => p.uri === binding?.uri);
            const title = `${index + 1} · ${plugin?.name ?? binding?.uri.split(/[/#]/).pop() ?? 'Effect'}`;
            return (
              <section key={node.id} className="space-y-2" aria-label={title}>
                <h3>{title}</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {state
                    .control!.parameters.filter((parameter) =>
                      parameter.id.startsWith(`${node.id}.`),
                    )
                    .map((parameter) => (
                      <div
                        key={parameter.id}
                        className="min-w-0 rounded-md border border-border p-2"
                      >
                        <h4 className="break-words">
                          {parameter.label.replaceAll('_', ' ')}
                        </h4>
                        <ControlEditor
                          parameter={parameter}
                          state={state.control!}
                          connected={connected && !busy}
                          send={send}
                          scale={controlScale(parameter.id)}
                          formatValue={controlScale(parameter.id)?.format}
                          accept={() => {}}
                        />
                      </div>
                    ))}
                </div>
              </section>
            );
          })}
          <div className="form-grid">
            <label className="field">
              Save as
              <input
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <Button
              disabled={disabled || !!state.control.edit || !name.trim()}
              onClick={() =>
                void command({ kind: 'save_copy', name: name.trim() })
              }
            >
              <FloppyDisk aria-hidden="true" /> Save preset
            </Button>
          </div>
        </>
      )}
      {!running && (
        <div className="action-row">
          <Button
            disabled={
              disabled ||
              !stream ||
              audio?.device_owned ||
              (draft.sampleRate !== undefined &&
                draft.sampleRate !== sampleRate)
            }
            onClick={() => {
              if (stream)
                void command({
                  kind: 'start',
                  settings: {
                    name: name.trim(),
                    library_id: draft.libraryId ?? null,
                    stream,
                    rig: draft.rig,
                    bindings: draft.bindings,
                    recall: draft.recall ?? null,
                  },
                });
            }}
          >
            Audition preset
          </Button>
          {configured && (
            <Button
              variant="outline"
              disabled={disabled || audio?.device_owned}
              onClick={() => void command({ kind: 'restart' })}
            >
              Resume effects
            </Button>
          )}
          {!stream && <p>Choose an audio device in Audio setup first.</p>}
          {audio?.device_owned && (
            <p>Stop the current audio session before starting another rig.</p>
          )}
          {draft.sampleRate !== undefined &&
            draft.sampleRate !== sampleRate && (
              <p>
                This copy uses {draft.sampleRate} Hz. Match it in Audio setup
                before recall.
              </p>
            )}
        </div>
      )}
      {!liveOnly && library.length > 0 && (
        <div className="space-y-2" aria-label="Saved effects rigs">
          <h3>Saved presets</h3>
          <div className="action-row">
            {library.map((item) => (
              <Button
                key={item.id}
                variant="outline"
                disabled={disabled || running}
                onClick={() => {
                  setDraft({
                    libraryId: item.id,
                    rig: item.preset.rig,
                    bindings: item.preset.bindings,
                    recall: item.preset.recall,
                    sampleRate: item.preset.sample_rate,
                  });
                  setName(item.preset.name);
                }}
              >
                {item.preset.name}
              </Button>
            ))}
          </div>
        </div>
      )}
      {namPicker && (
        <ModelPicker
          name={name}
          intent="add"
          initialFormat={namPicker}
          onClose={() => setNamPicker(null)}
          onAudition={addNam}
        />
      )}
      {picker && (
        <AdjustmentDialog
          title="Add effect"
          onCancel={() => {
            scan.current?.abort();
            setPicker(false);
          }}
        >
          <div className="space-y-3">
            {(['nam', 'ir'] as const).map((format) => (
              <Button
                key={format}
                variant="outline"
                className="w-full justify-start"
                disabled={
                  !stream ||
                  audio?.phase === 'unavailable' ||
                  audio?.device_owned ||
                  !!draft.bindings.length ||
                  !name.trim()
                }
                onClick={() => {
                  setPicker(false);
                  scan.current?.abort();
                  setNamPicker(format);
                }}
              >
                {format === 'nam' ? 'NAM model' : 'Cab / IR'}
              </Button>
            ))}
            {!!draft.bindings.length && (
              <p className="caption">
                Use Add saved tone to combine this chain with a saved NAM or
                TONE3000 tone.
              </p>
            )}
            {!stream && (
              <p className="caption">
                Choose an audio device in Audio setup first.
              </p>
            )}
            <label className="field">
              Search effects
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <Button
              variant="outline"
              disabled={scanning}
              onClick={() => void loadCatalog()}
            >
              Rescan installed effects
            </Button>
            {scanning && <p role="status">Scanning…</p>}
            {error && <p role="alert">{error}</p>}
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {catalog
                .filter((p) =>
                  `${p.name} ${p.uri}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((plugin) => (
                  <div key={plugin.uri}>
                    <Button
                      variant="outline"
                      className="h-auto min-h-11 w-full justify-start text-left whitespace-normal"
                      disabled={
                        !!plugin.unsupported ||
                        plugin.ports.some((p) => p.latency || p.atom) ||
                        scanning
                      }
                      onClick={() => add(plugin)}
                    >
                      {plugin.name}
                    </Button>
                    {(plugin.unsupported ||
                      plugin.ports.some((p) => p.latency || p.atom)) && (
                      <p className="caption">
                        {plugin.unsupported ??
                          (plugin.ports.some((p) => p.atom)
                            ? 'Message and file controls are not available yet.'
                            : 'Use “Add saved tone” to open the mixed-chain composer for this effect.')}
                      </p>
                    )}
                  </div>
                ))}
              {!scanning && !catalog.length && (
                <p>No installed effects available.</p>
              )}
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                scan.current?.abort();
                setPicker(false);
              }}
            >
              Close
            </Button>
          </div>
        </AdjustmentDialog>
      )}
    </section>
  );
}
