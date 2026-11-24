import Ajv from 'ajv/dist/2020';
import { expect, it } from 'vitest';

import schema from '../../../docs/presets/manifest.schema.json';
import type { Lv2Plugin } from './api';
import { allFactoryRecipes } from './factoryCatalog';
import {
  buildFactoryRecipe,
  factoryMissingPlugins,
  type FactoryRecipe,
  factoryRecipes,
  factoryRoles,
  keyed,
  pitch,
  recipeEffects,
  sceneControlProblems,
  type SceneSettings,
} from './factoryRecipes';
import {
  factoryVoiceIds,
  factoryVoices,
  isFactoryVoice,
  primaryCapture,
} from './factoryVoices';
import catalog from './fixtures/factory-lv2.json';
import type { RigNativeSource } from './generated/contract';
import { chainRoute } from './rigChain';
import { scenesKey } from './sceneFormat';
import { songbookRecipes } from './songbookRecipes';
import { toolRecipes } from './toolRecipes';
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
    inputCalibrationLevel: 0.5968333,
    calibrateInput: 1,
  },
};
const validate = new Ajv({ strict: false }).compile(schema);
it('builds portable scene instruments and complex serial chains from installed metadata', () => {
  expect(factoryRecipes).toHaveLength(50);
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
      expect(m.extensions[scenesKey(m)!]).toBeUndefined();
      expect(m.extensions['urn:oxidal:authoring'].factory_topology).toBe(
        'serial',
      );
    } else if (recipe.topology === 'routed') {
      // Routed presets open in the routing editor and scenes mix their paths.
      expect(chainRoute(m.oxidal.graph)).not.toBeNull();
      const scenes = m.extensions[scenesKey(m)!].scenes;
      expect(scenes).toHaveLength(recipe.scenes.length);
      const keys = (scene: { gains: { node: string; port: number }[] }) =>
        scene.gains.map((g) => `${g.node}:${g.port}`).sort();
      for (const scene of scenes) expect(keys(scene)).toEqual(keys(scenes[0]));
    } else {
      expect(m.extensions[scenesKey(m)!].scenes).toHaveLength(4);
      // Every scene covers the same full gain set; recalls cannot leak a prior mix.
      const scenes = m.extensions[scenesKey(m)!].scenes;
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
        expect(value.parameters.targetLoudness).toBe(0.7);
        expect(value.parameters.calibrateInput).toBe(0);
        expect(value.parameters.inputCalibrationLevel).toBe(0.6);
        expect(value.parameters.pitchWindow).toBeCloseTo(1 / 3);
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
  expect(manifest.extensions[scenesKey(manifest)!]).toBeUndefined();
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
    // The core order: the softer base, rhythm, the lead with the lift, then a
    // fourth scene of the preset's own.
    expect(recipe.scenes.map((scene) => scene.name).slice(0, 3)).toEqual([
      'Intro',
      'Rhythm',
      'Lead',
    ]);
    expect(recipe.scenes).toHaveLength(4);
    expect(recipe.scenes[2]!.level).toBeGreaterThan(recipe.scenes[1]!.level!);
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
      if (capture.model !== undefined)
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

it('builds routed genre presets with nested splits, pan, polarity and path scenes', () => {
  const recipe = factoryRecipes.find((item) => item.id === 'P02')!;
  const m = JSON.parse(
    buildFactoryRecipe(recipe, plugins, { crunch: source }, 'profile')
      .manifest_json,
  );
  const node = (id: string) =>
    m.oxidal.graph.nodes.find((n: { id: string }) => n.id === id);
  // Verse mixes the octaves out; the nested octave-down path is inverted.
  expect(node('merge-r1-left').inputGains).toEqual([1, 0]);
  expect(node('merge-r2-left').inputGains).toEqual([0.4, -0.6]);
  const route = chainRoute(m.oxidal.graph)!;
  expect(route.filter((s) => typeof s !== 'string')).toHaveLength(1);
  const solo = m.extensions[scenesKey(m)!].scenes[2];
  expect(solo.name).toBe('Solo');
  expect(solo.gains).toContainEqual({
    node: 'merge-r1-right',
    port: 1,
    value: 0.7,
  });
  // Panned paths write unequal sides: Two Rooms' clean amp sits left.
  const rooms = JSON.parse(
    buildFactoryRecipe(
      factoryRecipes.find((item) => item.id === 'P01')!,
      plugins,
      { clean: source, crunch: source },
      'profile',
    ).manifest_json,
  );
  const merge = (side: string) =>
    rooms.oxidal.graph.nodes.find(
      (n: { id: string }) => n.id === `merge-r1-${side}`,
    ).inputGains;
  expect(merge('left')[0]).toBe(1);
  expect(merge('right')[0]).toBe(0.5);
  // A routed scene's level scales its mix: Lead lifts the crunch amp by 1.2.
  const leadScene = rooms.extensions[scenesKey(rooms)!].scenes[2];
  expect(leadScene.name).toBe('Lead');
  expect(leadScene.gains).toContainEqual({
    node: 'merge-r1-right',
    port: 1,
    value: 1.2,
  });
  expect(leadScene.gains).toContainEqual({
    node: 'merge-r1-left',
    port: 1,
    value: 0.6,
  });
});

const everyRole = Object.fromEntries(
  [...factoryVoiceIds, 'clean', 'crunch', 'heavy', 'bass'].map((role) => [
    role,
    source,
  ]),
);

it('lets scenes set effect controls the engine admits, on blocks that exist', () => {
  let recipesWithSettings = 0;
  for (const recipe of allFactoryRecipes) {
    expect(sceneControlProblems(recipe, plugins), recipe.id).toEqual([]);
    if (!recipe.scenes.some((scene) => scene.controls)) continue;
    recipesWithSettings += 1;
    const m = JSON.parse(
      buildFactoryRecipe(
        recipe,
        plugins,
        everyRole,
        'profile',
        crypto.randomUUID(),
        defaults,
      ).manifest_json,
    );
    expect(validate(m), JSON.stringify(validate.errors)).toBe(true);
    type Control = { node: string; symbol: string; value: number };
    const scenes: { controls: Control[] }[] =
      m.extensions[scenesKey(m)!].scenes;
    const keys = (scene: { controls: Control[] }) =>
      scene.controls.map((c) => `${c.node}:${c.symbol}`).sort();
    const block = (node: string) =>
      m.oxidal.lv2.find((l: { id: string }) => l.id === node) as
        { pluginUri: string; controls: Record<string, number> } | undefined;
    for (const scene of scenes) {
      // Every scene sets the same controls, as the preset format requires.
      expect(keys(scene), recipe.id).toEqual(keys(scenes[0]!));
      expect(new Set(keys(scene)).size).toBe(scene.controls.length);
      expect(scene.controls.length).toBeGreaterThan(0);
      expect(scene.controls.length).toBeLessThanOrEqual(32);
      for (const control of scene.controls) {
        const where = `${recipe.id} ${control.node}.${control.symbol}`;
        expect(block(control.node), where).toBeDefined();
        const plugin = plugins.find(
          (p) => p.uri === block(control.node)!.pluginUri,
        )!;
        // The engine's admission rule for a scene control.
        expect(
          plugin.ports.some((p) => p.latency),
          where,
        ).toBe(false);
        const port = plugin.ports.find(
          (p) => p.symbol === control.symbol && p.control && p.input && !p.atom,
        )!;
        expect(port, where).toBeDefined();
        expect(Number.isFinite(port.minimum), where).toBe(true);
        expect(Number.isFinite(port.maximum), where).toBe(true);
        expect(port.minimum!, where).toBeLessThan(port.maximum!);
        if (port.logarithmic) expect(port.minimum!, where).toBeGreaterThan(0);
        expect(control.value, where).toBeGreaterThanOrEqual(port.minimum!);
        expect(control.value, where).toBeLessThanOrEqual(port.maximum!);
        if (port.integer)
          expect(Number.isInteger(control.value), where).toBe(true);
        if (port.toggled)
          expect([port.minimum, port.maximum], where).toContain(control.value);
      }
    }
    // The blocks start on the first scene's values.
    for (const control of scenes[0]!.controls)
      expect(block(control.node)!.controls[control.symbol]).toBe(control.value);
    // At least one scene really differs from the first.
    expect(
      scenes.some(
        (scene) =>
          JSON.stringify(scene.controls) !==
          JSON.stringify(scenes[0]!.controls),
      ),
      recipe.id,
    ).toBe(true);
  }
  expect(recipesWithSettings).toBeGreaterThanOrEqual(10);
});

it('rejects scene controls the engine would refuse', () => {
  const base = allFactoryRecipes.find((r) => r.id === 'L01')!;
  const withScene = (controls: SceneSettings): FactoryRecipe => ({
    ...base,
    scenes: base.scenes.map((scene, index) =>
      index === 1 ? { ...scene, controls } : scene,
    ),
  });
  const problems = (controls: SceneSettings, catalog = plugins) =>
    sceneControlProblems(withScene(controls), catalog);
  expect(problems({ nowhere: { time: 100 } })).toContain(
    'nowhere.time: no block has this key',
  );
  expect(problems({ swell: { speed: 1 } })).toContain(
    'swell.speed: Oxidal Swell (Stereo) has no such control',
  );
  expect(problems({ swell: { time: 5 } })).toContain(
    'swell.time: 5 is not a value this control takes',
  );
  expect(problems({ hold: { hold: 0.5 } })).toContain(
    'hold.hold: 0.5 is not a value this control takes',
  );
  const change = (symbol: string, patch: object) =>
    plugins.map((p) => ({
      ...p,
      ports: p.ports.map((port) =>
        port.symbol === symbol ? { ...port, ...patch } : port,
      ),
    }));
  expect(problems({}, change('time', { minimum: 0 }))).toContain(
    'swell.time: logarithmic control reaches zero',
  );
  expect(problems({}, change('hold', { maximum: null }))).toContain(
    'hold.hold: the control has no range',
  );
  // Oxidal Pitch reports latency, so its controls cannot change by scene.
  const pitched: FactoryRecipe = {
    ...base,
    before: [keyed('shift', pitch(12))],
    scenes: base.scenes.map((scene, index) =>
      index === 1 ? { ...scene, controls: { shift: { semitones: 7 } } } : scene,
    ),
  };
  expect(sceneControlProblems(pitched, plugins)).toContain(
    'shift.semitones: Oxidal Pitch (Stereo) reports latency',
  );
  expect(() =>
    buildFactoryRecipe(
      withScene({ nowhere: { time: 100 } }),
      plugins,
      {},
      'profile',
    ),
  ).toThrow('no block has this key');
  const serial = factoryRecipes.find((r) => r.topology === 'serial')!;
  expect(
    sceneControlProblems(
      {
        ...serial,
        before: [keyed('shift', pitch(12)), ...serial.before],
        scenes: [{ name: 'One', mix: [], controls: { shift: { step: 0 } } }],
      },
      plugins,
    ),
  ).toContain('A serial recipe has no scenes to set controls');
});

it('switches Hold on in a scene wherever a preset uses it, on a block that hears the guitar', () => {
  let presets = 0;
  for (const recipe of allFactoryRecipes) {
    const holds = recipeEffects(recipe).flatMap((e) =>
      'plugin' in e && e.plugin === 'Oxidal Hold (Stereo)' ? [e] : [],
    );
    if (!holds.length) continue;
    presets += 1;
    for (const hold of holds) {
      expect(hold.key, recipe.id).toBeDefined();
      const on = recipe.scenes.map(
        (scene) => scene.controls?.[hold.key!]?.hold === 1,
      );
      expect(on.includes(true), recipe.id).toBe(true);
      // The first scene never starts frozen.
      expect(on[0], recipe.id).toBe(false);
      // A scene send ahead of the block would leave it nothing to capture.
      expect(
        recipe.voices.some((v) => v.effects.includes(hold)),
        recipe.id,
      ).toBe(false);
    }
    for (const scene of recipe.scenes)
      if (/freeze|frozen/i.test(scene.name))
        expect(
          Object.values(scene.controls ?? {}).some((c) => c.hold === 1),
          `${recipe.id} ${scene.name}`,
        ).toBe(true);
  }
  expect(presets).toBeGreaterThanOrEqual(9);
});

it('gives every preset in the collection at least four scenes', () => {
  for (const recipe of allFactoryRecipes) {
    // No scene repeats another's mix and settings at a different level: the
    // fourth scene is a sound of its own, not the lead a little quieter.
    const sounds = recipe.scenes.map((s) =>
      JSON.stringify([s.mix, s.controls ?? {}]),
    );
    expect(new Set(sounds).size, recipe.id).toBe(sounds.length);
    expect(recipe.scenes.length, recipe.id).toBeGreaterThanOrEqual(4);
    expect(recipe.scenes.length, recipe.id).toBeLessThanOrEqual(8);
    expect(new Set(recipe.scenes.map((s) => s.name)).size, recipe.id).toBe(
      recipe.scenes.length,
    );
    expect(recipe.topology, recipe.id).not.toBe('serial');
  }
  // The retired two-amp and punk recipes are back under names that do not
  // clash with a showcase preset.
  const names = allFactoryRecipes.map((r) => r.name);
  expect(names).toContain('Double Parlour');
  expect(names).toContain('Short Fuse');
  expect(allFactoryRecipes.map((r) => r.id)).not.toContain('X07');
  expect(allFactoryRecipes.map((r) => r.id)).not.toContain('H06');
});

it('never builds a split or a merge with a single path', () => {
  for (const recipe of allFactoryRecipes) {
    const m = JSON.parse(
      buildFactoryRecipe(
        recipe,
        plugins,
        everyRole,
        'profile',
        undefined,
        defaults,
      ).manifest_json,
    );
    for (const node of m.oxidal.graph.nodes) {
      if (node.kind === 'split')
        expect(node.audioOutputs, `${recipe.id} ${node.id}`).toBeGreaterThan(1);
      if (node.kind === 'merge')
        expect(node.audioInputs, `${recipe.id} ${node.id}`).toBeGreaterThan(1);
    }
  }
});
