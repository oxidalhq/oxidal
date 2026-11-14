import { allFactoryRecipes } from './factoryCatalog.ts';
import {
  factoryMissingPlugins,
  factoryRoles,
  recipeEffects,
  type FactoryRecipe,
} from './factoryRecipes.ts';
import { factoryVoices } from './factoryVoices.ts';
import type { Lv2Plugin } from './api';

/**
 * Sound metadata for Oxidal sounds: the fixed genre list, engine and complexity
 * tiers, pure derivations from a recipe's own blocks, and validators. The
 * metadata travels with built presets as `PresetDetails.metadata`.
 * @see docs/factory-collection.md
 */
export const factoryGenres = [
  'Clean',
  'Edge of breakup',
  'Funk',
  'Blues',
  'Country',
  'Jazz',
  'Pop',
  'Classic rock',
  'Hard rock',
  'Modern metal',
  'Progressive',
  'Ambient',
  'Post-rock',
  'Synth',
  'Bass',
  'Lo-fi',
  'Experimental',
] as const;
export type FactoryGenre = (typeof factoryGenres)[number];
const factoryEngines = [
  'lv2',
  'tone3000-a2-lite',
  'tone3000-a2-full',
  'hybrid',
] as const;
export type FactoryEngine = (typeof factoryEngines)[number];
/** Display names for the engine tiers; engine ids never appear in text. */
export const factoryEngineLabels: Record<FactoryEngine, string> = {
  lv2: 'LV2 only',
  'tone3000-a2-lite': 'TONE3000 · A2 Lite',
  'tone3000-a2-full': 'TONE3000 · A2 Full',
  hybrid: 'Hybrid',
};
const factoryComplexities = ['simple', 'layered', 'complex'] as const;
export type FactoryComplexity = (typeof factoryComplexities)[number];

const packByPrefix: [RegExp, string][] = [
  [/^Gx/, 'guitarix'],
  [/^Dragonfly/, 'dragonfly'],
  [/^Invada/, 'invada'],
  [/^x42/, 'x42'],
  [/^MDA/, 'mda'],
  [/^FOMP/, 'fomp'],
  [/^Calf/, 'calf'],
  [/^Reverse Delay/, 'swh'],
  [/^Za[mM]/, 'zam'],
  [
    /^(MVerb|MaGigaverb|MaFreeverb|3 Band EQ|Ping Pong Pan|Cycle Shifter|Soul Force)$/,
    'dpf',
  ],
];

/** The effect pack that supplies a plugin; Oxidal's own plugins need none. */
export function factoryPackFor(pluginName: string): string | undefined {
  return packByPrefix.find(([pattern]) => pattern.test(pluginName))?.[1];
}

/** The plugin names a recipe uses, in order and without repeats. */
export function factoryPluginNames(recipe: FactoryRecipe): string[] {
  return [
    ...new Set(
      recipeEffects(recipe).flatMap((e) => ('plugin' in e ? [e.plugin] : [])),
    ),
  ];
}

/** Derived: effect packs the recipe needs. */
export function factoryRequiredPacks(recipe: FactoryRecipe): string[] {
  return [
    ...new Set(
      factoryPluginNames(recipe).flatMap((name) => {
        const pack = factoryPackFor(name);
        return pack ? [pack] : [];
      }),
    ),
  ];
}

/** Packs still missing for a recipe, from the plugins the device lists. */
export function factoryMissingPacks(
  recipe: FactoryRecipe,
  plugins: Lv2Plugin[],
): string[] {
  return [
    ...new Set(
      factoryMissingPlugins(recipe, plugins).flatMap((name) => {
        const pack = factoryPackFor(name);
        return pack ? [pack] : [];
      }),
    ),
  ];
}

/** Derived: TONE3000 tone ids of the named voices a recipe suggests. Generic
 * roles (clean, crunch, heavy, bass) are bound by the user, so list none. */
function factoryRequiredTones(recipe: FactoryRecipe): number[] {
  return [
    ...new Set(
      factoryRoles(recipe).flatMap((role) => {
        const voice = (
          factoryVoices as Record<string, { captures: { tone: number }[] }>
        )[role];
        return voice?.captures[0] ? [voice.captures[0].tone] : [];
      }),
    ),
  ];
}

