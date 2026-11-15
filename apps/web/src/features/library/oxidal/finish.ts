import {
  calibration,
  changeEffectPack,
  effectPacks,
  installedLv2,
  libraryCatalog,
  nativeDefaults,
  presetDetails,
  publishRig,
  rigLibrary,
  type Lv2Plugin,
} from '../../../api';
import type {
  NativeDefaultSettings,
  RigNativeSource,
} from '../../../generated/contract';
import { factoryMetadata, factoryMissingPacks } from '../../../factoryMetadata';
import {
  buildFactoryRecipe,
  factoryRoles,
  type FactoryRecipe,
  type FactoryRole,
} from '../../../factoryRecipes';
import { builtName } from './oxidalSounds.model';

/**
 * Finishing an Oxidal sound on this unit. The collection ships every preset
 * complete: chain, settings, scenes and levels. Effect packs and tones are the
 * player's to install; once they are present the preset is saved here without
 * a further step. Nothing third-party is downloaded without being asked.
 * @see docs/factory-collection.md
 */

/** What saving a finished preset needs from this unit. */
export type FinishContext = {
  plugins: Lv2Plugin[];
  profile: string;
  defaults?: NativeDefaultSettings;
  source: (role: FactoryRole) => RigNativeSource | undefined;
};

/** Install one effect pack and wait for its job. Rejects with the device's own
 * message when the pack is still not installed afterwards. */
export async function installPack(id: string): Promise<void> {
  let state = await changeEffectPack(id, 'install');
  for (let i = 0; i < 600 && state.job; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    state = await effectPacks();
  }
  const pack = state.packs.find((p) => p.id === id);
  if (state.job)
    throw new Error(
      `${pack?.name ?? id} is still installing. Check Settings in a minute.`,
    );
  if (!pack?.installed)
    throw new Error(
      state.message || `${pack?.name ?? id} could not be installed.`,
    );
}

/**
 * Measure the sounds that were just saved, so they play at the same loudness
 * as everything else on the unit. Uses Even out: silent, only new or changed
 * sounds, and whatever was playing is put back. Resolves to why it could not
 * be done, or an empty string. Never rejects: a sound is still playable.
 * @see docs/factory-collection.md
 */
export async function matchLevels(): Promise<string> {
  const skipped = (why: string) =>
    `Its level is not matched yet${why ? `: ${why}` : ''}. Use Even out in Levels.`;
  try {
    let state = await calibration('run');
    // A unit without Even out has nothing to match against.
    if (!state) return '';
    for (let i = 0; i < 1200 && state?.progress.running; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      state = await calibration();
    }
    if (!state) return '';
    if (state.progress.running) return skipped('measuring is still running');
    if (state.progress.error) return skipped(state.progress.error);
    if (state.progress.failed?.length)
      return skipped(state.progress.failed[0] ?? '');
    return '';
  } catch (cause) {
    return skipped(cause instanceof Error ? cause.message : '');
  }
}

/** Save one finished preset with its description. Resolves to its revision. */
export async function saveRecipe(
  recipe: FactoryRecipe,
  context: FinishContext,
  signal?: AbortSignal,
): Promise<string> {
  const document = await publishRig(
    buildFactoryRecipe(
      recipe,
      context.plugins,
      Object.fromEntries(
        factoryRoles(recipe).flatMap((role) => {
          const source = context.source(role);
          return source ? [[role, source]] : [];
        }),
      ),
      context.profile,
      undefined,
      context.defaults,
    ),
    signal,
  );
  const details = await presetDetails();
  await presetDetails({
    expected_revision: details.revision,
    entry_kind: 'rig',
    id: document.revision,
    description: recipe.description,
    categories: recipe.categories,
    metadata: factoryMetadata(recipe),
  });
  return document.revision;
}

/** Names of the Oxidal sounds already saved on this unit. */
async function savedNames(): Promise<Set<string>> {
  const catalog = await libraryCatalog();
  return new Set(
    catalog.items
      .filter(
        (i) =>
          i.kind === 'rig' && i.origin === 'oxidal_example' && !i.superseded,
      )
      .map((i) => i.source_name),
  );
}

/** What a set of effects-only sounds still needs on this unit. */
export async function effectsOnlyNeeds(recipes: FactoryRecipe[]): Promise<{
  packs: { id: string; name: string; sizeMib: number }[];
  unsaved: FactoryRecipe[];
  blocked: string;
}> {
  const saved = await savedNames();
  const unsaved = recipes.filter(
    (r) => !saved.has(builtName(r)) && !saved.has(r.name),
  );
  // Nothing to save: the unit's effects need not be read at all.
  if (!unsaved.length) return { packs: [], unsaved, blocked: '' };
  const [plugins, state] = await Promise.all([
    installedLv2(48000),
    effectPacks().catch(() => null),
  ]);
  const ids = [
    ...new Set(unsaved.flatMap((r) => factoryMissingPacks(r, plugins))),
  ];
  const packs = ids.map((id) => {
    const pack = state?.packs.find((p) => p.id === id);
    return { id, name: pack?.name ?? id, sizeMib: pack?.size_mib ?? 0 };
  });
  const blocked = !ids.length
    ? ''
    : !state?.available
      ? 'Effect packs cannot be installed from this device right now.'
      : state.audio_running
        ? 'Stop audio before installing effect packs.'
        : !state.storage_writable
          ? 'Protect is on, so packs cannot be installed. Turn Protect off in Settings first.'
          : '';
  return { packs, unsaved, blocked };
}

/** Install the packs a set of effects-only sounds needs, then save each one.
 * Sounds already saved are left alone. Resolves to how many were saved. */
export async function finishEffectsOnly(
  recipes: FactoryRecipe[],
  progress: (label: string) => void,
): Promise<number> {
  const needs = await effectsOnlyNeeds(recipes);
  if (needs.blocked) throw new Error(needs.blocked);
  for (const pack of needs.packs) {
    progress(`Installing ${pack.name}…`);
    await installPack(pack.id);
  }
  if (!needs.unsaved.length) return 0;
  const [plugins, library, defaults] = await Promise.all([
    installedLv2(48000),
    rigLibrary(),
    nativeDefaults().catch(() => null),
  ]);
  const context: FinishContext = {
    plugins,
    profile: library.native_profile,
    defaults: defaults?.settings,
    source: () => undefined,
  };
  let saved = 0;
  for (const recipe of needs.unsaved) {
    progress(`Saving ${recipe.name}…`);
    await saveRecipe(recipe, context);
    saved++;
  }
  if (saved) {
    progress('Matching levels…');
    await matchLevels();
  }
  return saved;
}
