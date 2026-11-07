import { StepProgress } from './components/ui/steps';
import { Loading } from './components/ui/loading';
import { useEffect, useRef, useState } from 'react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { friendlyError } from './lib/friendlyError';
import {
  setReturnTarget,
  useScrollMemory,
  useSessionState,
} from './lib/sessionState';
import { ModelPicker } from './ModelPicker';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import { WarningCircle } from '@phosphor-icons/react';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { Button } from './components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { Badge } from './components/ui/badge';
import { DialogFooter } from './components/ui/dialog';
import {
  installedLv2,
  nativeDefaults,
  rigNativeSources,
  rigLibrary,
  publishRig,
  presetDetails,
  type Lv2Plugin,
  voiceCaptures,
} from './api';
import type {
  NativeDefaultSettings,
  RigNativeSource,
} from './generated/contract';
import {
  factoryRoles,
  factoryMissingPlugins,
  factoryTopologySummary,
  buildFactoryRecipe,
  type FactoryRole,
  type FactoryRecipe,
} from './factoryRecipes';
import { allFactoryRecipes as factoryRecipes } from './factoryCatalog';
import { factoryVoices, isFactoryVoice } from './factoryVoices';
import { VoiceSlot } from './VoiceSlot';
import { playScenes } from './presetChoices';

const factoryFamilies: Record<string, string> = {
  A: 'Space & ambience',
  B: 'Bass',
  C: 'Clean & studio',
  H: 'Heavy',
  K: 'Rock & drive',
  P: 'Parallel routing',
  R: 'Roots & rhythm',
  S: 'Synth & pitch',
  X: 'Experimental',
};

function groupFactoryRecipes(recipes: FactoryRecipe[]) {
  const groups = new Map<string, { key: string; recipes: FactoryRecipe[] }>();
  for (const recipe of recipes) {
    const key = recipe.era ?? recipe.id[0] ?? 'other';
    const label = recipe.era
      ? recipe.era === 'Modern'
        ? 'Modern sounds'
        : `${recipe.era} sounds`
      : (factoryFamilies[key] ?? 'Other');
    const group = groups.get(label) ?? { key, recipes: [] };
    group.recipes.push(recipe);
    groups.set(label, group);
  }
  return [...groups.entries()].map(([label, group]) => ({
    label,
    ...group,
  }));
}

/** Local assembly never stops audio or downloads captures implicitly.
 * @see docs/factory-collection.md */
export function FactoryCollection({
  connected,
  onChanged,
  onOpenRig,
}: {
  connected: boolean;
  onChanged: () => void;
  onOpenRig?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        disabled={!connected}
        onClick={() => setOpen(true)}
      >
        Explore Oxidal sounds
      </Button>
      {open && (
        <CollectionDialog
          onClose={() => setOpen(false)}
          onChanged={onChanged}
          onOpenRig={onOpenRig}
        />
      )}
    </>
  );
}
/** Songbook sounds not built yet, listed as rows under the Oxidal examples. Tapping
 * one opens it in Explore for its one-time download and build. */
