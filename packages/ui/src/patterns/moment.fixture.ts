import type { BlockModel } from '../widgets/block-editor';
import discovery from './moment.fixture.json';
import type { PluginControl, PluginView } from './plugin-panel';

/** Real 48 kHz Lilv discovery of the bundled Moment stereo description. */
export const MOMENT_PLUGIN: PluginView = {
  name: discovery.name,
  category: discovery.category,
  description: discovery.comment,
};

type Port = {
  symbol: string;
  name: string;
  control: boolean;
  input: boolean;
  toggled: boolean;
  integer: boolean;
  enumeration: boolean;
  minimum?: number;
  maximum?: number;
  default?: number;
  unit?: string;
  scale_points?: { value: number; label: string }[];
};

export const MOMENT_CONTROLS: PluginControl[] = (
  discovery.ports as Port[]
).flatMap((p) =>
  p.control && p.input && p.minimum !== undefined && p.maximum !== undefined
    ? [
        {
          symbol: p.symbol,
          name: p.name,
          kind: p.toggled ? 'toggle' : p.enumeration ? 'choice' : 'range',
          min: p.minimum,
          max: p.maximum,
          default: p.default,
          value: p.default ?? p.minimum,
          integer: p.integer,
          unit: p.unit,
          choices: p.enumeration ? p.scale_points : undefined,
        },
      ]
    : [],
);

/** A chooser example with all 24 real controls, using the plugin's defaults. */
export function moment(id: string): BlockModel {
  return {
    id,
    label: 'Moment',
    caption: 'Micro-looper',
    kind: 'time',
    role: 'micro-loop',
    on: true,
    controls: MOMENT_CONTROLS.map((c) => ({
      id: c.symbol,
      label: c.name ?? c.symbol,
      value: c.value,
      min: c.min,
      max: c.max,
      step: c.integer ? 1 : undefined,
      unit: c.unit,
      toggle: c.kind === 'toggle',
      main: ['clock', 'catch', 'length', 'move', 'balance', 'mix'].includes(
        c.symbol,
      ),
    })),
  };
}
