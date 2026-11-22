/**
 * Turns an installed LV2 plugin record into what the shared plugin panel shows:
 * the plugin's own names, units, groups and order, with plain labels from the port
 * symbol when the plugin gives nothing. It changes labels and layout only, never a
 * value, range or control identity (plugin URI plus port symbol).
 *
 * @see docs/lv2.md
 */
import type {
  PluginControl,
  PluginView,
} from '@oxidal/design-system/patterns/plugin-panel';

import type { Lv2Plugin, RigControl } from './api';
import { controlDisplay } from './lv2Control';

type Lv2Port = Lv2Plugin['ports'][number];

/** The plugin's name, kind and its own description, when it gives them. */
export function lv2PluginView(plugin: Lv2Plugin): PluginView {
  return {
    name: plugin.name,
    category: plugin.category ?? undefined,
    description: plugin.comment ?? undefined,
    ...(plugin.author ? { author: plugin.author } : {}),
    ...(plugin.artwork
      ? {
          artwork: `/api/v1/plugins/lv2/artwork?uri=${encodeURIComponent(plugin.uri)}`,
        }
      : {}),
    ...(plugin.homepage && /^https?:\/\//i.test(plugin.homepage)
      ? { homepage: plugin.homepage }
      : {}),
  };
}

/**
 * The plugin's input controls that a person can change. Outputs, latency ports,
 * audio, event ports and controls without a usable range are left out. A port the
 * plugin hides is marked hidden so the panel skips it. A choice needs the plugin's
 * explicit enumeration flag; named values alone stay a number with a name shown.
 *
 * `valueOf` gives the current value by port symbol; without one the plugin's own
 * default shows.
 */
export function lv2PluginControls(
  plugin: Lv2Plugin,
  valueOf: (symbol: string) => number | undefined = () => undefined,
): PluginControl[] {
  return plugin.ports.flatMap((port) => {
    const control = lv2PanelControl(port, valueOf(port.symbol));
    return control ? [control] : [];
  });
}

function lv2PanelControl(
  port: Lv2Port,
  current: number | undefined,
): PluginControl | undefined {
  const { minimum: min, maximum: max } = port;
  if (!port.control || !port.input || port.output || port.latency) return;
  if (min == null || max == null || !Number.isFinite(min + max) || min >= max)
    return;
  const fallback = port.default ?? min;
  const choices = port.enumeration
    ? (port.scale_points ?? []).map(({ value, label }) => ({ value, label }))
    : [];
  return {
    symbol: port.symbol,
    name: port.name ?? undefined,
    group: port.group ?? undefined,
    groupId: port.group_uri
      ? `uri:${port.group_uri}`
      : port.group_symbol
        ? `symbol:${port.group_symbol}`
        : undefined,
    unit: port.unit ?? undefined,
    kind: port.toggled ? 'toggle' : choices.length ? 'choice' : 'range',
    min,
    max,
    default: port.default ?? undefined,
    value:
      current !== undefined && Number.isFinite(current) ? current : fallback,
    integer: port.integer,
    choices: choices.length ? choices : undefined,
    priority: port.display_priority ?? undefined,
    hidden: port.not_on_gui ? true : undefined,
  };
}

/** Add catalog display hints to the selected block's worker-owned controls. */
export function liveLv2Controls(
  plugin: Lv2Plugin | undefined,
  live: ReadonlyMap<string, RigControl>,
): PluginControl[] {
  const described = plugin
    ? new Map(
        lv2PluginControls(plugin).map((control) => [control.symbol, control]),
      )
    : null;
  const ports = new Map(plugin?.ports.map((port) => [port.symbol, port]));
  return [...live].flatMap(([symbol, control]) => {
    const metadata = described?.get(symbol);
    const port = ports.get(symbol);
    if (port && !metadata) return [];
    const choices =
      metadata?.kind === 'choice'
        ? (control.scale_points ?? metadata.choices)
        : undefined;
    const display = controlDisplay(control) || String(control.value);
    const unit = metadata?.unit;
    return [
      {
        ...metadata,
        symbol,
        name: plugin?.uri.startsWith('urn:oxidal:plugin:moment#')
          ? control.label
          : metadata?.name,
        kind: control.toggle ? 'toggle' : choices?.length ? 'choice' : 'range',
        min: control.minimum,
        max: control.maximum,
        default: port?.default ?? undefined,
        value: control.value,
        choices,
        integer: control.integer,
        display:
          unit && Number.isFinite(Number(display))
            ? `${display} ${unit}`
            : display,
      },
    ];
  });
}

const effectLayouts = {
  echo: { role: 'delay', main: ['time', 'feedback', 'mix', 'tone'] },
  bloom: { role: 'reverb', main: ['decay', 'mix', 'size', 'tone'] },
  motion: { role: 'mod', main: ['rate', 'depth', 'mix', 'feedback'] },
} as const;

/** Only known port identities enter a drawing. @see docs/lv2.md */
export function quickEffectLayout(uri: string | undefined) {
  const effect = /^urn:oxidal:plugin:(echo|bloom|motion)#(?:mono|stereo)$/.exec(
    uri ?? '',
  )?.[1] as keyof typeof effectLayouts | undefined;
  return effect ? effectLayouts[effect] : undefined;
}
