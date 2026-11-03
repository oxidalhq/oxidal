import { expect, it } from 'vitest';
import type { Lv2Plugin } from './api';
import type { RigNativeSource } from './generated/contract';
import { effectShortName, playingTone, presetWithEffect } from './slotEffects';

const port = (
  index: number,
  symbol: string,
  audio: boolean,
  input: boolean,
  initial = 0,
) => ({
  index,
  symbol,
  audio,
  control: !audio,
  atom: false,
  input,
  output: !input,
  integer: false,
  toggled: false,
  logarithmic: false,
  latency: false,
  minimum: audio ? null : 0,
  maximum: audio ? null : 1,
  default: audio ? null : initial,
});
const hold: Lv2Plugin = {
  name: 'Oxidal Hold (Stereo)',
  uri: 'urn:oxidal:plugin:hold#stereo',
  unsupported: null,
  ports: [
    port(0, 'hold', false, true),
    port(1, 'attack', false, true, 300),
    port(2, 'release', false, true, 1500),
    port(3, 'level', false, true),
    port(4, 'dry', false, true, 1),
    port(5, 'focus', false, true, 80),
    port(6, 'width', false, true, 50),
    port(7, 'in_l', true, true),
    port(8, 'out_l', true, false),
    port(9, 'in_r', true, true),
    port(10, 'out_r', true, false),
  ],
};
const tone: RigNativeSource = {
  preset: {
    sha256: 'a'.repeat(64),
    name: 'Rx Bogner',
    source_id: null,
    framing: 'current',
    size_bytes: 1000,
    parameter_count: 10,
    block_count: 4,
  } as RigNativeSource['preset'],
  source: { kind: 'owned', preset: 'copy-1' },
};

it('names the effect plainly and finds the playing tone in the library', () => {
  expect(effectShortName(hold)).toBe('Hold');
  expect(playingTone([tone], 'copy-1', true)).toBe(tone);
  expect(playingTone([tone], 'copy-1', false)).toBeUndefined();
});

it('puts the effect before, after or beside the TONE3000 chain in a finished preset', () => {
  const edges = (placement: 'before' | 'after' | 'split') => {
    const made = presetWithEffect({
      tone,
      name: 'Rx Bogner',
      plugin: hold,
      placement,
      profile: 'tone3000-plugin:test',
    });
    expect(made.name).toBe('Rx Bogner + Hold');
    const manifest = JSON.parse(made.publish.manifest_json);
    expect(manifest.extensions['urn:oxidal:authoring'].draft).toBe(false);
    expect(made.publish.resources).toEqual({
      'preset-0': { kind: 'owned', preset: 'copy-1' },
    });
    const kinds = Object.fromEntries(
      manifest.oxidal.graph.nodes.map((n: { id: string; kind: string }) => [
        n.id,
        n.kind,
      ]),
    );
    return manifest.oxidal.graph.edges.map(
      (e: { from: { node: string }; to: { node: string } }) =>
        `${kinds[e.from.node]}>${kinds[e.to.node]}`,
    );
  };
  expect(edges('before')).toEqual(
    expect.arrayContaining(['input>lv2', 'lv2>tone3000', 'tone3000>output']),
  );
  expect(edges('after')).toEqual(
    expect.arrayContaining(['input>tone3000', 'tone3000>lv2', 'lv2>output']),
  );
  expect(edges('split')).toEqual(
    expect.arrayContaining([
      'input>split',
      'split>tone3000',
      'split>lv2',
      'tone3000>merge',
      'lv2>merge',
      'merge>output',
    ]),
  );
});

it('captures the full processed spectrum when Hold is last in the chain', () => {
  const made = presetWithEffect({
    tone,
    name: 'Rx Bogner + Retro Flanger',
    plugin: hold,
    placement: 'after',
    profile: 'tone3000-plugin:test',
  });
  const manifest = JSON.parse(made.publish.manifest_json);
  expect(manifest.oxidal.lv2[0]).toMatchObject({
    pluginUri: 'urn:oxidal:plugin:hold#stereo',
    controls: { focus: 0 },
  });
});
