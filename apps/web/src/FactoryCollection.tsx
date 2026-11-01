import { useEffect, useState } from 'react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './components/ui/select';
import { Badge } from './components/ui/badge';
import {
  installedLv2,
  rigNativeSources,
  rigLibrary,
  publishRig,
  presetDetails,
  type Lv2Plugin,
} from './api';
import type { RigNativeSource } from './generated/contract';
import {
  factoryRecipes,
  factoryRoles,
  factoryMissingPlugins,
  factoryTopologySummary,
  buildFactoryRecipe,
  type FactoryRole,
  type FactoryRecipe,
} from './factoryRecipes';

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
  const [selected, setSelected] = useState<FactoryRecipe | null>(null);
  const [bindings, setBindings] = useState<
    Partial<Record<FactoryRole, RigNativeSource>>
  >({});
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const visibleRecipes = factoryRecipes
    .filter((recipe) =>
      [recipe.name, ...recipe.categories, recipe.description]
        .join(' ')
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [ids] = useState(() =>
    Object.fromEntries(factoryRecipes.map((r) => [r.id, crypto.randomUUID()])),
  );
  useEffect(() => {
    let alive = true;
    Promise.all([installedLv2(48000), rigNativeSources(), rigLibrary()])
      .then(([p, s, l]) => {
        if (alive) {
          setPlugins(p);
          setSources(s);
          setProfile(l.native_profile);
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
        buildFactoryRecipe(recipe, plugins, bindings, profile, ids[recipe.id]),
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
              <label key={role} className="field">
                <span>{role[0]!.toUpperCase() + role.slice(1)} NAM voice</span>
                <Select
                  disabled={busy}
                  value={bindings[role]?.preset.sha256}
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
            <div className="dialog-actions">
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
                  factoryRoles(selected).some((r) => !bindings[r])
                }
                onClick={() => void build(selected)}
              >
                {busy ? 'Building…' : 'Build preset'}
              </Button>
            </div>
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
            <ul className="divide-y divide-border">
              {visibleRecipes.map((recipe) => (
                <li
                  key={recipe.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <strong>{recipe.name}</strong>
                    <p className="caption">{recipe.categories.join(' · ')}</p>
                    <p className="caption">{factoryTopologySummary(recipe)}</p>
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
                      Explore<span className="sr-only"> {recipe.name}</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </AdjustmentDialog>
  );
}
