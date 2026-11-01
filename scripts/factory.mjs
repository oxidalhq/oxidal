#!/usr/bin/env node
/** Explicit local recipe assembly. @see docs/factory-collection.md */
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  factoryRecipes,
  buildFactoryRecipe,
} from '../apps/web/src/factoryRecipes.ts';
const { values } = parseArgs({
  options: {
    api: { type: 'string', default: 'http://127.0.0.1:3230' },
    bindings: { type: 'string' },
    output: { type: 'string' },
    ids: { type: 'string' },
    publish: { type: 'boolean', default: false },
  },
});
if (!values.bindings || !values.output)
  throw new Error(
    'Use --bindings roles.json --output directory [--publish]. Node 22 --experimental-strip-types is required.',
  );
const base = new URL(values.api);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
  throw new Error('Use a loopback connection or SSH tunnel.');
async function request(path, body) {
  const r = await fetch(
    new URL(path, base),
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {},
  );
  const data = await r.json();
  if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(data)}`);
  return data;
}
const bindings = JSON.parse(await readFile(values.bindings, 'utf8'));
const selected = values.ids
  ? new Set(
      values.ids
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
  : null;
if (selected) {
  const known = new Set(factoryRecipes.map((recipe) => recipe.id));
  const unknown = [...selected].filter((id) => !known.has(id));
  if (unknown.length)
    throw new Error(`Unknown recipe ids: ${unknown.join(', ')}`);
}
const [catalog, library] = await Promise.all([
  request('/api/v1/plugins/lv2?sample_rate=48000'),
  request('/api/v1/presets/rigs'),
]);
await mkdir(values.output, { recursive: true });
// Reuse IDs on retry. Build everything before publishing anything.
const requests = [];
for (const recipe of factoryRecipes.filter(
  (candidate) => !selected || selected.has(candidate.id),
)) {
  const path = join(values.output, `${recipe.id}.json`);
  let id = randomUUID();
  try {
    id = JSON.parse(JSON.parse(await readFile(path, 'utf8')).manifest_json).id;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  requests.push({
    recipe,
    path,
    body: buildFactoryRecipe(
      recipe,
      catalog.plugins,
      bindings,
      library.native_profile,
      id,
    ),
  });
}
for (const { path, body } of requests)
  await writeFile(path, JSON.stringify(body, null, 2));
await writeFile(
  join(values.output, 'recipes.json'),
  JSON.stringify(factoryRecipes, null, 2),
);
if (values.publish) {
  const published = [];
  for (const { recipe, body } of requests) {
    const result = await request('/api/v1/presets/rigs', body);
    const details = await request('/api/v1/presets/details');
    await request('/api/v1/presets/details', {
      expected_revision: details.revision,
      entry_kind: 'rig',
      id: result.revision,
      description: recipe.description,
      categories: recipe.categories,
    });
    await writeFile(
      join(values.output, `${recipe.id}.published.json`),
      JSON.stringify(result, null, 2),
    );
    published.push({
      id: recipe.id,
      name: recipe.name,
      revision: result.revision,
    });
    await writeFile(
      join(values.output, 'published.json'),
      JSON.stringify(published, null, 2),
    );
    console.log(`${recipe.id} ${recipe.name}: ${result.revision}`);
  }
} else
  console.log(
    `Prepared ${requests.length} recipes. No presets published; audio unchanged.`,
  );
