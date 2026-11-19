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

import type { Lv2Plugin } from './api';

type Lv2Port = Lv2Plugin['ports'][number];

/** The plugin's name, kind and its own description, when it gives them. */
export function lv2PluginView(plugin: Lv2Plugin): PluginView {
  return {
    name: plugin.name,
    category: plugin.category ?? undefined,
    description: plugin.comment ?? undefined,
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
    unit: port.unit ?? undefined,
    kind: port.toggled ? 'toggle' : choices.length ? 'choice' : 'range',
    min,
    max,
    default: fallback,
    value:
      current !== undefined && Number.isFinite(current) ? current : fallback,
    integer: port.integer,
    choices: choices.length ? choices : undefined,
    priority: port.display_priority ?? undefined,
    hidden: port.not_on_gui ? true : undefined,
  };
}
