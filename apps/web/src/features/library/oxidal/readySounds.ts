import {
  effectPacks,
  installedLv2,
  libraryCatalog,
  nativeDefaults,
  rigAudioState,
  rigLibrary,
  voiceCaptures,
} from '../../../api';
import { allFactoryRecipes } from '../../../factoryCatalog';
import type { FactoryRecipe, FactoryRole } from '../../../factoryRecipes';
import { factoryVoices, isFactoryVoice } from '../../../factoryVoices';
import type { RigNativeSource } from '../../../generated/contract';
import { saveRecipe } from './finish';
import {
  builtName,
  cardState,
  installedKey,
  soundItems,
  type UnitFacts,
} from './oxidalSounds.model';

/**
 * Oxidal sounds that have everything they need on this unit but are not saved
 * yet, so the rig's preset picker can offer them beside saved presets and
 * save one when it is chosen, without a trip to Library.
 * @see docs/factory-collection.md
 */

/** Names of the Oxidal sounds saved on this unit. */
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

/** `tone:model` → saved source for every capture on this unit. */
async function captureSources(): Promise<Record<string, RigNativeSource>> {
  const caps = await voiceCaptures().catch(() => null);
  return Object.fromEntries(
    (caps?.captures ?? []).map((c) => [`${c.tone_id}:${c.model_id}`, c.source]),
  );
}

/** The downloaded capture for a recipe role, as Library picks it. */
function sourceIn(
  role: FactoryRole,
  captures: Record<string, RigNativeSource>,
): RigNativeSource | undefined {
  if (!isFactoryVoice(role)) return undefined;
  for (const c of factoryVoices[role].captures) {
    const key = installedKey(Object.keys(captures), c);
    if (key) return captures[key];
  }
  return undefined;
}

/** Unsaved Oxidal sounds that need nothing more on this unit, in catalog order. */
export async function unsavedReadySounds(): Promise<FactoryRecipe[]> {
  const [saved, plugins, captures, packs, audio] = await Promise.all([
    savedNames(),
    installedLv2(48000),
    captureSources(),
    effectPacks().catch(() => null),
    rigAudioState().catch(() => null),
  ]);
  const facts: UnitFacts = {
    ready: true,
    plugins,
    captures: new Set(Object.keys(captures)),
    bindings: {},
    signedIn: null,
    protectOn: false,
    audioRunning: false,
    frames: audio?.configured?.stream.input.period_frames ?? null,
    installedPacks: packs
      ? new Set(packs.packs.filter((p) => p.installed).map((p) => p.id))
      : null,
  };
  return soundItems(allFactoryRecipes, [], [])
    .filter(
      (item) =>
        item.recipe &&
        !saved.has(builtName(item.recipe)) &&
        !saved.has(item.recipe.name) &&
        cardState(item, facts).kind === 'build',
    )
    .flatMap((item) => (item.recipe ? [item.recipe] : []));
}

/** Save one ready Oxidal sound on this unit. Resolves to its revision. */
export async function saveReadySound(recipe: FactoryRecipe): Promise<string> {
  const [plugins, library, defaults, captures] = await Promise.all([
    installedLv2(48000),
    rigLibrary(),
    nativeDefaults().catch(() => null),
    captureSources(),
  ]);
  return saveRecipe(recipe, {
    plugins,
    profile: library.native_profile,
    defaults: defaults?.settings,
    source: (role) => sourceIn(role, captures),
  });
}
