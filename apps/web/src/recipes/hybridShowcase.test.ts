import Ajv from 'ajv/dist/2020';
import { expect, it } from 'vitest';

import schema from '../../../../docs/presets/manifest.schema.json';
import type { Lv2Plugin } from '../api';
import { validateFactoryMetadata } from '../factoryMetadata';
import {
  buildFactoryRecipe,
  factoryMissingPlugins,
  factoryRoles,
} from '../factoryRecipes';
import {
  factoryVoiceIds,
  factoryVoices,
  isFactoryVoice,
} from '../factoryVoices';
import catalog from '../fixtures/factory-lv2.json';
import type { RigNativeSource } from '../generated/contract';
import { scenesKey } from '../sceneFormat';
import { hybridShowcaseRecipes } from './hybridShowcase';

const plugins = catalog as Lv2Plugin[];
const source: RigNativeSource = {
  preset: {
    sha256: 'a'.repeat(64),
    name: 'User amp',
    size_bytes: 100,
    framing: 'current',
    block_count: 1,
    embedded_bytes: 20,
    parameter_count: 1,
    playback_available: true,
  },
  source: { kind: 'original', preset: 'a'.repeat(64) },
};
const bindings = Object.fromEntries(
  [...factoryVoiceIds, 'clean', 'crunch', 'heavy', 'bass'].map((role) => [
    role,
    source,
  ]),
);
const defaults = {
  nam_size: 1,
  multi_core: true,
  parameters: {
    osEnabled: 1,
    osFactor: 1,
    pitchEnabled: 0,
    pitchWindow: 0.33333334,
    inputCalibrationLevel: 0.5968333,
    calibrateInput: 1,
    targetLoudness: 0.7,
  },
};
const validate = new Ajv({ strict: false }).compile(schema);
// Provisional hybrid budget (distinct captures, cabinet impulses excluded).
const captureBudget = 3;
const captures = (roles: string[]) =>
  roles.filter(
    (r) =>
      !isFactoryVoice(r) ||
      (factoryVoices[r] as { kind?: string }).kind !== 'ir',
  );
const bannedWords =
  /\b(gilmour|hendrix|clapton|van halen|metallica|slash|knopfler|fender|marshall|mesa|vox|ampeg|boss|ibanez|strat|les paul|pink floyd|u2|zeppelin|nirvana)\b/i;

it('ships at least 16 hybrid presets, 4 or more of them complex', () => {
  expect(hybridShowcaseRecipes.length).toBeGreaterThanOrEqual(16);
  expect(
    hybridShowcaseRecipes.filter((r) => r.complexity === 'complex').length,
  ).toBeGreaterThanOrEqual(4);
  const ids = hybridShowcaseRecipes.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
  const names = hybridShowcaseRecipes.map((r) => r.name);
  expect(new Set(names).size).toBe(names.length);
  for (const name of [
    'Studio Clean',
    'Arena Chime',
    'Blues Club',
    'Stadium',
    'Eighties Lead',
    'Modern Metal',
    'Prog Suite',
    'Post-rock',
    'Bass Suite',
  ])
    expect(names).toContain(name);
});

for (const recipe of hybridShowcaseRecipes) {
  it(`${recipe.name}: valid, within the capture budget and buildable`, () => {
    expect(validateFactoryMetadata(recipe)).toEqual([]);
    expect(recipe.engine).toBe('hybrid');
    expect(recipe.inspiration).not.toMatch(/TODO/);
    expect(recipe.performance).not.toMatch(/TODO/);
    for (const text of [
      recipe.name,
      recipe.description,
      recipe.inspiration,
      recipe.performance,
    ])
      expect(text).not.toMatch(bannedWords);

    const roles = factoryRoles(recipe);
    expect(roles.every((r) => isFactoryVoice(r))).toBe(true);
    expect(captures(roles).length).toBeGreaterThanOrEqual(1);
    expect(captures(roles).length).toBeLessThanOrEqual(captureBudget);

    // Four core scenes, up to eight; lead is third and the one level lift.
    expect(recipe.scenes.length).toBeGreaterThanOrEqual(4);
    expect(recipe.scenes.length).toBeLessThanOrEqual(8);
    const power = (mix: number[]) => mix.reduce((s, v) => s + v * v, 0);
    const db = (i: number) =>
      10 *
      Math.log10(power(recipe.scenes[i]!.mix) / power(recipe.scenes[0]!.mix));
    recipe.scenes.forEach((scene, i) => {
      expect(Math.max(...scene.mix)).toBeLessThanOrEqual(1);
      if (i === 2) expect(db(i)).toBeGreaterThan(1);
      else expect(Math.abs(db(i))).toBeLessThanOrEqual(1);
    });

    expect(factoryMissingPlugins(recipe, plugins)).toEqual([]);
    const request = buildFactoryRecipe(
      recipe,
      plugins,
      bindings,
      'profile',
      crypto.randomUUID(),
      defaults,
    );
    const m = JSON.parse(request.manifest_json);
    expect(validate(m), JSON.stringify(validate.errors)).toBe(true);
    const sceneList = m.extensions[scenesKey(m)!].scenes;
    expect(sceneList).toHaveLength(recipe.scenes.length);
    const keys = (scene: { gains: { node: string; port: number }[] }) =>
      scene.gains.map((g) => `${g.node}:${g.port}`).sort();
    for (const scene of sceneList)
      expect(keys(scene)).toEqual(keys(sceneList[0]));
  });
}
