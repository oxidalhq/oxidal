import { useEffect, useState } from 'react';
import { NativeEditor } from '../../NativeEditor';
import { panLabel } from '../../lib/panLabel';
import { replaceNativeFiles } from '../../nativeResourceEdit';
import { readBlock } from '../../rigEdit';
import {
  installedLv2,
  libraryCatalog,
  publishRig,
  rigDocument,
  rigLibrary,
  rigNativeSources,
  importRigResource,
  type Lv2Plugin,
  type RigDocument,
} from '../../api';
import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Button } from '../../components/ui/button';
import { Loading } from '../../components/ui/loading';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import {
  errorRecovery,
  friendlyError,
  type Recovery,
} from '../../lib/friendlyError';
import { lv2Effect, type DraftEffect, type NativeDraft } from '../../rigDraft';
import {
  buildRoute,
  isSplit,
  readRoute,
  routeAddPath,
  routeAppend,
  routeControl,
  routePath,
  routePathMix,
  pathMix,
  type PathMix,
  routeRemove,
  routeShift,
  routeReplaceNative,
  type Route,
  type RouteSplit,
} from '../../rigRoute';
import { keepScenes } from '../../sceneEdit';
import { presetNameError } from './newPreset';

/** The scan rate for plugin metadata; nothing is processed here. */
const METADATA_RATE = 48000;

type Tone = Awaited<ReturnType<typeof rigNativeSources>>[number];

type Opened = {
  document: RigDocument;
  plugins: Lv2Plugin[];
  tones: Tone[];
  profile: string;
  mine: boolean;
  /** Scenes are separate TONE3000 chains: only block settings change here,
   * keyed by native instance id (7.3). Routing stays with Rig. */
  chains?: { instance: string; block: NativeDraft }[];
};

/**
 * Edit a saved preset without playing it (7.3): the routing, its effects and
 * their settings change in a draft held here, and only Save publishes a new
 * revision. Nothing starts, stops or switches audio. A preset of your own keeps
 * its identity (the saved revision replaces it in the Set list); any other
 * preset is saved as a copy in Mine. Scene levels follow routing changes;
 * presets whose scenes are separate TONE3000 chains change block settings only.
 * @see docs/presets/format.md
 */
