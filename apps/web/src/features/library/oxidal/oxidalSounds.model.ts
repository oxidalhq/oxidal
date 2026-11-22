import type { Lv2Plugin } from '../../../api';
import { BUFFER_SIZES } from '../../../bufferTiming';
import {
  type FactoryEngine,
  factoryEngineLabels,
  factoryGenres,
  factoryMetadata,
  factoryMissingPacks,
  factoryPackFor,
  factoryPluginNames,
} from '../../../factoryMetadata';
import {
  factoryMissingPlugins,
  type FactoryRecipe,
  type FactoryRole,
  factoryRoles,
  recipeEffects,
} from '../../../factoryRecipes';
import {
  factoryVoices,
  isFactoryVoice,
  primaryCapture,
  type VoiceCapture,
} from '../../../factoryVoices';
import type {
  RecipeMetadata,
  RigNativeSource,
} from '../../../generated/contract';

/**
 * Pure model of the Oxidal sounds browser: one item per example, the state of
 * its card, the capture budget, and filtering, grouping and the summary line.
 * @see docs/factory-collection.md
 */

/**
 * NAM instances one preset may keep loaded at the reference buffer. Measured
 * on a Pi 5 at 96 × 3: 5 A2 Full and 7 A2 Lite instances ran cleanly, so the
 * budget keeps about 60 % of that for effects and jitter (docs/capacity.md).
 * Other buffer sizes scale the budget in proportion to the frames, rounded
 * down.
 */
export const CAPTURE_BUDGET = { frames: 96, lite: 4, full: 3 } as const;
/** Buffers offered as a fix; larger ones add too much delay to play live. */
const LARGEST_FIX_FRAMES = 512;
/** Rough LV2 cost in percent of one audio buffer per block, shown in Details
 * as "about N %". PROVISIONAL, a planning figure rather than a measurement. */
const LV2_BLOCK_LOAD_PERCENT = 1.5;

export const complexityLabels = {
  simple: 'Simple',
  layered: 'Layered',
  complex: 'Complex',
} as const;

/** What filters and cards read, from a recipe or from a built preset. */
type SoundMeta = {
  genres: string[];
  techniques: string[];
  engine: string;
  complexity: string;
  inspiration: string;
  performance: string;
  requiredPacks: string[];
  namInstances: number;
  blockCount: number;
};

export type BuiltEntry = { name: string; revision: string; scenes: string[] };

/** One row of the browser: a catalog recipe, or an installed example that has
 * no recipe in this release. */
export type SoundItem = {
  key: string;
  name: string;
  description: string;
  meta: SoundMeta;
  sceneNames: string[];
  recipe?: FactoryRecipe;
  built?: BuiltEntry;
};

export const builtName = (recipe: FactoryRecipe) =>
  recipe.era ? recipe.name : `Oxidal · ${recipe.name}`;

export const engineLabel = (engine: string) =>
  (factoryEngineLabels as Record<string, string>)[engine] ?? engine;
export const complexityLabel = (complexity: string) =>
  (complexityLabels as Record<string, string>)[complexity] ?? complexity;

function recipeMeta(recipe: FactoryRecipe): SoundMeta {
  const m = factoryMetadata(recipe);
  return {
    genres: m.genres,
    techniques: m.techniques,
    engine: m.engine,
    complexity: m.complexity,
    inspiration: m.inspiration,
    performance: m.performance,
    requiredPacks: m.required_packs,
    namInstances: m.nam_instances,
    blockCount: m.block_count,
  };
}

function detailsMeta(m: RecipeMetadata): SoundMeta {
  return {
    genres: m.genres,
    techniques: m.techniques ?? [],
    engine: m.engine,
    complexity: m.complexity,
    inspiration: m.inspiration ?? '',
    performance: m.performance ?? '',
    requiredPacks: m.required_packs ?? [],
    namInstances: m.nam_instances ?? 0,
    blockCount: m.block_count ?? 0,
  };
}

