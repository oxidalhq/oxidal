import { factoryRecipes, type FactoryRecipe } from './factoryRecipes.ts';
import { hybridShowcaseRecipes } from './recipes/hybridShowcase.ts';
import { lv2ShowcaseRecipes } from './recipes/lv2Showcase.ts';
import { tone3000ShowcaseRecipes } from './recipes/tone3000Showcase.ts';
import { songbookRecipes } from './songbookRecipes.ts';
import { toolRecipes } from './toolRecipes.ts';

/** Earlier recipes replaced by a Sprint 12 showcase preset of the same name
 * (decision D-3: keep, re-tag, retire the weak ones). */
const retiredRecipeIds = new Set([
  'A02',
  'A04',
  'A05',
  'S01',
  'S04',
  'X02',
  'P01',
  'P04',
  'C05',
  'K02',
  'C03',
  'R02',
  'R04',
]);

/** Every recipe the collection browser, the builders and the tests know about.
 * @see docs/factory-collection.md */
export const allFactoryRecipes: FactoryRecipe[] = [
  ...lv2ShowcaseRecipes,
  ...tone3000ShowcaseRecipes,
  ...hybridShowcaseRecipes,
  ...factoryRecipes.filter((recipe) => !retiredRecipeIds.has(recipe.id)),
  ...songbookRecipes,
  ...toolRecipes,
];
