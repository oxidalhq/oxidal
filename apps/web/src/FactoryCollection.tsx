import { useEffect, useState } from 'react';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
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
            <p className="caption">
              Scenes: {selected.scenes.map((s) => s.name).join(' · ')}
            </p>
            {factoryRoles(selected).map((role) => (
              <label key={role} className="field">
                <span>{role[0]!.toUpperCase() + role.slice(1)} NAM voice</span>
                <select
                  disabled={busy}
                  value={bindings[role]?.preset.sha256 ?? ''}
                  onChange={(e) =>
                    setBindings((b) => ({
                      ...b,
                      [role]: sources.find(
                        (s) => s.preset.sha256 === e.target.value,
                      ),
                    }))
                  }
                >
                  <option value="">Choose a saved NAM preset…</option>
                  {sources.map((s) => (
                    <option key={s.preset.sha256} value={s.preset.sha256}>
                      {s.preset.name}
                    </option>
                  ))}
                </select>
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
              Twelve starting points with four scenes each. Ambient, Hold and
              synth recipes use effects only; the others use NAM voices you
              choose.
            </p>
            {!profile && !error && (
              <p role="status">Reading installed effects…</p>
            )}
            <ul className="divide-y divide-border">
              {factoryRecipes.map((recipe) => (
                <li
                  key={recipe.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <strong>{recipe.name}</strong>
                    <p className="caption">{recipe.categories.join(' · ')}</p>
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
