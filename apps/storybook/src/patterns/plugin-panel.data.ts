import type { PluginControl, PluginView } from './plugin-panel';

/** A made-up delay plugin, described the way a well-made LV2 plugin describes itself. */
export const PLUGIN: PluginView = {
  name: 'Example Delay',
  category: 'Delay',
  description:
    'A tape-style delay with a filter in the repeats and a slow wobble. Made up for this example.',
  artwork: '/examples/plugin-art.svg',
  origin: {
    kind: 'lv2',
    title: 'Example Delay',
    author: 'Example Audio',
    category: 'Delay',
    uri: 'https://example.org/plugins/delay',
    pack: {
      name: 'Example pack',
      version: '1.2.0',
      website: 'https://example.org',
      licence: 'GPL-3.0',
    },
  },
};

const range = (
  symbol: string,
  name: string,
  group: string,
  unit: string,
  min: number,
  max: number,
  value: number,
  priority = 0,
): PluginControl => ({
  symbol,
  name,
  group,
  unit,
  kind: 'range',
  min,
  max,
  default: value,
  value,
  priority,
});

export const CONTROLS: PluginControl[] = [
  range('time', 'Time', 'Time', 'ms', 20, 2000, 380, 9),
  range('feedback', 'Repeats', 'Time', '%', 0, 100, 35, 8),
  range('mix', 'Mix', 'Output', '%', 0, 100, 30, 7),
  {
    symbol: 'sync',
    name: 'Follow the tempo',
    group: 'Time',
    kind: 'toggle',
    min: 0,
    max: 1,
    default: 0,
    value: 0,
    priority: 6,
  },
  {
    symbol: 'division',
    name: 'Note',
    group: 'Time',
    kind: 'choice',
    min: 0,
    max: 3,
    default: 1,
    value: 1,
    priority: 5,
    choices: [
      { value: 0, label: 'Quarter' },
      { value: 1, label: 'Dotted eighth' },
      { value: 2, label: 'Eighth' },
      { value: 3, label: 'Triplet' },
    ],
  },
  range('tone', 'Tone', 'Tone', '', 0, 10, 6, 4),
  range('lowcut', 'Low cut', 'Tone', 'Hz', 20, 800, 120),
  range('highcut', 'High cut', 'Tone', 'Hz', 1000, 16000, 6000),
  range('saturation', 'Saturation', 'Tone', '%', 0, 100, 20),
  range('wow', 'Wow', 'Modulation', '%', 0, 100, 15),
  range('flutter', 'Flutter', 'Modulation', '%', 0, 100, 10),
  range('rate', 'Rate', 'Modulation', 'Hz', 0.1, 8, 0.6),
  {
    symbol: 'mode',
    name: 'Stereo',
    group: 'Output',
    kind: 'choice',
    min: 0,
    max: 2,
    default: 0,
    value: 0,
    choices: [
      { value: 0, label: 'Mono' },
      { value: 1, label: 'Wide' },
      { value: 2, label: 'Ping-pong' },
    ],
  },
  range('level', 'Level', 'Output', 'dB', -24, 12, 0),
  {
    symbol: 'trails',
    name: 'Trails when off',
    group: 'Output',
    kind: 'toggle',
    min: 0,
    max: 1,
    default: 1,
    value: 1,
  },
  { ...range('latency', 'Latency', 'Output', 'ms', 0, 10, 0), hidden: true },
];

/** The same plugin as the device reports it today: symbols and ranges only. */
export const BARE_PLUGIN: PluginView = { name: 'Example Delay' };
export const BARE_CONTROLS: PluginControl[] = CONTROLS.filter(
  (c) => !c.hidden,
).map(({ symbol, kind, min, max, value, choices }) => ({
  symbol,
  kind,
  min,
  max,
  default: value,
  value,
  choices,
}));
