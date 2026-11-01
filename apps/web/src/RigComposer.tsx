import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Trash } from '@phosphor-icons/react';
import { Button } from './components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { Badge } from './components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from './components/ui/tabs';
import { AdjustmentDialog } from './AdjustmentDialog';
import { ArtworkDeck } from './AssetArtwork';
import { ChainView } from './ChainView';
import { GearIcon } from './GearIcon';
import { NativeSplitDialog } from './NativeSplitDialog';
import {
  lv2Effect,
  serialRig,
  sceneRig,
  canMoveEffect,
  removeEffect,
  type NativeDraft,
  type DraftEffect,
  type MonoInput,
} from './rigDraft';
import {
  installedLv2,
  rigNativeSources,
  rigLibrary,
  rigAudioState,
  rigAudioCommand,
  publishRig,
  playbackState,
  graphAudioState,
  type Lv2Plugin,
  type Preset,
} from './api';
import type { ResourceSource } from './generated/contract';
import { blockKind, type RigBlockVM } from './rigChain';
import './RigComposer.css';

/**
 * Draft editing leaves the sounding session alone. Play admits a verified revision.
 * @see docs/interface.md
 */
export function RigComposer({
  connected,
  initial,
  initialName,
  onOpenRig,
  onBack,
}: {
  connected: boolean;
  initial: DraftEffect[];
  initialName: string;
  onOpenRig: () => void;
  onBack: () => void;
}) {
  const [id] = useState(() => crypto.randomUUID());
  const [effects, setEffects] = useState(initial);
  const [layout, setLayout] = useState<'serial' | 'scenes'>('serial');
  const [sceneTails, setSceneTails] = useState<'cut' | 'preserve'>('preserve');
  const [name, setName] = useState(initialName);
  const [selected, setSelected] = useState(initial[0]?.id ?? '');
  const [picker, setPicker] = useState<'tones' | 'effects' | null>('tones');
  const [tones, setTones] = useState<
    { preset: Preset; source: ResourceSource }[]
  >([]);
  const [catalog, setCatalog] = useState<Lv2Plugin[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const preparation = useRef<{
    session: string;
    revision: string;
    cancelRequested: boolean;
  } | null>(null);
  const [error, setError] = useState('');
  const [split, setSplit] = useState<NativeDraft | null>(null);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (!picker) return;
    async function load() {
      try {
        if (picker === 'tones') {
          const sources = await rigNativeSources(controller.signal);
          if (!controller.signal.aborted) setTones(sources);
        } else {
          const [rig, native, graph] = await Promise.all([
            rigAudioState(),
            playbackState(),
            graphAudioState(),
          ]);
          const rate =
            (
              rig.configured?.stream ??
              native.configured?.stream ??
              graph.configured?.stream
            )?.input.sample_rate ?? 48000;
          const plugins = await installedLv2(rate);
          if (!controller.signal.aborted) setCatalog(plugins);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(String(cause));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [picker]);
  function move(index: number, step: -1 | 1) {
    setEffects((old) => {
      if (
        !canMoveEffect(old, index, step) ||
        (layout === 'scenes' && old[index]?.kind !== old[index + step]?.kind)
      )
        return old;
      const next = [...old];
      [next[index], next[index + step]] = [next[index + step]!, next[index]!];
      return next;
    });
  }
  function moveBefore(id: string, before: string | null) {
    setEffects((old) => {
      const next = [...old];
      let index = next.findIndex((effect) => effect.id === id);
      if (index < 0) return old;
      let destination = before
        ? next.findIndex((effect) => effect.id === before)
        : next.length;
      if (destination < 0) return old;
      if (destination > index) destination -= 1;
      while (index !== destination) {
        const step = index < destination ? 1 : -1;
        if (
          !canMoveEffect(next, index, step) ||
          (layout === 'scenes' &&
            next[index]?.kind !== next[index + step]?.kind)
        )
          return old;
        [next[index], next[index + step]] = [next[index + step]!, next[index]!];
        index += step;
      }
      return next;
    });
  }
  function movable(id: string) {
    const index = effects.findIndex((effect) => effect.id === id);
    return ([-1, 1] as const).some(
      (step) =>
        canMoveEffect(effects, index, step) &&
        (layout !== 'scenes' ||
          effects[index]?.kind === effects[index + step]?.kind),
    );
  }
  const block = (effect: DraftEffect): RigBlockVM => {
    const stage = effect.kind === 'native' ? effect.stage?.role : undefined;
    const kind = stage ?? blockKind('', effect.name);
    return {
      id: effect.id,
      label: effect.name,
      kind,
      on: true,
      face: <GearIcon gear={stage ?? ''} name={effect.name} />,
    };
  };
  const selectedEffect =
    effects.find((effect) => effect.id === selected) ?? effects[0];
  const selectedIndex = selectedEffect
    ? effects.findIndex((effect) => effect.id === selectedEffect.id)
    : -1;
  function remove(id: string) {
    const index = effects.findIndex((effect) => effect.id === id);
    const next = removeEffect(effects, id);
    setEffects(next);
    if (selected === id)
      setSelected(next[Math.min(index, next.length - 1)]?.id ?? '');
  }
  function chooseLayout(next: 'serial' | 'scenes') {
    setLayout(next);
    if (next === 'scenes')
      setEffects((old) => [
        ...old.filter((effect) => effect.kind === 'native'),
        ...old.filter((effect) => effect.kind === 'lv2'),
      ]);
  }
  async function play() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const [rig, native, graph, library] = await Promise.all([
        rigAudioState(),
        playbackState(),
        graphAudioState(),
        rigLibrary(),
      ]);
      if ([rig, native, graph].some((s) => s.device_owned))
        throw new Error('Stop the current audio before playing this draft.');
      const stream =
        rig.configured?.stream ??
        native.configured?.stream ??
        graph.configured?.stream;
      if (!stream)
        throw new Error(
          'Choose the input, output and buffer in Settings → Audio first.',
        );
      if (
        effects.some((e) => e.kind === 'native' && e.stage) &&
        (stream.input.sample_rate !== 48000 ||
          stream.output.sample_rate !== 48000)
      )
        throw new Error(
          'Separate amp/cab stages need 48 kHz. Choose it in Settings → Audio.',
        );
      const document = await publishRig(
        layout === 'scenes'
          ? sceneRig(id, name, effects, library.native_profile, sceneTails)
          : serialRig(id, name, effects, library.native_profile),
      );
      let next = await rigAudioCommand(rig, {
        kind: 'start',
        settings: { revision: document.revision, stream, recall: null },
      });
      const expected = {
        session: next.session,
        revision: document.revision,
        cancelRequested: false,
      };
      preparation.current = expected;
      if (alive.current) setPreparing(true);
      while (alive.current) {
        if (next.session !== expected.session)
          throw new Error('Another audio session replaced this draft.');
        // A rejected candidate restores the previous confirmed configuration.
        // Retain the actual failure before checking the running revision.
        if (next.phase !== 'starting' && next.phase !== 'running')
          throw new Error(
            next.error ?? 'Preparation stopped. Your draft is still here.',
          );
        if (next.configured?.revision !== expected.revision)
          throw new Error('Another audio session replaced this draft.');
        if (next.phase === 'running' && !expected.cancelRequested) {
          onOpenRig();
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (!alive.current) break;
        next = await rigAudioState();
      }
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      preparation.current = null;
      if (alive.current) {
        setBusy(false);
        setPreparing(false);
      }
    }
  }
  async function cancelPreparation() {
    if (cancelling || !preparation.current) return;
    const expected = preparation.current;
    expected.cancelRequested = true;
    setCancelling(true);
    try {
      const state = await rigAudioState();
      if (
        state.session !== expected.session ||
        state.configured?.revision !== expected.revision
      )
        throw new Error('Another audio session replaced this draft.');
      await rigAudioCommand(state, { kind: 'stop' });
    } catch (cause) {
      expected.cancelRequested = false;
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setCancelling(false);
    }
  }
  return (
    <section className="rig-builder space-y-3" aria-label="Compose rig">
      <header className="rig-builder-header">
        <label className="field min-w-0 flex-1">
          <span className="sr-only">Preset name</span>
          <input
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <Badge>Draft</Badge>
        <Button
          disabled={!connected || busy || !name.trim()}
          onClick={() => void play()}
        >
          {busy ? 'Preparing…' : 'Play draft'}
        </Button>
      </header>
      <div className="rig-builder-toolbar">
        <Tabs
          value={layout}
          onValueChange={(value) => chooseLayout(value as 'serial' | 'scenes')}
        >
          <TabsList aria-label="Rig layout">
            <TabsTrigger value="serial" disabled={busy}>
              Chain
            </TabsTrigger>
            <TabsTrigger
              value="scenes"
              disabled={
                busy || effects.some((e) => e.kind === 'native' && !!e.stage)
              }
            >
              Scenes
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="action-row">
          <Button
            variant="outline"
            disabled={!connected || busy}
            onClick={() => {
              setQuery('');
              setLoading(true);
              setError('');
              setPicker('tones');
            }}
          >
            Add saved tone
          </Button>
          <Button
            variant="outline"
            disabled={!connected || busy}
            onClick={() => {
              setQuery('');
              setLoading(true);
              setError('');
              setPicker('effects');
            }}
          >
            Add effect
          </Button>
        </div>
      </div>
      {preparing && (
        <Button
          variant="outline"
          disabled={cancelling}
          onClick={() => void cancelPreparation()}
        >
          {cancelling ? 'Cancelling…' : 'Cancel preparation'}
        </Button>
      )}
      <div className="rig-builder-workspace">
        <div className="rig-builder-canvas">
          <div className="rig-builder-canvas-heading">
            <div>
              <p className="eyebrow">Signal path</p>
              <h2>{layout === 'serial' ? 'Chain' : 'Scenes'}</h2>
            </div>
            <span className="caption">
              {effects.length} {effects.length === 1 ? 'block' : 'blocks'}
            </span>
          </div>
          {layout === 'serial' ? (
            <ChainView
              label="Draft signal chain"
              lanes={[
                {
                  id: 'Main',
                  input: 'IN',
                  blocks: effects.map(block),
                },
              ]}
              selected={selectedEffect?.id}
              onSelect={setSelected}
              disabled={busy}
              movable={movable}
              onMove={(id, _lane, before) => moveBefore(id, before)}
            />
          ) : (
            <>
              <ChainView
                label="Scene branches"
                parallel
                lanes={effects
                  .filter((effect) => effect.kind === 'native')
                  .map((effect, index) => ({
                    id: `Scene ${index + 1}`,
                    input: String(index + 1),
                    blocks: [block(effect)],
                  }))}
                selected={selectedEffect?.id}
                onSelect={setSelected}
                disabled={busy}
              />
              <div className="rig-builder-shared">
                <Badge>Shared after scenes</Badge>
                <ChainView
                  label="Shared effects"
                  lanes={[
                    {
                      id: 'Shared',
                      input: 'SUM',
                      blocks: effects
                        .filter((effect) => effect.kind === 'lv2')
                        .map(block),
                    },
                  ]}
                  selected={selectedEffect?.id}
                  onSelect={setSelected}
                  disabled={busy}
                  movable={movable}
                  onMove={(id, _lane, before) => moveBefore(id, before)}
                />
              </div>
              <label className="rig-builder-tail-mode">
                <span>Scene tails</span>
                <Select
                  value={sceneTails}
                  disabled={busy}
                  onValueChange={(value) =>
                    setSceneTails(value as 'cut' | 'preserve')
                  }
                >
                  <SelectTrigger aria-label="Scene tails">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="preserve">Keep ringing</SelectItem>
                    <SelectItem value="cut">Cut immediately</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </>
          )}
          {!effects.length && (
            <div className="rig-builder-empty">
              <strong>Start with a tone or effect</strong>
              <span>
                Add blocks above. The signal path stays editable until you play
                it.
              </span>
            </div>
          )}
        </div>
        <section className="rig-builder-inspector" aria-label="Block inspector">
          {selectedEffect ? (
            <>
              <div className="rig-builder-inspector-heading">
                <div className="rig-builder-inspector-icon">
                  {block(selectedEffect).face}
                </div>
                <div>
                  <Badge>
                    {selectedEffect.kind === 'native'
                      ? selectedEffect.stage?.role === 'amp'
                        ? 'Amp'
                        : selectedEffect.stage?.role === 'cab'
                          ? 'Cab / IR'
                          : 'NAM tone'
                      : 'Effect'}
                  </Badge>
                  <h3>{selectedEffect.name}</h3>
                </div>
              </div>
              <div className="rig-builder-inspector-actions">
                <Button
                  variant="outline"
                  className="h-11 w-11 p-0"
                  aria-label={`Move ${selectedEffect.name} earlier`}
                  disabled={
                    busy ||
                    !canMoveEffect(effects, selectedIndex, -1) ||
                    (layout === 'scenes' &&
                      selectedEffect.kind !== effects[selectedIndex - 1]?.kind)
                  }
                  onClick={() => move(selectedIndex, -1)}
                >
                  <ArrowUp size={18} />
                </Button>
                <Button
                  variant="outline"
                  className="h-11 w-11 p-0"
                  aria-label={`Move ${selectedEffect.name} later`}
                  disabled={
                    busy ||
                    !canMoveEffect(effects, selectedIndex, 1) ||
                    (layout === 'scenes' &&
                      selectedEffect.kind !== effects[selectedIndex + 1]?.kind)
                  }
                  onClick={() => move(selectedIndex, 1)}
                >
                  <ArrowDown size={18} />
                </Button>
                <Button
                  variant="ghost"
                  className="h-11 w-11 p-0"
                  aria-label={
                    selectedEffect.kind === 'native' && selectedEffect.stage
                      ? `Remove amp/cab pair ${selectedEffect.name}`
                      : `Remove ${selectedEffect.name}`
                  }
                  disabled={busy}
                  onClick={() => remove(selectedEffect.id)}
                >
                  <Trash size={18} />
                </Button>
              </div>
              {layout === 'scenes' && selectedEffect.kind === 'native' && (
                <label className="field">
                  Scene name
                  <input
                    aria-label={`Scene ${
                      effects
                        .filter((effect) => effect.kind === 'native')
                        .findIndex(
                          (effect) => effect.id === selectedEffect.id,
                        ) + 1
                    } name`}
                    value={selectedEffect.name}
                    maxLength={80}
                    disabled={busy}
                    onChange={(event) =>
                      setEffects((old) =>
                        old.map((item) =>
                          item.id === selectedEffect.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
              )}
              {layout === 'serial' &&
                selectedEffect.kind === 'native' &&
                !selectedEffect.stage && (
                  <Button
                    variant="outline"
                    disabled={busy || !connected}
                    onClick={() => setSplit(selectedEffect)}
                  >
                    Separate amp & cab
                  </Button>
                )}
              {selectedEffect.kind === 'native' && selectedEffect.stage && (
                <p className="caption">
                  {selectedEffect.stage.role === 'amp'
                    ? `Amp · ${selectedEffect.stage.recipe.input === 'left' ? 'L' : 'R'} input`
                    : 'Cab / IR'}{' '}
                  · linked pair · 48 kHz
                </p>
              )}
              {selectedEffect.kind === 'lv2' &&
                selectedEffect.plugin.ports.filter(
                  (port) => port.audio && port.input,
                ).length === 1 && (
                  <label className="field">
                    Mono input
                    <Select
                      value={selectedEffect.mono}
                      disabled={busy}
                      onValueChange={(value) =>
                        setEffects((old) =>
                          old.map((item) =>
                            item.id === selectedEffect.id && item.kind === 'lv2'
                              ? {
                                  ...item,
                                  mono: value as MonoInput,
                                }
                              : item,
                          ),
                        )
                      }
                    >
                      <SelectTrigger aria-label="Mono input">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sum">L + R (average)</SelectItem>
                        <SelectItem value="left">Left</SelectItem>
                        <SelectItem value="right">Right</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>
                )}
              <p className="caption">
                Draft changes do not alter the sounding rig until you choose
                Play draft.
              </p>
            </>
          ) : (
            <div className="rig-builder-inspector-empty">
              <strong>No block selected</strong>
              <span>Add a tone or effect to begin.</span>
            </div>
          )}
        </section>
      </div>
      <p className="caption">
        Play to hear it, then save from the sounding rig. Mono effects return
        the same signal to L and R.
      </p>
      {error && !picker && <p role="alert">{error}</p>}
      <Button variant="ghost" disabled={busy} onClick={onBack}>
        Discard composition
      </Button>
      {split && (
        <NativeSplitDialog
          effect={split}
          onCancel={() => setSplit(null)}
          onSplit={(pair) => {
            setEffects((old) =>
              old.flatMap((e) => (e.id === split.id ? pair : [e])),
            );
            setSelected(pair[0].id);
            setSplit(null);
          }}
        />
      )}
      {picker && (
        <AdjustmentDialog
          title={picker === 'tones' ? 'Add saved tone' : 'Add effect'}
          onCancel={() => setPicker(null)}
        >
          <div className="space-y-3">
            <label className="field">
              Search
              <input value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {loading && <p role="status">Loading…</p>}
            {error && <p role="alert">{error}</p>}
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {picker === 'tones'
                ? tones
                    .filter((t) =>
                      t.preset.name.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((t) => (
                      <div key={`${t.source.kind}-${t.preset.sha256}`}>
                        <Button
                          variant="outline"
                          className="min-h-11 w-full justify-start text-left whitespace-normal"
                          disabled={loading}
                          onClick={() => {
                            const item: DraftEffect = {
                              id: `native-${crypto.randomUUID()}`,
                              kind: 'native',
                              name: t.preset.name,
                              ...t,
                            };
                            setEffects((old) => [...old, item]);
                            setSelected(item.id);
                            setPicker(null);
                          }}
                        >
                          {t.preset.name}
                          {t.source.kind === 'owned' ? ' · saved copy' : ''}
                        </Button>
                        <ArtworkDeck
                          id={t.preset.sha256}
                          owned={t.source.kind === 'owned'}
                        />
                      </div>
                    ))
                : catalog
                    .filter((p) =>
                      `${p.name} ${p.uri}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((plugin) => (
                      <div key={plugin.uri}>
                        <Button
                          variant="outline"
                          className="min-h-11 w-full justify-start text-left whitespace-normal"
                          disabled={
                            loading ||
                            !!plugin.unsupported ||
                            plugin.ports.some((p) => p.atom)
                          }
                          onClick={() => {
                            try {
                              const item = lv2Effect(plugin);
                              setEffects((old) => [...old, item]);
                              setSelected(item.id);
                              setPicker(null);
                            } catch (cause) {
                              setError(String(cause));
                            }
                          }}
                        >
                          {plugin.name}
                        </Button>
                        {(plugin.unsupported ||
                          plugin.ports.some((p) => p.atom)) && (
                          <p className="caption">
                            {plugin.unsupported ??
                              'Message and file controls are not available yet.'}
                          </p>
                        )}
                      </div>
                    ))}
            </div>
            {!loading && picker === 'tones' && !tones.length && (
              <p>Import a TONE3000 preset or save a tone first.</p>
            )}
            <Button variant="ghost" onClick={() => setPicker(null)}>
              Close
            </Button>
          </div>
        </AdjustmentDialog>
      )}
    </section>
  );
}