/** The catalog, each recipe joined to its built preset by name, plus installed
 * examples with metadata whose recipe is not in this release. */
export function soundItems(
  recipes: FactoryRecipe[],
  built: BuiltEntry[],
  extra: { entry: BuiltEntry; description: string; metadata: RecipeMetadata }[],
): SoundItem[] {
  const byName = new Map(built.map((entry) => [entry.name, entry]));
  const known = new Set<string>();
  const items: SoundItem[] = recipes.map((recipe) => {
    known.add(builtName(recipe));
    return {
      key: recipe.id,
      name: recipe.name,
      description: recipe.description,
      meta: recipeMeta(recipe),
      sceneNames: recipe.scenes.map((scene) => scene.name),
      recipe,
      built: byName.get(builtName(recipe)),
    };
  });
  for (const { entry, description, metadata } of extra)
    if (!known.has(entry.name))
      items.push({
        key: `built:${entry.revision}`,
        name: entry.name.replace(/^Oxidal · /, ''),
        description,
        meta: detailsMeta(metadata),
        sceneNames: entry.scenes,
        built: entry,
      });
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * NAM instances a recipe keeps loaded. Every block that uses a capture is its
 * own instance, even when two paths share the capture; IRs are not NAM.
 */
function captureCount(item: SoundItem): number {
  if (!item.recipe) return item.meta.namInstances;
  return recipeEffects(item.recipe).filter(
    (e) =>
      'native' in e &&
      (!isFactoryVoice(e.native) || factoryVoices[e.native].kind !== 'ir'),
  ).length;
}

/** Captures one stream carries; A2 Full models are heavier than Lite. */
export function captureLimit(engine: string, frames: number): number {
  const base =
    engine === 'tone3000-a2-full' ? CAPTURE_BUDGET.full : CAPTURE_BUDGET.lite;
  return Math.floor((base * frames) / CAPTURE_BUDGET.frames);
}

/** The smallest offered buffer, up to LARGEST_FIX_FRAMES, that carries `count`. */
export function bufferThatFits(engine: string, count: number): number | null {
  return (
    BUFFER_SIZES.filter((frames) => frames <= LARGEST_FIX_FRAMES).find(
      (frames) => captureLimit(engine, frames) >= count,
    ) ?? null
  );
}

/** What this unit has, as far as card states need it. */
export type UnitFacts = {
  /** The installed effects and the library have been read. */
  ready: boolean;
  plugins: Lv2Plugin[];
  /** `tone:model` of captures already on this unit. */
  captures: Set<string>;
  /** `tone:model` of TONE3000 models downloaded here (for example in Tones
   * and IRs) that are not a capture yet: adding one needs no download. */
  kept?: Set<string>;
  /** Saved tones the player chose for roles that name no TONE3000 tone. */
  bindings: Partial<Record<FactoryRole, RigNativeSource>>;
  /** Null when the account state could not be read. */
  signedIn: boolean | null;
  protectOn: boolean;
  audioRunning: boolean;
  /** Frames per period of the configured stream; null when none is set. */
  frames: number | null;
  /** Installed pack ids, when the device reported them. */
  installedPacks: Set<string> | null;
};

/** A tone a recipe still needs: a named TONE3000 capture or a saved tone. */
export type MissingTone =
  | {
      role: FactoryRole;
      named: true;
      tone: number;
      model?: number;
      /** The model already downloaded to this unit, when there is one. */
      kept?: number;
    }
  | { role: FactoryRole; named: false };

/** The key of an installed capture that satisfies a suggestion: its exact
 * model, or any model of the tone when the voice leaves the model open. */
export function installedKey(
  keys: Iterable<string>,
  capture: VoiceCapture,
): string | undefined {
  for (const key of keys)
    if (
      capture.model === undefined
        ? key.startsWith(`${capture.tone}:`)
        : key === `${capture.tone}:${capture.model}`
    )
      return key;
  return undefined;
}

export function roleLabel(role: FactoryRole): string {
  return isFactoryVoice(role)
    ? factoryVoices[role].character
    : `${role[0]!.toUpperCase()}${role.slice(1)} amp`;
}

/** Which of the recipe's roles still have no capture on this unit. */
export function missingTones(item: SoundItem, facts: UnitFacts): MissingTone[] {
  if (!item.recipe) return [];
  return [...new Set(factoryRoles(item.recipe))].flatMap(
    (role): MissingTone[] => {
      if (facts.bindings[role]) return [];
      if (!isFactoryVoice(role)) return [{ role, named: false }];
      const present = factoryVoices[role].captures.some(
        (c) => installedKey(facts.captures, c) !== undefined,
      );
      if (present) return [];
      const capture = primaryCapture(role);
      // Any suggested capture already downloaded counts, first one first.
      for (const c of factoryVoices[role].captures) {
        const key = installedKey(facts.kept ?? [], c);
        if (key)
          return [
            {
              role,
              named: true,
              tone: c.tone,
              model: c.model,
              kept: Number(key.split(':')[1]),
            },
          ];
      }
      return [{ role, named: true, tone: capture.tone, model: capture.model }];
    },
  );
}

/** Pack ids a recipe needs that are not installed. */
function missingPacks(item: SoundItem, facts: UnitFacts): string[] {
  if (item.recipe) return factoryMissingPacks(item.recipe, facts.plugins);
  return item.meta.requiredPacks.filter(
    (id) => facts.installedPacks && !facts.installedPacks.has(id),
  );
}

/** Plugins no pack supplies, such as Oxidal's own, that this unit lacks. */
function missingUnpackaged(item: SoundItem, facts: UnitFacts): string[] {
  if (!item.recipe) return [];
  return factoryMissingPlugins(item.recipe, facts.plugins).filter(
    (name) => !factoryPackFor(name),
  );
}

export type CardState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'build' }
  | { kind: 'tone'; missing: MissingTone[] }
  | { kind: 'signed-out'; missing: MissingTone[] }
  | { kind: 'pack'; packs: string[] }
  | { kind: 'heavy'; count: number; limit: number; fitsAt: number | null }
  | { kind: 'unavailable'; plugins: string[] };