export function OfflineEditor({
  revision,
  connected,
  onSaved,
  onCancel,
  onRefresh = onCancel,
}: {
  revision: string;
  connected: boolean;
  onSaved: (saved: RigDocument) => void;
  onCancel: () => void;
  /** Closes the editor and reloads the Library after a conflict. */
  onRefresh?: () => void;
}) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const [route, setRoute] = useState<Route>([]);
  const [name, setName] = useState('');
  const [dirty, setDirty] = useState(false);
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState('');
  const [discarding, setDiscarding] = useState(false);
  const [recovery, setRecovery] = useState<Recovery>(null);
  // The TONE3000 block whose settings are open in the native editor (7.3).
  // Edited TONE3000 files of a scene-chain preset, by native instance id.
  const [chainEdits, setChainEdits] = useState<
    Record<string, Pick<NativeDraft, 'preset' | 'source'>>
  >({});
  const [tuning, setTuning] = useState<{
    block: NativeDraft;
    open: { id: string; owned: boolean; name: string };
  } | null>(null);
  /** Opens a TONE3000 block's settings; a file stored only in the saved
   * preset is copied into the library first so the editor can open it. */
  async function tune(block: NativeDraft) {
    setError('');
    try {
      const source = block.source;
      const open =
        source.kind === 'bundle'
          ? {
              id: (await importRigResource(source.revision, source.resource))
                .sha256,
              owned: false,
            }
          : { id: source.preset, owned: source.kind === 'owned' };
      setTuning({ block, open: { ...open, name: block.name } });
    } catch (cause) {
      setError(friendlyError(cause, 'open the TONE3000 settings'));
    }
  }
  // Another browser saved or removed this preset while it is open here (7.26).
  const [elsewhere, setElsewhere] = useState<'changed' | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [document, plugins, tones, library, catalog] = await Promise.all([
        rigDocument(revision),
        // Effects need plugin metadata; a preset without them opens anyway.
        installedLv2(METADATA_RATE).catch(() => [] as Lv2Plugin[]),
        // Saved TONE3000 tones (NAM and IR captures); optional the same way.
        rigNativeSources().catch(() => [] as Tone[]),
        rigLibrary(),
        libraryCatalog(),
      ]);
      if (!alive) return;
      const listed = catalog.items.find(
        (i) => i.kind === 'rig' && i.id === revision,
      );
      setName(listed?.name ?? document.manifest.name);
      const scenes = document.manifest.extensions['urn:oxidal:scenes:1'] as
        { branches?: unknown[] } | undefined;
      const base = {
        document,
        plugins,
        tones,
        profile: library.native_profile,
        mine: (listed?.origin ?? 'mine') === 'mine',
      };
      if (scenes?.branches?.length) {
        const chains = (document.manifest.oxidal?.graph.nodes ?? [])
          .filter((n) => n.kind === 'tone3000' && n.instance)
          .map((n) => ({
            instance: n.instance!,
            block: readBlock(document, plugins, {}, n.id) as NativeDraft,
          }));
        setOpened({ ...base, chains });
        return;
      }
      setRoute(readRoute(document, plugins, {}));
      setOpened(base);
    })().catch((cause: unknown) => {
      if (alive) setBlocked(friendlyError(cause, 'open this preset'));
    });
    return () => {
      alive = false;
    };
  }, [revision]);
  const presetId = opened?.document.manifest.id;
  useEffect(() => {
    if (!presetId) return;
    let alive = true;
    const check = async () => {
      let after: string | undefined;
      let listed = false;
      let newer = false;
      for (let page = 0; page < 50; page += 1) {
        const next = await rigLibrary(after);
        for (const p of next.presets) {
          if (p.revision === revision) listed = true;
          else if (p.id === presetId) newer = true;
        }
        if (!next.next) break;
        after = next.next;
      }
      // Only a newer revision of this preset counts: a preset taken off the
      // set list is also unlisted, and that is not an edit elsewhere.
      if (alive) setElsewhere(!listed && newer ? 'changed' : null);
    };
    const timer = window.setInterval(() => void check().catch(() => {}), 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [presetId, revision]);
  function change(edit: (route: Route) => Route) {
    setError('');
    setRoute((current) => {
      try {
        const next = edit(current);
        if (next !== current) setDirty(true);
        return next;
      } catch (cause) {
        setError(friendlyError(cause, 'change the routing'));
        return current;
      }
    });
  }
  async function save() {
    const nameError = presetNameError(name);
    if (!opened || busy) return;
    if (nameError) {
      setError(nameError);
      return;
    }
    setBusy(true);
    setError('');
    setRecovery(null);
    try {
      const id = opened.mine
        ? opened.document.manifest.id
        : crypto.randomUUID();
      // Scene levels follow the new routing (C9); scene-chain presets keep
      // their graph and only swap edited TONE3000 files.
      const request = opened.chains
        ? replaceNativeFiles(opened.document, chainEdits, id, name)
        : keepScenes(
            opened.document,
            buildRoute(id, name, route, opened.profile),
          );
      request.source = { kind: 'rig', id: opened.document.revision };
      onSaved(await publishRig(request));
    } catch (cause) {
      // The draft stays open so nothing is lost.
      setError(friendlyError(cause, 'save the preset'));
      setRecovery(errorRecovery(cause));
    } finally {
      setBusy(false);
    }
  }
  const usable = opened?.plugins.filter((p) => !p.unsupported) ?? [];
  const effect = (uri: string): DraftEffect | null => {
    const plugin = usable.find((p) => p.uri === uri);
    return plugin ? lv2Effect(plugin) : null;
  };
  const tones = opened?.tones ?? [];
  const toneKey = (t: Tone) => `${t.source.kind}:${t.preset.sha256}`;
  function made(value: string): DraftEffect | null {
    if (value.startsWith('lv2:')) return effect(value.slice(4));
    const tone = tones.find((t) => toneKey(t) === value.slice(5));
    return tone
      ? {
          id: `native-${crypto.randomUUID()}`,
          kind: 'native',
          name: tone.preset.name,
          ...tone,
        }
      : null;
  }
  function addEffect(at?: { split: string; path: number }) {
    const key = at ? `${at.split}:${at.path}` : 'end';
    return (
      <Select
        value=""
        onValueChange={(value) => {
          const item = made(value);
          if (item) change((r) => routeAppend(r, item, at));
          setAdding('');
        }}
        open={adding === key}
        onOpenChange={(open) => setAdding(open ? key : '')}
      >
        <SelectTrigger
          aria-label={
            at ? `Add a block to path ${at.path + 1}` : 'Add a block at the end'
          }
          className="w-auto"
          disabled={busy || !(usable.length || tones.length)}
        >
          <SelectValue placeholder="+ Add" />
        </SelectTrigger>
        <SelectContent>
          {tones.map((t) => (
            <SelectItem key={toneKey(t)} value={`tone:${toneKey(t)}`}>
              {t.preset.name}
              {t.source.kind === 'owned' ? ' · saved copy' : ''} · TONE3000
            </SelectItem>
          ))}
          {usable.map((p) => (
            <SelectItem key={p.uri} value={`lv2:${p.uri}`}>
              {p.name} · Effect
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  function block(item: DraftEffect, first: boolean, last: boolean) {
    const block = item;
    const ports =
      block.kind === 'lv2'
        ? block.plugin.ports.filter(
            (p) =>
              p.control && p.input && p.minimum != null && p.maximum != null,
          )
        : [];
    return (
      <li key={block.id} className="offline-block">
        <div className="offline-row">
          <strong>{block.name}</strong>
          <span className="caption">
            {block.kind === 'native'
              ? block.stage
                ? `TONE3000 ${block.stage.role} stage`
                : 'TONE3000'
              : 'Effect'}
          </span>
          <span className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            aria-label={`Move ${block.name} earlier`}
            disabled={busy || first}
            onClick={() => change((r) => routeShift(r, block.id, -1))}
          >
            ↑
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Move ${block.name} later`}
            disabled={busy || last}
            onClick={() => change((r) => routeShift(r, block.id, 1))}
          >
            ↓
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Add a parallel path beside ${block.name}`}
            disabled={busy}
            onClick={() => change((r) => routeAddPath(r, block.id))}
          >
            Parallel path
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={`Remove ${block.name}`}
            disabled={busy}
            onClick={() => change((r) => routeRemove(r, block.id))}
          >
            Remove
          </Button>
        </div>
        {block.kind === 'native' &&
          (block.stage ? (
            <p className="caption">
              Settings of an extracted amp or cab stage are changed with its
              whole tone in Rig.
            </p>
          ) : (
            <Button
              type="button"
              variant="outline"
              aria-label={`Edit ${block.name} settings`}
              disabled={busy || !connected}
              onClick={() => void tune(block)}
            >
              Edit settings…
            </Button>
          ))}
        {!!ports.length && block.kind === 'lv2' && (
          <details>
            <summary>Settings</summary>
            <div className="control-stack">
              {ports.map((p) => (
                <label key={p.symbol} className="field">
                  <span>
                    {p.symbol} · {block.controls[p.symbol] ?? p.default}
                  </span>
                  <input
                    type="range"
                    aria-label={`${block.name} ${p.symbol}`}
                    min={p.minimum!}
                    max={p.maximum!}
                    step={
                      p.integer || p.toggled
                        ? 1
                        : (p.maximum! - p.minimum!) / 100
                    }
                    value={block.controls[p.symbol] ?? p.default ?? p.minimum!}
                    disabled={busy}
                    onChange={(event) =>
                      change((r) =>
                        routeControl(
                          r,
                          block.id,
                          p.symbol,
                          Number(event.target.value),
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </details>
        )}
      </li>
    );
  }
  function split(step: RouteSplit) {
    return (
      <li key={step.split} className="offline-split">
        <span className="caption">Split · {step.branches.length} paths</span>
        <ol className="offline-paths">
          {step.branches.map((branch, path) => (
            <li key={path} aria-label={`Path ${path + 1}`}>
              <div className="offline-row">
                <span>Path {path + 1}</span>
                {!branch.length && (
                  <span className="caption">Dry · no blocks</span>
                )}
                <span className="flex-1" />
                {addEffect({ split: step.split, path })}
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Copy path ${path + 1}`}
                  disabled={busy}
                  onClick={() =>
                    change((r) => routePath(r, step.split, path, 'copy'))
                  }
                >
                  Copy
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove path ${path + 1}`}
                  disabled={busy}
                  onClick={() =>
                    change((r) => routePath(r, step.split, path, 'remove'))
                  }
                >
                  Remove
                </Button>
              </div>
              {(() => {
                const mix = pathMix(
                  step.gains[path] ?? 1,
                  step.rightGains?.[path],
                );
                const set = (next: Partial<PathMix>) =>
                  change((r) =>
                    routePathMix(r, step.split, path, { ...mix, ...next }),
                  );
                return (
                  <div className="path-mix">
                    <label className="field">
                      <span>
                        Path {path + 1} level · {Math.round(mix.level * 100)}%
                      </span>
                      <input
                        type="range"
                        aria-label={`Path ${path + 1} level`}
                        min={0}
                        max={2}
                        step={0.05}
                        value={mix.level}
                        disabled={busy}
                        onChange={(event) =>
                          set({ level: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="field">
                      <span>
                        Path {path + 1} pan · {panLabel(mix.pan)}
                      </span>
                      <input
                        type="range"
                        aria-label={`Path ${path + 1} pan`}
                        min={-1}
                        max={1}
                        step={0.05}
                        value={mix.pan}
                        disabled={busy}
                        onChange={(event) =>
                          set({ pan: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        aria-label={`Invert path ${path + 1} polarity`}
                        checked={mix.invert}
                        disabled={busy}
                        onChange={(event) =>
                          set({ invert: event.target.checked })
                        }
                      />
                      Invert polarity
                    </label>
                  </div>
                );
              })()}
              {steps(branch)}
            </li>
          ))}
        </ol>
      </li>
    );
  }
  function steps(list: Route) {
    if (!list.length) return null;
    return (
      <ol className="offline-steps">
        {list.map((step, index) =>
          isSplit(step)
            ? split(step)
            : block(step, index === 0, index === list.length - 1),
        )}
      </ol>
    );
  }
  const close = () => (dirty ? setDiscarding(true) : onCancel());
  return (
    <AdjustmentDialog
      title="Edit without playing"
      onCancel={() => !busy && close()}
    >
      {blocked ? (
        <>
          <p role="alert">{blocked}</p>
          <div className="action-row">
            <Button onClick={onCancel}>Close</Button>
          </div>
        </>
      ) : !opened ? (
        <Loading label="Opening the preset" />
      ) : (
        <form
          className="control-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="field">
            <span>Name</span>
            <input
              className="h-11 w-full rounded-md border border-input bg-card px-3"
              value={name}
              maxLength={120}
              onChange={(event) => {
                setName(event.target.value);
                setDirty(true);
              }}
            />
          </label>
          <p className="caption">
            Nothing plays while you edit. Save keeps the changes
            {opened.mine ? '.' : ' as your own copy in Mine.'}
          </p>
          {opened.chains ? (
            <div aria-label="Scene chains" role="group">
              <p className="caption">
                Each scene of this preset is its own TONE3000 chain. Change each
                block&apos;s settings here; its routing and scenes are edited in
                Rig.
              </p>
              <ul className="offline-blocks">
                {opened.chains.map(({ instance, block }) => (
                  <li key={block.id} className="offline-block">
                    <div className="offline-row">
                      <strong>{block.name}</strong>
                      <span className="caption">
                        {chainEdits[instance]
                          ? 'Edited · not saved'
                          : 'TONE3000'}
                      </span>
                      <span className="flex-1" />
                      {block.stage ? (
                        <span className="caption">
                          Edited with its tone in Rig
                        </span>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          aria-label={`Edit ${block.name} settings`}
                          disabled={busy || !connected}
                          onClick={() => void tune(block)}
                        >
                          Edit settings…
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div aria-label="Routing" role="group">
              <div className="offline-row">
                <span className="caption">Input</span>
              </div>
              {route.length ? (
                steps(route)
              ) : (
                <p className="caption">Input straight to output.</p>
              )}
              <div className="offline-row">
                <span className="caption">Output</span>
                <span className="flex-1" />
                {addEffect()}
              </div>
            </div>
          )}
          {elsewhere && (
            <div role="alert" className="offline-elsewhere">
              <p>
                This preset was saved from another browser while you were
                editing. Saving here would be refused; your edits here are not
                saved.
              </p>
              <Button type="button" variant="outline" onClick={onRefresh}>
                Open the latest
              </Button>
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          {recovery === 'retry' && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void save()}
            >
              Try again
            </Button>
          )}
          {recovery === 'refresh' && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onRefresh}
            >
              Close and show the latest version
            </Button>
          )}
          <div className="action-row">
            <span className="flex-1" />
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!connected || busy || !dirty}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      )}
      {tuning && (
        <AdjustmentDialog
          title={`Settings · ${tuning.block.name}`}
          description="Saved as your own copy of this tone; the block then uses it. Nothing plays."
          className="offline-native-settings"
          onCancel={() => setTuning(null)}
        >
          <NativeEditor
            presets={[]}
            connected={connected}
            open={tuning.open}
            onSaved={(copy) =>
              void rigNativeSources()
                .then((tones) => {
                  const tone = tones.find(
                    (t) =>
                      t.source.kind === 'owned' && t.source.preset === copy.id,
                  );
                  if (!tone) throw new Error('The edited copy is not listed.');
                  const chain = opened?.chains?.find(
                    (c) => c.block.id === tuning.block.id,
                  );
                  if (chain) {
                    setChainEdits((edits) => ({
                      ...edits,
                      [chain.instance]: {
                        preset: tone.preset,
                        source: tone.source,
                      },
                    }));
                    setDirty(true);
                  } else
                    change((r) =>
                      routeReplaceNative(r, tuning.block.id, {
                        name: tuning.block.name,
                        preset: tone.preset,
                        source: tone.source,
                      }),
                    );
                  setTuning(null);
                })
                .catch((cause: unknown) =>
                  setError(friendlyError(cause, 'use the edited settings')),
                )
            }
          />
        </AdjustmentDialog>
      )}
      {discarding && (
        <AdjustmentDialog
          title="Discard your edits?"
          onCancel={() => setDiscarding(false)}
        >
          <p>The saved preset stays as it was.</p>
          <div className="action-row">
            <Button variant="outline" onClick={() => setDiscarding(false)}>
              Keep editing
            </Button>
            <Button onClick={onCancel}>Discard</Button>
          </div>
        </AdjustmentDialog>
      )}
    </AdjustmentDialog>
  );
}
