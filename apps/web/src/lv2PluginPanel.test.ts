import { expect, it } from 'vitest';

import type { Lv2Plugin } from './api';
import { lv2PluginControls, lv2PluginView } from './lv2PluginPanel';

/** The control with this symbol; a missing one fails the test with its name. */
function find(controls: ReturnType<typeof lv2PluginControls>, symbol: string) {
  const control = controls.find((c) => c.symbol === symbol);
  if (!control) throw new Error(`No control ${symbol}`);
  return control;
}

type Port = Lv2Plugin['ports'][number];
const port = (extra: Partial<Port> & { symbol: string }): Port => ({
  index: 0,
  audio: false,
  control: true,
  input: true,
  output: false,
  integer: false,
  toggled: false,
  logarithmic: false,
  latency: false,
  minimum: 0,
  maximum: 4,
  default: 1,
  ...extra,
});
const plugin = (ports: Port[], extra: Partial<Lv2Plugin> = {}): Lv2Plugin => ({
  name: 'Example',
  uri: 'urn:example',
  ports: ports.map((p, index) => ({ ...p, index })),
  unsupported: null,
  ...extra,
});

it('uses the plugin name, kind and its own description', () => {
  const view = lv2PluginView(
    plugin([], { category: 'Delay', comment: 'Line one.\nLine two.' }),
  );
  expect(view).toEqual({
    name: 'Example',
    category: 'Delay',
    description: 'Line one.\nLine two.',
  });
  expect(lv2PluginView(plugin([]))).toEqual({
    name: 'Example',
    category: undefined,
    description: undefined,
  });
});

it('carries names, units, groups and order without changing values or ranges', () => {
  const time = find(
    lv2PluginControls(
      plugin([
        port({
          symbol: 'time',
          name: 'Delay time',
          unit: 'ms',
          group: 'Echo',
          display_priority: 3,
          minimum: 1,
          maximum: 2000,
          default: 350,
          logarithmic: true,
        }),
      ]),
      (symbol) => (symbol === 'time' ? 500 : undefined),
    ),
    'time',
  );
  expect(time).toMatchObject({
    symbol: 'time',
    name: 'Delay time',
    unit: 'ms',
    group: 'Echo',
    priority: 3,
    min: 1,
    max: 2000,
    default: 350,
    value: 500,
    kind: 'range',
  });
});

it('shows the plugin default until a current value is known', () => {
  const controls = lv2PluginControls(plugin([port({ symbol: 'gain' })]));
  expect(find(controls, 'gain')).toMatchObject({ default: 1, value: 1 });
  const noDefault = lv2PluginControls(
    plugin([port({ symbol: 'gain', default: null, minimum: -3 })]),
  );
  expect(find(noDefault, 'gain')).toMatchObject({ value: -3 });
  expect(find(noDefault, 'gain').default).toBeUndefined();
  const bad = lv2PluginControls(plugin([port({ symbol: 'gain' })]), () => NaN);
  expect(find(bad, 'gain').value).toBe(1);
});

it('uses only the device artwork endpoint when discovery admits a picture', () => {
  const uri = 'urn:example#stereo&extra=value';
  expect(lv2PluginView(plugin([], { uri, artwork: true })).artwork).toBe(
    `/api/v1/plugins/lv2/artwork?uri=${encodeURIComponent(uri)}`,
  );
  expect(lv2PluginView(plugin([], { artwork: false })).artwork).toBeUndefined();
});

it('leaves out outputs, latency, audio, event ports and unusable ranges', () => {
  const controls = lv2PluginControls(
    plugin([
      port({ symbol: 'level', input: false, output: true }),
      port({ symbol: 'latency', latency: true, input: false, output: true }),
      port({ symbol: 'in', control: false, audio: true }),
      port({ symbol: 'events', control: false, atom: true }),
      port({ symbol: 'no_range', minimum: null }),
      port({ symbol: 'flat', minimum: 1, maximum: 1 }),
      port({ symbol: 'reversed', minimum: 5, maximum: 1 }),
      port({ symbol: 'ok' }),
    ]),
  );
  expect(controls.map((c) => c.symbol)).toEqual(['ok']);
});

it('marks hidden controls so the panel can skip them but keeps them listed', () => {
  const controls = lv2PluginControls(
    plugin([
      port({ symbol: 'secret', not_on_gui: true }),
      port({ symbol: 'a' }),
    ]),
  );
  expect(controls.map((c) => [c.symbol, c.hidden])).toEqual([
    ['secret', true],
    ['a', undefined],
  ]);
});

it('makes a choice only from the explicit enumeration flag', () => {
  const points = [
    { value: 0, label: 'Mono' },
    { value: 1, label: 'Stereo' },
  ];
  const controls = lv2PluginControls(
    plugin([
      port({
        symbol: 'mode',
        enumeration: true,
        integer: true,
        scale_points: points,
      }),
      port({ symbol: 'shape', integer: true, scale_points: points }),
      port({ symbol: 'bare', enumeration: true }),
      port({ symbol: 'on', toggled: true, minimum: 0, maximum: 1 }),
    ]),
  );
  expect(find(controls, 'mode').kind).toBe('choice');
  expect(find(controls, 'mode').choices).toEqual(points);
  // Named values without the flag stay numbers; an enumeration with none is a number.
  expect(find(controls, 'shape').kind).toBe('range');
  expect(find(controls, 'shape').choices).toBeUndefined();
  expect(find(controls, 'bare').kind).toBe('range');
  expect(find(controls, 'on').kind).toBe('toggle');
});

it('gives a plugin with no display metadata plain controls', () => {
  const control = find(
    lv2PluginControls(plugin([port({ symbol: 'fx_mix' })])),
    'fx_mix',
  );
  expect(control.name).toBeUndefined();
  expect(control.group).toBeUndefined();
  expect(control.unit).toBeUndefined();
  expect(control.priority).toBeUndefined();
});

it('keeps two groups that share a label as separate controls with separate symbols', () => {
  const controls = lv2PluginControls(
    plugin([
      port({ symbol: 'low_cut', group: 'Filter', group_symbol: 'low' }),
      port({ symbol: 'high_cut', group: 'Filter', group_symbol: 'high' }),
    ]),
  );
  expect(controls.map((c) => c.symbol)).toEqual(['low_cut', 'high_cut']);
  expect(controls.every((c) => c.group === 'Filter')).toBe(true);
  expect(controls.map((c) => c.groupId)).toEqual(['symbol:low', 'symbol:high']);
});