/** The one state a card is in; its primary action follows from it. */
export function cardState(item: SoundItem, facts: UnitFacts): CardState {
  if (!facts.ready) return { kind: 'loading' };
  const count = captureCount(item);
  if (facts.frames && count > captureLimit(item.meta.engine, facts.frames))
    return {
      kind: 'heavy',
      count,
      limit: captureLimit(item.meta.engine, facts.frames),
      fitsAt: bufferThatFits(item.meta.engine, count),
    };
  if (item.built) return { kind: 'ready' };
  const packs = missingPacks(item, facts);
  if (packs.length) return { kind: 'pack', packs };
  const plugins = missingUnpackaged(item, facts);
  if (plugins.length) return { kind: 'unavailable', plugins };
  const missing = missingTones(item, facts);
  if (missing.length)
    // Tones already downloaded need no TONE3000 sign-in to be added.
    return facts.signedIn === false &&
      missing.some((t) => !t.named || t.kept === undefined)
      ? { kind: 'signed-out', missing }
      : { kind: 'tone', missing };
  return { kind: 'build' };
}

/** A card state that can be played or built right now needs nothing more. */
const needsAttention = (state: CardState) =>
  state.kind === 'tone' || state.kind === 'signed-out' || state.kind === 'pack';

/** @see docs/factory-collection.md */
export const isPlayable = (state: CardState) =>
  state.kind === 'ready' || state.kind === 'build';

export type Filters = {
  query: string;
  genre: string;
  engine: string;
  complexity: string;
  effect?: string;
  readyOnly?: boolean;
  groupBy: 'genre' | 'engine';
};
export const noFilters: Filters = {
  query: '',
  genre: 'all',
  engine: 'all',
  complexity: 'all',
  effect: 'all',
  groupBy: 'genre',
};

