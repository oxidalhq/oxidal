#!/usr/bin/env node
/** Build asset-free first-boot sounds. @see docs/factory-collection.md */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  factoryRecipes,
  factoryRoles,
  buildFactoryRecipe,
} from '../apps/web/src/factoryRecipes.ts';
const { values } = parseArgs({ options: { output: { type: 'string' } } });
if (!values.output) throw new Error('Use --output directory');
const plugins = JSON.parse(
  readFileSync(
    new URL('../apps/web/src/fixtures/factory-lv2.json', import.meta.url),
    'utf8',
  ),
);
const scalar_layouts = JSON.parse(
  readFileSync(
    new URL('../crates/oxidal-lv2/scalar-state.json', import.meta.url),
    'utf8',
  ),
);
const recipes = factoryRecipes.filter(
  (recipe) => factoryRoles(recipe).length === 0,
);
const sounds = recipes.map((recipe) => {
  const hex = createHash('sha256')
    .update(`oxidal-factory:${recipe.id}:1`)
    .digest('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  const request = buildFactoryRecipe(recipe, plugins, {}, 'effects-only', id);
  const manifest = JSON.parse(request.manifest_json);
  if (
    Object.keys(request.resources).length ||
    manifest.resources.length ||
    manifest.tone3000.instances.length
  )
    throw new Error(
      'Factory image sounds must contain no third-party capture data',
    );
  return {
    id: recipe.id,
    description: recipe.description,
    categories: recipe.categories,
    request,
  };
});
mkdirSync(values.output, { recursive: true });
writeFileSync(
  join(values.output, 'catalog.json'),
  JSON.stringify({ version: 1, scalar_layouts, sounds }, null, 2) + '\n',
);
console.log(`Prepared ${sounds.length} asset-free factory sounds`);
