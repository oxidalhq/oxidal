import { expect, it } from 'vitest';
import Ajv from 'ajv/dist/2020';
import schema from '../../../docs/presets/manifest.schema.json';
import catalog from './fixtures/factory-lv2.json';
import {
  buildFactoryRecipe,
  factoryRecipes,
  factoryMissingPlugins,
  factoryRoles,
} from './factoryRecipes';
import { allFactoryRecipes } from './factoryCatalog';
import { songbookRecipes } from './songbookRecipes';
import { toolRecipes } from './toolRecipes';
import {
  factoryVoiceIds,
  factoryVoices,
  isFactoryVoice,
  primaryCapture,
} from './factoryVoices';
import type { RigNativeSource } from './generated/contract';
import type { Lv2Plugin } from './api';
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
it('builds portable scene instruments and complex serial chains from installed metadata', () => {
  expect(factoryRecipes).toHaveLength(44);
  for (const recipe of factoryRecipes) {
    const request = buildFactoryRecipe(
      recipe,
      plugins,
      { clean: source, crunch: source, heavy: source, bass: source },
      'profile',
      crypto.randomUUID(),
      defaults,
    );
    const m = JSON.parse(request.manifest_json);
    expect(validate(m), JSON.stringify(validate.errors)).toBe(true);
    expect(m.oxidal.recall.tails).toBe('preserve');
    // Explicit fan-out, not repeated use of an ordinary output port.
    const counts = new Map<string, number>();
    for (const edge of m.oxidal.graph.edges) {
      const key = `${edge.from.node}:${edge.from.port}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    if (recipe.topology === 'serial') {
      expect(m.extensions['urn:oxidal:scenes:1']).toBeUndefined();
      expect(m.extensions['urn:oxidal:authoring'].factory_topology).toBe(
        'serial',
      );
    } else {
      expect(m.extensions['urn:oxidal:scenes:1'].scenes).toHaveLength(4);
      // Every scene covers the same full gain set; recalls cannot leak a prior mix.
      const scenes = m.extensions['urn:oxidal:scenes:1'].scenes;
      const keys = (scene: { gains: { node: string; port: number }[] }) =>
        scene.gains.map((g) => `${g.node}:${g.port}`).sort();
      for (const scene of scenes) expect(keys(scene)).toEqual(keys(scenes[0]));
    }
    const engines = m.tone3000.instances.length;
    const settings = m.extensions['urn:oxidal:native-settings:1'];
    if (engines < 2) {
      expect(settings).toBeUndefined();
    } else {
      expect(m.requiredExtensions).toContain('urn:oxidal:native-settings:1');
      expect(Object.keys(settings.instances)).toHaveLength(engines);
      for (const value of Object.values(settings.instances) as {
        parameters: Record<string, number>;
      }[]) {
        expect(value.parameters.osEnabled).toBe(1);
        expect(value.parameters.osFactor).toBe(engines >= 3 ? 0 : 0.5);
      }
    }
  }
});

it('builds the dual-NAM serial example as one ordered path, not parallel scenes', () => {
  const recipe = factoryRecipes.find((item) => item.id === 'X07')!;
  const request = buildFactoryRecipe(
    recipe,
    plugins,
    { clean: source, crunch: source },
    'profile',
  );
  const manifest = JSON.parse(request.manifest_json);
  expect(manifest.tone3000.instances).toHaveLength(2);
  expect(manifest.oxidal.lv2).toHaveLength(6);
  expect(manifest.extensions['urn:oxidal:scenes:1']).toBeUndefined();
  const processing = manifest.oxidal.graph.nodes.filter(
    (node: { kind: string }) => !['input', 'output'].includes(node.kind),
  );
  expect(processing.length).toBeGreaterThanOrEqual(8);
});
it('rejects a same-name substitute URI and Atom effects without portable state', () => {
  const r = factoryRecipes[0]!;
  const changed = plugins.map((p) => ({ ...p, uri: `urn:wrong:${p.name}` }));
  expect(factoryMissingPlugins(r, changed).length).toBeGreaterThan(0);
  expect(() =>
    buildFactoryRecipe(r, changed, { clean: source }, 'profile'),
  ).toThrow('Install');
  const atoms = plugins.map((p) => ({
    ...p,
    ports: p.ports.map((port) => ({ ...port, atom: true })),
  }));
  expect(factoryMissingPlugins(r, atoms).length).toBeGreaterThan(0);
  expect(() =>
    buildFactoryRecipe(r, atoms, { clean: source }, 'profile'),
  ).toThrow('Install');
});
it('requires explicit native bindings and rejects incompatible plugin control ranges', () => {
  expect(() =>
    buildFactoryRecipe(factoryRecipes[0]!, plugins, {}, 'profile'),
  ).toThrow('Choose a clean');
  const incompatible = plugins.map((p) => ({
    ...p,
    ports: p.ports.map((port) => ({ ...port, maximum: -1000 })),
  }));
  expect(() =>
    buildFactoryRecipe(
      factoryRecipes[0]!,
      incompatible,
      { clean: source },
      'profile',
    ),
  ).toThrow('incompatible control');
});

it('admits only the qualified Dragonfly scalar layouts, not changed message ports', () => {
  const recipe = factoryRecipes.find((r) => r.id === 'A05')!;
  expect(factoryMissingPlugins(recipe, plugins)).toEqual([]);
  const changed = plugins.map((p) => ({
    ...p,
    ports: p.ports.map((port) =>
      port.atom ? { ...port, symbol: 'unknown-message' } : port,
    ),
  }));
  expect(factoryMissingPlugins(recipe, changed)).toContain('Dragonfly Hall');
  expect(() => buildFactoryRecipe(recipe, changed, {}, 'profile')).toThrow(
    'Install Dragonfly Hall',
  );
});

it('builds every songbook preset from named voices and tags it by era', () => {
  expect(songbookRecipes.length).toBeGreaterThanOrEqual(19);
  expect(new Set(allFactoryRecipes.map((r) => r.id)).size).toBe(
    allFactoryRecipes.length,
  );
  const all = Object.fromEntries(
    [...factoryVoiceIds, 'clean', 'crunch', 'heavy', 'bass'].map((role) => [
      role,
      source,
    ]),
  );
  for (const recipe of songbookRecipes) {
    expect(recipe.era).toBeDefined();
    expect(recipe.categories[0]).toBe(recipe.era);
    expect(recipe.scenes.map((scene) => scene.name)).toEqual([
      'Rhythm',
      'Lead',
      'Intro',
      'Boost',
    ]);
    const roles = factoryRoles(recipe);
    expect(roles.length).toBeGreaterThan(0);
    expect(roles.every((role) => isFactoryVoice(role))).toBe(true);
    const request = buildFactoryRecipe(
      recipe,
      plugins,
      all,
      'profile',
      crypto.randomUUID(),
      defaults,
    );
    const manifest = JSON.parse(request.manifest_json);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    // Songbook names stand alone, without the example-collection prefix.
    expect(manifest.name).toBe(recipe.name);
    expect(manifest.name.startsWith('Oxidal')).toBe(false);
  }
});

it('links every voice to numeric capture ids and covers more than four amps', () => {
  for (const id of factoryVoiceIds) {
    const voice = factoryVoices[id];
    expect(voice.character.length).toBeGreaterThan(10);
    expect(voice.captures.length).toBeGreaterThan(0);
    for (const capture of voice.captures) {
      expect(Number.isInteger(capture.tone) && capture.tone > 0).toBe(true);
      expect(Number.isInteger(capture.model) && capture.model > 0).toBe(true);
    }
    expect(primaryCapture(id)).toEqual(voice.captures[0]);
  }
  // The point of the songbook: far more distinct amps than the four shared roles.
  const used = new Set(songbookRecipes.flatMap((r) => factoryRoles(r)));
  expect(used.size).toBeGreaterThanOrEqual(10);
  // Every era and the dark, djent and brutal genres are present.
  const eras = new Set(songbookRecipes.map((r) => r.era));
  expect([...eras].sort()).toEqual(['2000s', '80s', '90s', 'Modern']);
  const tags = new Set(songbookRecipes.flatMap((r) => r.categories));
  for (const tag of ['Djent', 'Brutal', 'Goth', 'Dark', 'Death metal'])
    expect(tags.has(tag)).toBe(true);
});

it('builds the guitar-as-bass and duo presets with octave-down pitch and bass voices', () => {
  expect(toolRecipes.map((r) => r.id)).toEqual(['T01', 'T02', 'T03', 'T04']);
  const all = Object.fromEntries(
    [...factoryVoiceIds, 'clean', 'crunch', 'heavy', 'bass'].map((role) => [
      role,
      source,
    ]),
  );
  for (const recipe of toolRecipes) {
    expect(recipe.categories).toContain('Bass');
    const request = buildFactoryRecipe(
      recipe,
      plugins,
      all,
      'profile',
      crypto.randomUUID(),
      defaults,
    );
    const manifest = JSON.parse(request.manifest_json);
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    const pitched = manifest.oxidal.lv2.filter(
      (p: { pluginUri: string; controls: Record<string, number> }) =>
        p.pluginUri === 'urn:oxidal:plugin:pitch#stereo' &&
        p.controls.semitones === -12,
    );
    expect(pitched.length).toBeGreaterThan(0);
    expect(factoryRoles(recipe).some((r) => r.startsWith('bass-'))).toBe(true);
  }
  // The two duo presets run a guitar amp and a bass amp together.
  for (const id of ['T03', 'T04']) {
    const recipe = toolRecipes.find((r) => r.id === id)!;
    expect(factoryRoles(recipe)).toHaveLength(2);
  }
});
