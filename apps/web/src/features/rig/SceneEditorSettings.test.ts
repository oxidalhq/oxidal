import { expect, it } from 'vitest';

import type { Lv2Plugin } from '../../api';
import { sceneControlPort } from './SceneEditorSettings';

type Port = Lv2Plugin['ports'][number];
const port = (symbol: string, over: Partial<Port> = {}): Port =>
  ({
    index: 0,
    symbol,
    audio: false,
    control: true,
    atom: false,
    input: true,
    output: false,
    integer: false,
    toggled: false,
    logarithmic: false,
    latency: false,
    minimum: 0,
    maximum: 1,
    default: 0,
    ...over,
  }) as Port;
const plugin = (...ports: Port[]) =>
  ({ name: 'Effect', uri: 'urn:example:effect', ports }) as Lv2Plugin;

it('offers scenes only the settings the engine will prepare', () => {
  const effect = plugin(
    port('mix'),
    port('freq', { logarithmic: true, minimum: 20, maximum: 20000 }),
    port('time', { logarithmic: true, minimum: 0, maximum: 2 }),
    port('depth', { logarithmic: true, minimum: -1, maximum: 1 }),
    port('free', { minimum: null, maximum: null }),
    port('open', { maximum: null }),
    port('flat', { minimum: 1, maximum: 1 }),
    port('wild', { maximum: Infinity }),
    port('meter', { input: false, output: true }),
    port('events', { atom: true }),
    port('audio', { control: false, audio: true }),
  );
  const offered = [
    'mix',
    'freq',
    'time',
    'depth',
    'free',
    'open',
    'flat',
    'wild',
    'meter',
    'events',
    'audio',
    'missing',
  ].filter((symbol) => sceneControlPort(effect, symbol));
  // A log-scale control must start above zero; every control needs a range.
  expect(offered).toEqual(['mix', 'freq']);
  // A plugin that reports latency is refused whole.
  const delayed = plugin(
    port('mix'),
    port('latency', { input: false, output: true, latency: true }),
  );
  expect(sceneControlPort(delayed, 'mix')).toBeNull();
});
