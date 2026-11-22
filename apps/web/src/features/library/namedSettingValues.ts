import type { Lv2Plugin } from '../../api';

export const supportsNamedSettings = (uri: string) =>
  /^urn:oxidal:plugin:(bloom|echo|motion|sustain|moment)#(mono|stereo)$/.test(
    uri,
  );

/** A recalled snapshot must define every writable parameter of this exact plugin.
 * A draft may omit parameters which use their declared default. */
export function namedSettingValues(
  plugin: Lv2Plugin,
  inputs: Record<string, number>,
  fillDefaults: boolean,
): Record<string, number> {
  const ports = plugin.ports.filter((p) => p.control && p.input);
  if (
    !supportsNamedSettings(plugin.uri) ||
    plugin.unsupported ||
    !ports.length ||
    Object.keys(inputs).some(
      (symbol) => !ports.some((p) => p.symbol === symbol),
    )
  )
    throw new Error('These settings do not match the installed effect.');
  const values: Record<string, number> = {};
  for (const p of ports) {
    const value = inputs[p.symbol] ?? (fillDefaults ? p.default : undefined);
    if (
      value == null ||
      !Number.isFinite(value) ||
      (p.minimum != null && value < p.minimum) ||
      (p.maximum != null && value > p.maximum) ||
      (p.integer && !Number.isInteger(value)) ||
      (p.toggled && value !== 0 && value !== 1) ||
      (p.enumeration && !p.scale_points?.some((point) => point.value === value))
    )
      throw new Error(
        `The saved value for ${p.name || p.symbol} is incompatible with this effect.`,
      );
    values[p.symbol] = value;
  }
  return values;
}