export function UnbuiltSounds({
  connected,
  query,
  refresh,
  onChanged,
  onOpenRig,
}: {
  connected: boolean;
  query: string;
  refresh: number;
  onChanged: () => void;
  onOpenRig?: () => void;
}) {
  const [builtNames, setBuiltNames] = useState<Set<string> | null>(null);
  const [onDevice, setOnDevice] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<FactoryRecipe | null>(null);
  const [count, setCount] = useState(12);
  useEffect(() => {
    let alive = true;
    (async () => {
      const names = new Set<string>();
      let after: string | undefined;
      for (let page = 0; page < 20; page++) {
        const result = await rigLibrary(after);
        for (const preset of result.presets) names.add(preset.name);
        if (!result.next) break;
        after = result.next;
      }
      const captures = await voiceCaptures().catch(() => []);
      if (!alive) return;
      setBuiltNames(names);
      setOnDevice(new Set(captures.map((c) => `${c.tone_id}:${c.model_id}`)));
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [refresh]);
  if (!builtNames) return null;
  const text = query.trim().toLowerCase();
  const needs = (recipe: FactoryRecipe) =>
    factoryRoles(recipe).some(
      (role) =>
        isFactoryVoice(role) &&
        !factoryVoices[role].captures.some((c) =>
          onDevice.has(`${c.tone}:${c.model}`),
        ),
    );
  const rows = factoryRecipes
    .filter(
      (recipe) =>
        !builtNames.has(recipe.era ? recipe.name : `Oxidal · ${recipe.name}`) &&
        [recipe.name, ...recipe.categories, recipe.description]
          .join(' ')
          .toLowerCase()
          .includes(text),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  if (!rows.length) return null;
  return (
    <section className="library-scenes" aria-label="More Oxidal sounds">
      <p className="caption">
        More sounds, not on your device yet. Tap one to download what it needs
        and build it.
      </p>
      <ul className="preset-library">
        {rows.slice(0, count).map((recipe) => (
          <li key={recipe.id} className="library-row">
            <button
              type="button"
              className="library-load"
              disabled={!connected}
              aria-label={`Get ${recipe.name}`}
              onClick={() => setOpen(recipe)}
            >
              <span className="library-name">{recipe.name}</span>
              <span className="library-meta">
                {recipe.categories.join(' · ')} ·{' '}
                {needs(recipe) ? 'Needs download' : 'Ready to build'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {rows.length > count && (
        <Button variant="outline" onClick={() => setCount((n) => n + 12)}>
          Show {Math.min(12, rows.length - count)} more
        </Button>
      )}
      {open && (
        <CollectionDialog
          initialRecipe={open}
          onClose={() => setOpen(null)}
          onChanged={onChanged}
          onOpenRig={onOpenRig}
        />
      )}
    </section>
  );
}
/** Discover as a page (7.5): the same sounds as the dialog, inline, with one
 * Play action for any sound whose captures and effects are installed. */
export function DiscoverPage({
  connected,
  onChanged,
  onOpenRig,
}: {
  connected: boolean;
  onChanged: () => void;
  onOpenRig?: () => void;
}) {
  const [source, setSource] = useSessionState<'oxidal' | 'tone3000'>(
    'discover-source',
    'oxidal',
  );
  useScrollMemory(`discover-${source}`, true);
  return (
    <>
      <ToggleGroup
        type="single"
        value={source}
        aria-label="Discover source"
        className="discover-sources"
        onValueChange={(value) => {
          if (value === 'oxidal' || value === 'tone3000') setSource(value);
        }}
      >
        <ToggleGroupItem value="oxidal">Oxidal recipes</ToggleGroupItem>
        <ToggleGroupItem value="tone3000">TONE3000</ToggleGroupItem>
      </ToggleGroup>
      {source === 'oxidal' ? (
        <CollectionDialog
          inline
          connected={connected}
          onClose={() => {}}
          onChanged={onChanged}
          onOpenRig={onOpenRig}
        />
      ) : (
        <>
          <p className="caption">
            NAM captures and cabinet IRs from TONE3000, with each creator shown.
            Downloads go to Sounds and never change what is playing.
          </p>
          <ModelPicker
            inline
            name="Sounds"
            intent="download"
            onClose={() => {}}
            onAudition={async () => onChanged()}
            onSignIn={() => {
              setReturnTarget({ hash: '#library/discover', label: 'Discover' });
              window.location.hash = 'settings/accounts';
            }}
          />
        </>
      )}
    </>
  );
}
function CollectionDialog({
  onClose,
  onChanged,
  onOpenRig,
  initialRecipe,
  inline = false,
  connected = true,
}: {
  onClose: () => void;
  onChanged: () => void;
  onOpenRig?: () => void;
  initialRecipe?: FactoryRecipe;
  inline?: boolean;
  connected?: boolean;
}) {
  const [built, setBuilt] = useState<{ revision: string; name: string } | null>(
    null,
  );
  const [plugins, setPlugins] = useState<Lv2Plugin[]>([]);
  const [sources, setSources] = useState<RigNativeSource[]>([]);
  const [profile, setProfile] = useState('');
  const [defaults, setDefaults] = useState<NativeDefaultSettings | null>(null);
  const [selected, setSelected] = useState<FactoryRecipe | null>(
    initialRecipe ?? null,
  );
  const [bindings, setBindings] = useState<
    Partial<Record<FactoryRole, RigNativeSource>>
  >({});
  const [error, setError] = useState('');
  // Captures already on this device, by `tone:model`.
  const [downloaded, setDownloaded] = useState<Record<string, RigNativeSource>>(
    {},
  );
  const [query, setQuery] = useSessionState(
    inline ? 'discover-query' : null,
    '',
  );
  const visibleRecipes = factoryRecipes
    .filter((recipe) =>
      [recipe.name, ...recipe.categories, recipe.description]
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const groupedRecipes = groupFactoryRecipes(visibleRecipes);
  /** The saved source for a role: the player's choice, else a downloaded capture. */
  const sourceFor = (role: FactoryRole) => {
    const chosen = bindings[role];
    if (chosen) return chosen;
    if (!isFactoryVoice(role)) return undefined;
    for (const capture of factoryVoices[role].captures) {
      const found = downloaded[`${capture.tone}:${capture.model}`];
      if (found) return found;
    }
    return undefined;
  };
  const missingRoles = (recipe: FactoryRecipe) =>
    factoryRoles(recipe).filter((role) => !sourceFor(role));
  function voiceReady(role: FactoryRole, source: RigNativeSource) {
    setSources((list) =>
      list.some((s) => s.preset.sha256 === source.preset.sha256)
        ? list
        : [...list, source],
    );
    setBindings((b) => ({ ...b, [role]: source }));
  }
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{
    label: string;
    steps: string[];
    current: number;
  } | null>(null);
  // Cancel stops before the next step; the running one finishes (7.21).
  const cancelled = useRef(false);
  // The build request in flight, so Cancel can stop it (7.21).
  const building = useRef<AbortController | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [saved, setSaved] = useState<Record<string, string>>({});
  // Built examples already in Library, by name: Play needs no rebuild.
  const [library, setLibrary] = useState<Record<string, string>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [ids] = useState(() =>
    Object.fromEntries(factoryRecipes.map((r) => [r.id, crypto.randomUUID()])),
  );
  useEffect(() => {
    let alive = true;
    Promise.all([
      installedLv2(48000),
      rigNativeSources(),
      rigLibrary(),
      nativeDefaults(),
      voiceCaptures().catch(() => []),
    ])
      .then(async ([p, s, l, d, captures]) => {
        const names: Record<string, string> = {};
        let page = l;
        for (let i = 0; i < 20; i++) {
          for (const preset of page.presets)
            names[preset.name] ??= preset.revision;
          if (!page.next) break;
          page = await rigLibrary(page.next);
        }
        if (alive) {
          setLibrary(names);
          setPlugins(p);
          setSources(s);
          setDownloaded(
            Object.fromEntries(
              captures.map((c) => [`${c.tone_id}:${c.model_id}`, c.source]),
            ),
          );
          setProfile(l.native_profile);
          setDefaults(d.settings);
        }
      })
      .catch((e) => {
        if (alive) setError(friendlyError(e, 'read the collection'));
      });
    return () => {
      alive = false;
    };
  }, []);
  async function build(recipe: FactoryRecipe, then: string[] = []) {
    setBusy(true);
    setError('');
    if (!then.length) {
      cancelled.current = false;
      setCancelling(false);
    }
    const steps = ['Building the preset', 'Saving its description', ...then];
    setProgress({ label: builtName(recipe), steps, current: 0 });
    const controller = new AbortController();
    building.current = controller;
    try {
      const document = await publishRig(
        buildFactoryRecipe(
          recipe,
          plugins,
          Object.fromEntries(
            factoryRoles(recipe).flatMap((role) => {
              const source = sourceFor(role);
              return source ? [[role, source]] : [];
            }),
          ),
          profile,
          ids[recipe.id],
          defaults ?? undefined,
        ),
        controller.signal,
      );
      if (cancelled.current) {
        setSaved((s) => ({ ...s, [recipe.id]: document.revision }));
        onChanged();
        setError(
          `Stopped. ${builtName(recipe)} is saved in Library without its description.`,
        );
        setProgress(null);
        return undefined;
      }
      setProgress({ label: builtName(recipe), steps, current: 1 });
      const details = await presetDetails();
      await presetDetails({
        expected_revision: details.revision,
        entry_kind: 'rig',
        id: document.revision,
        description: recipe.description,
        categories: recipe.categories,
      });
      setSaved((s) => ({ ...s, [recipe.id]: document.revision }));
      onChanged();
      setBuilt({
        revision: document.revision,
        name: recipe.era ? recipe.name : `Oxidal · ${recipe.name}`,
      });
      setSelected(null);
      return document.revision;
    } catch (e) {
      if (controller.signal.aborted) {
        // The device may have finished saving before the stop reached it.
        onChanged();
        setError(
          `Stopped. If the device had already saved ${builtName(recipe)}, it is in Library.`,
        );
      } else setError(friendlyError(e, `build ${recipe.name}`));
      setProgress(null);
    } finally {
      if (building.current === controller) building.current = null;
      setBusy(false);
      if (!then.length) setProgress(null);
    }
    return undefined;
  }
  const builtName = (recipe: FactoryRecipe) =>
    recipe.era ? recipe.name : `Oxidal · ${recipe.name}`;
  const builtRevision = (recipe: FactoryRecipe) =>
    saved[recipe.id] ?? library[builtName(recipe)];
  const playable = (recipe: FactoryRecipe) =>
    !!builtRevision(recipe) ||
    (!!profile &&
      missingRoles(recipe).length === 0 &&
      factoryMissingPlugins(recipe, plugins).length === 0);
  /** One tap: reuse the built example, or build it from installed sounds, then play. */
  async function play(recipe: FactoryRecipe) {
    if (busy) return;
    setPlayingId(recipe.id);
    setError('');
    cancelled.current = false;
    setCancelling(false);
    try {
      const reused = builtRevision(recipe);
      const revision = reused ?? (await build(recipe, ['Starting audio']));
      if (!revision) return;
      if (cancelled.current) {
        // The built notice stays, so Play is one tap away.
        setError('Stopped before starting audio.');
        return;
      }
      setBusy(true);
      setProgress(
        reused
          ? { label: builtName(recipe), steps: ['Starting audio'], current: 0 }
          : {
              label: builtName(recipe),
              steps: [
                'Building the preset',
                'Saving its description',
                'Starting audio',
              ],
              current: 2,
            },
      );
      await playScenes(revision);
      setBuilt(null);
      onOpenRig?.();
      if (!inline) onClose();
    } catch (cause) {
      setError(friendlyError(cause, `play ${recipe.name}`));
    } finally {
      setBusy(false);
      setPlayingId(null);
      setProgress(null);
    }
  }
  const body = (
    <div className="control-stack">
      {progress && (
        <StepProgress
          {...progress}
          cancelling={cancelling}
          onCancel={() => {
            cancelled.current = true;
            setCancelling(true);
            building.current?.abort();
          }}
        />
      )}
      {built ? (
        <>
          <p>
            <strong>{built.name}</strong> is in your library. Playing it
            replaces the sound you are hearing now.
          </p>
          {error && <p role="alert">{error}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setBuilt(null)}
            >
              Done
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await playScenes(built.revision);
                  onOpenRig?.();
                  onClose();
                } catch (cause) {
                  setError(friendlyError(cause, 'build this preset'));
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Starting…' : 'Play now'}
            </Button>
          </DialogFooter>
        </>
      ) : selected ? (
        <>
          <p>{selected.description}</p>
          <p className="caption">{factoryTopologySummary(selected)}</p>
          {selected.scenes.length > 0 && (
            <p className="caption">
              Scenes: {selected.scenes.map((s) => s.name).join(' · ')}
            </p>
          )}
          {factoryRoles(selected).map((role) => (
            <div key={role} className="space-y-2">
              {isFactoryVoice(role) && !sourceFor(role) && (
                <VoiceSlot
                  voice={role}
                  disabled={busy}
                  onReady={(source) => voiceReady(role, source)}
                />
              )}
              <label className="field">
                <span>
                  {isFactoryVoice(role)
                    ? factoryVoices[role].character
                    : role[0]!.toUpperCase() + role.slice(1)}{' '}
                  NAM voice
                  {isFactoryVoice(role) && !sourceFor(role)
                    ? ' · or use a saved preset'
                    : ''}
                </span>
                <Select
                  disabled={busy}
                  value={sourceFor(role)?.preset.sha256}
                  onValueChange={(value) =>
                    setBindings((b) => ({
                      ...b,
                      [role]: sources.find((s) => s.preset.sha256 === value),
                    }))
                  }
                >
                  <SelectTrigger aria-label={`${role} NAM voice`}>
                    <SelectValue placeholder="Choose a saved NAM preset…" />
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((s) => (
                      <SelectItem key={s.preset.sha256} value={s.preset.sha256}>
                        {s.preset.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          ))}
          {factoryRoles(selected).length > 0 && (
            <p className="caption">
              Use a saved amp-and-cab preset from your library. Its complete
              chain becomes this voice. Import or create one first if none is
              listed.
            </p>
          )}
          <p className="caption">
            Building adds an Oxidal example to Library. Your playing sound stays
            as it is. Its first edit makes your own copy. Use Even out in
            Library to match levels across your chosen captures.
          </p>
          {factoryMissingPlugins(selected, plugins).length > 0 && (
            <p role="status">
              Install these in Settings → Effects first:{' '}
              {factoryMissingPlugins(selected, plugins).join(', ')}.
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setError('');
              }}
            >
              Back
            </Button>
            <Button
              disabled={
                busy ||
                !profile ||
                factoryMissingPlugins(selected, plugins).length > 0 ||
                missingRoles(selected).length > 0
              }
              onClick={() => void build(selected)}
            >
              {busy ? 'Building…' : 'Build preset'}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <>
          <p className="caption">
            {factoryRecipes.length} starting points: scene instruments and
            complex serial chains. Effect-only recipes work without NAM
            captures; others use voices you choose.
          </p>
          {!profile && !error && <Loading label="Reading installed effects…" />}
          {error && (
            <Alert variant="destructive" role="alert">
              <WarningCircle aria-hidden="true" />
              <AlertTitle>Factory assembly unavailable</AlertTitle>
              <AlertDescription className="break-words text-current">
                Oxidal could not read the installed effects and saved NAM
                sources. You can still browse and search these sounds, but
                building is disabled. {error}
              </AlertDescription>
            </Alert>
          )}
          <label className="flex">
            <span className="sr-only">Find a factory sound</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a sound or genre…"
              className="h-11 w-full min-w-0 rounded-md border border-input bg-card px-3"
            />
          </label>
          {visibleRecipes.length === 0 && (
            <p role="status" className="py-4 text-muted-foreground">
              No matching sounds. Try another name or genre.
            </p>
          )}
          <div className="space-y-5">
            {groupedRecipes.map((group) => (
              <section
                key={group.label}
                aria-labelledby={`factory-family-${group.key}`}
              >
                <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
                  <h3
                    id={`factory-family-${group.key}`}
                    className="m-0 text-sm"
                  >
                    {group.label}
                  </h3>
                  <Badge>
                    {group.recipes.length}{' '}
                    {group.recipes.length === 1 ? 'sound' : 'sounds'}
                  </Badge>
                </div>
                <ul className="divide-y divide-border">
                  {group.recipes.map((recipe) => (
                    <li
                      key={recipe.id}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div>
                        <strong>{recipe.name}</strong>
                        <p className="caption">
                          {recipe.categories.join(' · ')}
                        </p>
                        <p className="caption">
                          {factoryTopologySummary(recipe)}
                        </p>
                        {missingRoles(recipe).some(isFactoryVoice) && (
                          <Badge>Needs download</Badge>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {playable(recipe) ? (
                          <Button
                            disabled={!connected || busy || !!playingId}
                            aria-label={`Play ${recipe.name}`}
                            onClick={() => void play(recipe)}
                          >
                            {playingId === recipe.id ? 'Starting…' : 'Play'}
                          </Button>
                        ) : (
                          <Button
                            disabled={!profile}
                            aria-label={`Install sounds for ${recipe.name}`}
                            onClick={() => {
                              setSelected(recipe);
                              setError('');
                            }}
                          >
                            Install sounds…
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          disabled={!profile}
                          aria-label={`Details: ${recipe.name}`}
                          onClick={() => {
                            setSelected(recipe);
                            setError('');
                          }}
                        >
                          Details
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
      {selected && error && <p role="alert">{error}</p>}
      {!selected && !built && error && profile && <p role="alert">{error}</p>}
    </div>
  );
  if (inline)
    return (
      <section className="discover-page" aria-label="Discover">
        {(selected || built) && (
          <h2 className="m-0 text-lg">{built ? 'Built' : selected?.name}</h2>
        )}
        {body}
      </section>
    );
  return (
    <AdjustmentDialog
      title={built ? 'Built' : (selected?.name ?? 'Oxidal sounds')}
      onCancel={() => {
        if (!busy) {
          if (built) setBuilt(null);
          else if (selected) setSelected(null);
          else onClose();
        }
      }}
    >
      {body}
    </AdjustmentDialog>
  );
}
