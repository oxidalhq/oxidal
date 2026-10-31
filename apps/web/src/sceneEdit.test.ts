import { expect, it } from 'vitest';
import Ajv from 'ajv/dist/2020';
import schema from '../../../docs/presets/manifest.schema.json';
import type { Lv2Plugin, Preset, RigDocument } from './api';
import { lv2Effect, sceneRig, type NativeDraft } from './rigDraft';
import { addSceneEffect, branchEffects, removeSceneEffect } from './sceneEdit';

const validator = new Ajv({ strict: false }).compile(schema);
const port = (index: number, symbol: string, input: boolean, audio: boolean) =>
  ({
    index,
    symbol,
    input,
    output: !input,
    audio,
    control: !audio,
    integer: false,
    toggled: false,
    logarithmic: false,
    latency: false,
    ...(audio ? {} : { default: 0, minimum: -90, maximum: 24 }),
  }) as Lv2Plugin['ports'][number];
const mono: Lv2Plugin = {
  name: 'Mono gain',
  uri: 'urn:example:mono',
  unsupported: null,
  ports: [
    port(0, 'in', true, true),
    port(1, 'out', false, true),
    port(2, 'gain', true, false),
  ],
};
const stereo: Lv2Plugin = {
  name: 'Stereo hold',
  uri: 'urn:example:stereo',
  unsupported: null,
  ports: [
    port(0, 'in_l', true, true),
    port(1, 'in_r', true, true),
    port(2, 'out_l', false, true),
    port(3, 'out_r', false, true),
    port(4, 'level', true, false),
  ],
};
const preset: Preset = {
  sha256: 'a'.repeat(64),
  name: 'Tone',
  size_bytes: 100,
  framing: 'current',
  block_count: 0,
  embedded_bytes: 0,
  parameter_count: 0,
  playback_available: false,
};
const tone = (id: string, name: string): NativeDraft => ({
  id,
  kind: 'native',
  name,
  preset,
  source: { kind: 'original', preset: preset.sha256 },
});
const revision = 'r'.repeat(64);
function scenes(): RigDocument {
  const published = sceneRig(
    '68448a6d-0168-4fc8-b337-c12959165271',
    'Scenes',
    [tone('crunch', 'Crunch'), tone('fuzz', 'Fuzz')],
    'tone3000-plugin:' + 'a'.repeat(40),
    'preserve',
  );
  return {
    revision,
    manifest: JSON.parse(published.manifest_json),
  } as RigDocument;
}
const into = (manifest: RigDocument['manifest'], sum: string, port: number) =>
  manifest.oxidal!.graph.edges.find(
    (e) => e.to.node === sum && e.to.port === port,
  )!;

it('puts an effect after one scene only, keeping the scenes and the TONE3000 resources', () => {
  const document = scenes();
  const request = addSceneEffect(document, 'fuzz', lv2Effect(stereo));
  const manifest = JSON.parse(request.manifest_json) as RigDocument['manifest'];
  expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
  const [effect] = manifest.oxidal!.lv2;
  expect(branchEffects(manifest.oxidal!.graph, 'fuzz')).toEqual([effect!.id]);
  expect(branchEffects(manifest.oxidal!.graph, 'crunch')).toEqual([]);
  // The fuzz branch now reaches the scene sums through the effect; crunch is as it was.
  expect(into(manifest, 'scene-left', 1).from.node).toBe(effect!.id);
  expect(into(manifest, 'scene-right', 1).from.node).toBe(effect!.id);
  expect(into(manifest, 'scene-left', 0).from.node).toBe('crunch');
  expect(manifest.extensions['urn:oxidal:scenes:1']).toEqual(
    document.manifest.extensions['urn:oxidal:scenes:1'],
  );
  expect(request.resources).toEqual({
    'preset-0': { kind: 'bundle', revision, resource: 'preset-0' },
  });
  // The original is untouched.
  expect(document.manifest.oxidal!.lv2).toHaveLength(0);
});

it('keeps live knob values and puts several effects in order', () => {
  const first = lv2Effect(stereo);
  const one = addSceneEffect(scenes(), 'crunch', first);
  const document = {
    revision,
    manifest: JSON.parse(one.manifest_json),
  } as RigDocument;
  const id = document.manifest.oxidal!.lv2[0]!.id;
  const two = addSceneEffect(document, 'crunch', lv2Effect(mono), {
    [id]: { level: 3 },
  });
  const manifest = JSON.parse(two.manifest_json) as RigDocument['manifest'];
  expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
  expect(manifest.oxidal!.lv2[0]!.controls.level).toBe(3);
  const order = branchEffects(manifest.oxidal!.graph, 'crunch');
  expect(order).toHaveLength(2);
  expect(order[0]).toBe(id);
});

it('removes an effect and its mono adapters, joining the branch back up', () => {
  const effect = lv2Effect(mono);
  const added = addSceneEffect(scenes(), 'fuzz', effect);
  const document = {
    revision,
    manifest: JSON.parse(added.manifest_json),
  } as RigDocument;
  expect(
    document.manifest.oxidal!.graph.nodes.some(
      (n) => n.id === `${effect.id}-mono`,
    ),
  ).toBe(true);
  const removed = removeSceneEffect(document, effect.id);
  const manifest = JSON.parse(removed.manifest_json) as RigDocument['manifest'];
  expect(validator(manifest), JSON.stringify(validator.errors)).toBe(true);
  expect(manifest.oxidal!.lv2).toHaveLength(0);
  expect(
    manifest.oxidal!.graph.nodes.some((n) => n.id.startsWith(effect.id)),
  ).toBe(false);
  expect(into(manifest, 'scene-left', 1)).toEqual(
    into(scenes().manifest as RigDocument['manifest'], 'scene-left', 1),
  );
  expect(into(manifest, 'scene-right', 1).from).toEqual({
    node: 'fuzz',
    port: 1,
  });
  expect(
    manifest.extensions['urn:oxidal:authoring']!.labels,
  ).not.toHaveProperty(effect.id);
});

it('refuses a node that is not a scene', () => {
  expect(() => addSceneEffect(scenes(), 'missing', lv2Effect(stereo))).toThrow(
    'cannot take an effect',
  );
});
