import { useEffect, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, Trash } from '@phosphor-icons/react';
import { Button } from './components/ui/button';
import { AdjustmentDialog } from './AdjustmentDialog';
import { ArtworkDeck } from './AssetArtwork';
import { NativeSplitDialog } from './NativeSplitDialog';
import {
  lv2Effect,
  serialRig,
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

/** Draft editing leaves the sounding session alone. Play admits a verified revision. */
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
  const [name, setName] = useState(initialName);
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
          const plugins = await installedLv2(rate, controller.signal);
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
      if (!canMoveEffect(old, index, step)) return old;
      const next = [...old];
      [next[index], next[index + step]] = [next[index + step]!, next[index]!];
      return next;
    });
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
        serialRig(id, name, effects, library.native_profile),
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
    <section className="space-y-3" aria-label="Compose rig">
      <h2 className="sr-only">Compose preset</h2>
      <div className="flex items-center gap-2">
        <label className="field min-w-0 flex-1">
          <span className="sr-only">Preset name</span>
          <input
            value={name}
            maxLength={80}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <span className="caption">Draft</span>
      </div>
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
        <Button
          disabled={!connected || busy || !name.trim()}
          onClick={() => void play()}
        >
          {busy ? 'Preparing…' : 'Play draft'}
        </Button>
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
      <ol className="space-y-2" aria-label="Draft signal chain">
        <li className="caption">Input · L / R</li>
        {effects.map((effect, index) => (
          <li
            key={effect.id}
            data-effect={effect.id}
            className="space-y-2 border-b border-border py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 font-semibold break-words">
                {index + 1} · {effect.name}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="h-11 w-11 p-0"
                  aria-label={`Move ${effect.name} earlier`}
                  disabled={busy || !canMoveEffect(effects, index, -1)}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={18} />
                </Button>
                <Button
                  variant="outline"
                  className="h-11 w-11 p-0"
                  aria-label={`Move ${effect.name} later`}
                  disabled={busy || !canMoveEffect(effects, index, 1)}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={18} />
                </Button>
                <Button
                  variant="ghost"
                  className="h-11 w-11 p-0"
                  aria-label={
                    effect.kind === 'native' && effect.stage
                      ? `Remove amp/cab pair ${effect.name}`
                      : `Remove ${effect.name}`
                  }
                  disabled={busy}
                  onClick={() =>
                    setEffects((old) => removeEffect(old, effect.id))
                  }
                >
                  <Trash size={18} />
                </Button>
              </div>
            </div>
            {effect.kind === 'native' && !effect.stage && (
              <Button
                variant="outline"
                disabled={busy || !connected}
                onClick={() => setSplit(effect)}
              >
                Separate amp & cab
              </Button>
            )}
            {effect.kind === 'native' && effect.stage && (
              <p className="caption">
                {effect.stage.role === 'amp'
                  ? `Amp · ${effect.stage.recipe.input === 'left' ? 'L' : 'R'} input`
                  : 'Cab / IR'}{' '}
                · linked pair · 48 kHz
              </p>
            )}
            {effect.kind === 'lv2' &&
              effect.plugin.ports.filter((p) => p.audio && p.input).length ===
                1 && (
                <label className="field">
                  Mono input
                  <select
                    value={effect.mono}
                    disabled={busy}
                    onChange={(e) =>
                      setEffects((old) =>
                        old.map((item) =>
                          item.id === effect.id && item.kind === 'lv2'
                            ? { ...item, mono: e.target.value as MonoInput }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="sum">L + R (average)</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </label>
              )}
          </li>
        ))}
        <li className="caption">Output · L / R</li>
      </ol>
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
                            setEffects((old) => [
                              ...old,
                              {
                                id: `native-${crypto.randomUUID()}`,
                                kind: 'native',
                                name: t.preset.name,
                                ...t,
                              },
                            ]);
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