/** Derived: processing blocks, NAM stages included. */
const factoryBlockCount = (recipe: FactoryRecipe) =>
  recipeEffects(recipe).length;

/** Derived: simultaneous NAM instances (a shared role is loaded once). */
const factoryNamInstances = (recipe: FactoryRecipe) =>
  factoryRoles(recipe).length;

/** Engine family implied by a recipe's blocks. A2 Lite versus Full is
 * authored on the recipe (voices list both sizes), so a capture-only recipe
 * derives as Lite and either TONE3000 tier is consistent with it. */
export function factoryDerivedEngine(recipe: FactoryRecipe): FactoryEngine {
  if (factoryNamInstances(recipe) === 0) return 'lv2';
  return factoryPluginNames(recipe).length > 0 ? 'hybrid' : 'tone3000-a2-lite';
}

/** The metadata record carried by a built preset (`PresetDetails.metadata`). */
export type FactoryMetadata = {
  genres: FactoryGenre[];
  techniques: string[];
  era?: NonNullable<FactoryRecipe['era']>;
  engine: FactoryEngine;
  complexity: FactoryComplexity;
  inspiration: string;
  performance: string;
  required_packs: string[];
  required_tones: number[];
  block_count: number;
  nam_instances: number;
};

export function factoryMetadata(recipe: FactoryRecipe): FactoryMetadata {
  return {
    genres: recipe.genres,
    techniques: recipe.techniques ?? [],
    ...(recipe.era ? { era: recipe.era } : {}),
    engine: recipe.engine,
    complexity: recipe.complexity,
    inspiration: recipe.inspiration,
    performance: recipe.performance,
    required_packs: factoryRequiredPacks(recipe),
    required_tones: factoryRequiredTones(recipe),
    block_count: factoryBlockCount(recipe),
    nam_instances: factoryNamInstances(recipe),
  };
}

/** Shortest text that can name a style and an era, and that can say what
 * each scene is for. */
const minimumInspiration = 40;
const minimumPerformance = 60;
const placeholderText = /\b(todo|tbd|fixme|placeholder|lorem ipsum)\b/i;
const unfinishedText = (text: string, minimum: number) =>
  text.trim().length < minimum || placeholderText.test(text);

/** Problems with a recipe's authored metadata; empty when it is valid. */
export function validateFactoryMetadata(recipe: FactoryRecipe): string[] {
  const problems: string[] = [];
  const genres: readonly string[] = factoryGenres;
  if (recipe.genres.length < 1 || recipe.genres.length > 3)
    problems.push('Use one to three genres');
  if (new Set(recipe.genres).size !== recipe.genres.length)
    problems.push('Genres repeat');
  for (const genre of recipe.genres)
    if (!genres.includes(genre)) problems.push(`Unknown genre ${genre}`);
  const techniques = recipe.techniques ?? [];
  if (
    techniques.length > 8 ||
    techniques.some((t) => !t.trim() || t.length > 48 || t.includes(','))
  )
    problems.push('Invalid techniques');
  if (!(factoryComplexities as readonly string[]).includes(recipe.complexity))
    problems.push('Unknown complexity');
  if (!(factoryEngines as readonly string[]).includes(recipe.engine))
    problems.push('Unknown engine');
  else {
    const namStages = factoryNamInstances(recipe);
    if ((recipe.engine === 'lv2') !== (namStages === 0))
      problems.push('Engine disagrees with the NAM roles');
    if (recipe.engine === 'hybrid' && factoryPluginNames(recipe).length === 0)
      problems.push('Hybrid needs LV2 blocks');
  }
  if (recipe.inspiration.length > 600) problems.push('Inspiration too long');
  if (recipe.performance.length > 800) problems.push('Performance too long');
  if (unfinishedText(recipe.inspiration, minimumInspiration))
    problems.push('Inspiration is missing or a placeholder');
  if (unfinishedText(recipe.performance, minimumPerformance))
    problems.push('Performance is missing or a placeholder');
  return problems;
}

export const allFactoryMetadataProblems = () =>
  allFactoryRecipes.flatMap((recipe) =>
    validateFactoryMetadata(recipe).map((p) => `${recipe.id}: ${p}`),
  );
