/**
 * LV2-only showcase presets: metadata, builds against the plugin fixture,
 * scene shape, genre coverage and inspiration wording.
 *
 * @see docs/factory-collection.md
 */
import { expect, it } from 'vitest';
import catalog from '../fixtures/factory-lv2.json';
import { allFactoryRecipes } from '../factoryCatalog';
import {
  buildFactoryRecipe,
  factoryMissingPlugins,
  factoryRoles,
} from '../factoryRecipes';
import { validateFactoryMetadata } from '../factoryMetadata';
import type { Lv2Plugin } from '../api';
import { lv2ShowcaseRecipes } from './lv2Showcase';

const plugins = catalog as Lv2Plugin[];
const existing = allFactoryRecipes.filter((r) => r.engine === 'lv2');

it('has valid metadata and unique ids and names', () => {
  expect(lv2ShowcaseRecipes.length).toBeGreaterThanOrEqual(24);
  for (const recipe of lv2ShowcaseRecipes) {
    expect(validateFactoryMetadata(recipe), recipe.id).toEqual([]);
    expect(recipe.engine).toBe('lv2');
    expect(recipe.inspiration).not.toMatch(/TODO/);
    expect(recipe.performance).not.toMatch(/TODO/);
  }
  const ids = lv2ShowcaseRecipes.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    ids.filter((id) =>
      allFactoryRecipes.some(
        (r) =>
          r !== undefined && r.id === id && !lv2ShowcaseRecipes.includes(r),
      ),
    ),
  ).toEqual([]);
  const names = lv2ShowcaseRecipes.map((r) => r.name);
  expect(new Set(names).size).toBe(names.length);
});

it('builds every preset with installed plugins and valid controls', () => {
  for (const recipe of lv2ShowcaseRecipes) {
    expect(factoryRoles(recipe), recipe.id).toEqual([]);
    expect(factoryMissingPlugins(recipe, plugins), recipe.id).toEqual([]);
    expect(() =>
      buildFactoryRecipe(recipe, plugins, {}, 'profile', crypto.randomUUID()),
    ).not.toThrow();
  }
});

it('has four to eight distinct scenes, one lead lift, mixes that fit', () => {
  for (const recipe of lv2ShowcaseRecipes) {
    expect(recipe.scenes.length, recipe.id).toBeGreaterThanOrEqual(4);
    expect(recipe.scenes.length, recipe.id).toBeLessThanOrEqual(8);
    const width =
      recipe.topology === 'routed'
        ? (recipe.route!.find((s) => 'paths' in s) as { paths: unknown[] })
            .paths.length
        : recipe.voices.length;
    const names = recipe.scenes.map((s) => s.name);
    expect(new Set(names).size, recipe.id).toBe(names.length);
    // No near-copies: two scenes differ in their mix or in effect settings.
    const mixes = recipe.scenes.map(
      (s) => `${s.mix.join()}|${JSON.stringify(s.controls ?? {})}`,
    );
    expect(new Set(mixes).size, recipe.id).toBe(mixes.length);
    for (const scene of recipe.scenes) expect(scene.mix).toHaveLength(width);
    expect(recipe.scenes[2]!.level, recipe.id).toBeGreaterThan(1);
    for (const [i, scene] of recipe.scenes.entries())
      if (i !== 2) expect(scene.level ?? 1, recipe.id).toBe(1);
  }
});

it('covers the genre floors and tags enough complex presets', () => {
  const all = [...existing, ...lv2ShowcaseRecipes];
  const count = (g: string) =>
    all.filter((r) => r.genres.includes(g as never)).length;
  for (const g of ['Funk', 'Blues', 'Synth', 'Clean', 'Ambient'])
    expect(count(g), g).toBeGreaterThanOrEqual(4);
  for (const g of [
    'Edge of breakup',
    'Country',
    'Jazz',
    'Pop',
    'Classic rock',
    'Hard rock',
    'Progressive',
    'Post-rock',
    'Bass',
    'Lo-fi',
    'Experimental',
  ])
    expect(count(g), g).toBeGreaterThanOrEqual(2);
  expect(
    lv2ShowcaseRecipes.filter((r) => r.complexity === 'complex').length,
  ).toBeGreaterThanOrEqual(6);
  const offbeat = lv2ShowcaseRecipes.find((r) => r.name === 'Offbeat')!;
  expect(offbeat.genres).toEqual(
    expect.arrayContaining(['Experimental', 'Funk']),
  );
});

it('uses Oxidal Swell in the ambient presets', () => {
  const swelled = lv2ShowcaseRecipes.filter(
    (r) =>
      r.genres.includes('Ambient') &&
      JSON.stringify(r).includes('Oxidal Swell'),
  );
  expect(swelled.length).toBeGreaterThanOrEqual(5);
  // Swell time changes by scene in the presets built around it.
  for (const id of ['L01', 'L02', 'L08', 'L12']) {
    const recipe = lv2ShowcaseRecipes.find((r) => r.id === id)!;
    expect(
      recipe.scenes.some((s) => s.controls?.swell?.time !== undefined),
      id,
    ).toBe(true);
  }
});

it('keeps inspiration free of proper names', () => {
  for (const recipe of lv2ShowcaseRecipes) {
    const words = recipe.inspiration
      .split(/(?<=[.!?])\s+/)
      .flatMap((sentence) => sentence.split(/\s+/).slice(1));
    const proper = words.filter((w) => /^[A-Z][a-z]/.test(w));
    expect(proper, recipe.id).toEqual([]);
  }
});
