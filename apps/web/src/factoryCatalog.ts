import { factoryRecipes, type FactoryRecipe } from './factoryRecipes.ts';
import { songbookRecipes } from './songbookRecipes.ts';

/** Every recipe the collection browser, the builders and the tests know about.
 * @see docs/factory-collection.md */
export const allFactoryRecipes: FactoryRecipe[] = [
  ...factoryRecipes,
  ...songbookRecipes,
];
