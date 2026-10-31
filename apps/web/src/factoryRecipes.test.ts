import { expect, it } from 'vitest';
import Ajv from 'ajv/dist/2020';
import schema from '../../../docs/presets/manifest.schema.json';
import catalog from './fixtures/factory-lv2.json';
import {
  buildFactoryRecipe,
  factoryRecipes,
  factoryMissingPlugins,
} from './factoryRecipes';
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
const validate = new Ajv({ strict: false }).compile(schema);
it('builds thirty-two portable four-scene instruments from the installed public plugin metadata', () => {
  expect(factoryRecipes).toHaveLength(32);
  for (const recipe of factoryRecipes) {
    const request = buildFactoryRecipe(
      recipe,
      plugins,
      { clean: source, crunch: source, heavy: source, bass: source },
      'profile',
    );
    const m = JSON.parse(request.manifest_json);
    expect(validate(m), JSON.stringify(validate.errors)).toBe(true);
    expect(m.oxidal.recall.tails).toBe('preserve');
    expect(m.extensions['urn:oxidal:scenes:1'].scenes).toHaveLength(4);
    // Explicit fan-out, not repeated use of an ordinary output port.
    const counts = new Map<string, number>();
    for (const edge of m.oxidal.graph.edges) {
      const key = `${edge.from.node}:${edge.from.port}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect([...counts.values()].every((n) => n === 1)).toBe(true);
    // Every scene covers the same full gain set; recalls cannot leak a prior mix.
    const scenes = m.extensions['urn:oxidal:scenes:1'].scenes;
    const keys = (scene: { gains: { node: string; port: number }[] }) =>
      scene.gains.map((g) => `${g.node}:${g.port}`).sort();
    for (const scene of scenes) expect(keys(scene)).toEqual(keys(scenes[0]));
  }
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