export function soundEffects(item: SoundItem): string[] {
  return item.recipe ? factoryPluginNames(item.recipe) : [];
}

export function filterItems(items: SoundItem[], f: Filters): SoundItem[] {
  const text = f.query.trim().toLowerCase();
  return items.filter(
    (item) =>
      (!f.effect ||
        f.effect === 'all' ||
        soundEffects(item).includes(f.effect)) &&
      (f.genre === 'all' || item.meta.genres.includes(f.genre)) &&
      (f.engine === 'all' || item.meta.engine === f.engine) &&
      (f.complexity === 'all' || item.meta.complexity === f.complexity) &&
      (!text ||
        [
          item.name,
          item.description,
          item.recipe?.era,
          item.meta.inspiration,
          ...item.meta.genres,
          ...item.meta.techniques,
          engineLabel(item.meta.engine),
        ]
          .join(' ')
          .toLowerCase()
          .includes(text)),
  );
}

/** Groups in a fixed order: the genre list, or the engine tiers. */
export function groupItems(
  items: SoundItem[],
  by: Filters['groupBy'],
): { label: string; items: SoundItem[] }[] {
  const order: readonly string[] =
    by === 'genre' ? factoryGenres : Object.keys(factoryEngineLabels);
  const groups = new Map<string, SoundItem[]>();
  for (const item of items) {
    const key =
      by === 'genre' ? (item.meta.genres[0] ?? 'Other') : item.meta.engine;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()]
    .sort(
      ([a], [b]) =>
        (order.indexOf(a) + 1 || order.length + 1) -
        (order.indexOf(b) + 1 || order.length + 1),
    )
    .map(([key, list]) => ({
      label: by === 'genre' ? key : engineLabel(key as FactoryEngine),
      items: list,
    }));
}

export function summaryLine(shown: number, states: CardState[]): string {
  const total = states.length;
  const ready = states.filter(isPlayable).length;
  const need = states.filter(needsAttention).length;
  return `Showing ${shown} of ${total} · ${ready} ready to play · ${need} need a tone or pack`;
}

/** Scenes as "Bed · Swell · Lead · Wash · +2" for a card. */
export function sceneLine(names: string[], max = 6): string {
  return names.length > max
    ? `${names.slice(0, max).join(' · ')} · +${names.length - max}`
    : names.join(' · ');
}

/** The chain in order, one name per block; NAM stages read as amp captures. */
export function chainNames(recipe: FactoryRecipe): string[] {
  return recipeEffects(recipe).map((effect) =>
    'plugin' in effect ? effect.plugin : 'Amp capture',
  );
}

/** One line per scene: which voices it mixes and any level lift. */
export function sceneGuide(
  recipe: FactoryRecipe,
): { name: string; detail: string }[] {
  const lifted = (level: number) => Math.round(20 * Math.log10(level));
  return recipe.scenes.map((scene) => {
    const voices = scene.mix.flatMap((mix, index) =>
      mix > 0 && recipe.voices[index] ? [recipe.voices[index].name] : [],
    );
    const parts = [
      voices.length ? `Voices: ${voices.join(' + ')}` : 'Everything dry',
    ];
    if (scene.level && lifted(scene.level) !== 0)
      parts.push(
        `${lifted(scene.level) > 0 ? '+' : ''}${lifted(scene.level)} dB`,
      );
    return { name: scene.name, detail: parts.join(' · ') };
  });
}

/** The load line for Details: captures against the stream, else a rough share. */
export function loadEstimate(item: SoundItem, frames: number | null): string {
  const count = captureCount(item);
  if (count > 0) {
    const at = frames ?? CAPTURE_BUDGET.frames;
    return `${count} ${count === 1 ? 'capture' : 'captures'}; a ${at}-frame stream carries ${captureLimit(item.meta.engine, at)}`;
  }
  return `about ${Math.max(1, Math.round(item.meta.blockCount * LV2_BLOCK_LOAD_PERCENT))} % of a buffer`;
}
