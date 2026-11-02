import { useEffect, useState } from 'react';
import { AdjustmentDialog } from './AdjustmentDialog';
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

const factoryFamilies: Record<string, string> = {
  A: 'Space & ambience',
  B: 'Bass',
  C: 'Clean & studio',
  H: 'Heavy',
  K: 'Rock & drive',
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
}: {
  connected: boolean;
  onChanged: () => void;
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
        />
      )}
    </>
  );
}
function CollectionDialog({
  onClose,
  onChanged,
}: {
  onClose: () => void;
  onChanged: () => void;
}) {
  const [plugins, setPlugins] = useState<Lv2Plugin[]>([]);
  const [sources, setSources] = useState<RigNativeSource[]>([]);
  const [profile, setProfile] = useState('');
  const [defaults, setDefaults] = useState<NativeDefaultSettings | null>(null);
  const [selected, setSelected] = useState<FactoryRecipe | null>(null);
  const [bindings, setBindings] = useState<
    Partial<Record<FactoryRole, RigNativeSource>>
  >({});
  const [error, setError] = useState('');
  // Captures already on this device, by `tone:model`.
  const [downloaded, setDownloaded] = useState<Record<string, RigNativeSource>>(
    {},
  );
  const [query, setQuery] = useState('');
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
  const [saved, setSaved] = useState<Record<string, string>>({});
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
      .then(([p, s, l, d, captures]) => {
        if (alive) {
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
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  async function build(recipe: FactoryRecipe) {
    setBusy(true);
    setError('');
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
      );
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
      setSelected(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdjustmentDialog
      title={selected?.name ?? 'Oxidal sounds'}
      onCancel={() => {
        if (!busy) {
          if (selected) setSelected(null);
          else onClose();
        }
      }}
    >
      <div className="control-stack">
        {selected ? (
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
                        <SelectItem
                          key={s.preset.sha256}
                          value={s.preset.sha256}
                        >
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
              Building adds an Oxidal example to Library. Your playing sound
              stays as it is. Its first edit makes your own copy. Use Even out
              in Library to match levels across your chosen captures.
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
            {!profile && !error && (
              <p role="status">Reading installed effects…</p>
            )}
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
                        {saved[recipe.id] ? (
                          <Badge>Built</Badge>
                        ) : (
                          <Button
                            variant="outline"
                            disabled={!profile}
                            aria-label={`Explore ${recipe.name}`}
                            onClick={() => {
                              setSelected(recipe);
                              setError('');
                            }}
                          >
                            Explore
                            <span className="sr-only"> {recipe.name}</span>
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </>
        )}
        {selected && error && <p role="alert">{error}</p>}
      </div>
    </AdjustmentDialog>
  );
}
