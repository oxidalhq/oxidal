import type { Lv2Plugin } from './api';

/** Native-value entry with normalized transport and a logarithmic drag axis. */
export type ControlScale = {
  min: number;
  max: number;
  step: number | 'any';
  native: (normalized: number) => number;
  normalized: (native: number) => number;
  snap: (normalized: number) => number;
  nudge: (normalized: number, direction: -1 | 1) => number;
  format: (normalized: number) => string;
};

export function lv2Control(
  port: Pick<
    Lv2Plugin['ports'][number],
    'minimum' | 'maximum' | 'logarithmic' | 'integer' | 'toggled'
  >,
): ControlScale | undefined {
  const lo = port.minimum;
  const hi = port.maximum;
  if (
    lo == null ||
    hi == null ||
    !Number.isFinite(lo) ||
    !Number.isFinite(hi) ||
    lo >= hi ||
    (port.logarithmic && lo <= 0)
  )
    return undefined;
  const clamp = (value: number) => Math.max(lo, Math.min(hi, value));
  const native = (value: number) => {
    const result = port.logarithmic
      ? lo * (hi / lo) ** value
      : lo + (hi - lo) * value;
    if (port.toggled) return result >= (lo + hi) / 2 ? hi : lo;
    return port.integer ? clamp(Math.round(result)) : result;
  };
  const normalized = (value: number) =>
    port.logarithmic
      ? Math.log(value / lo) / Math.log(hi / lo)
      : (value - lo) / (hi - lo);
  const snap = (value: number) => normalized(clamp(native(value)));
  return {
    min: lo,
    max: hi,
    step: port.toggled ? hi - lo : port.integer ? 1 : 'any',
    native,
    normalized,
    snap,
    nudge: (value, direction) => {
      if (port.toggled) return direction > 0 ? 1 : 0;
      if (port.integer) return normalized(clamp(native(value) + direction));
      return Math.max(0, Math.min(1, value + direction * 0.001));
    },
    format: (value) =>
      port.toggled
        ? native(value) === hi
          ? 'On'
          : 'Off'
        : String(Number(native(value).toPrecision(6))),
  };
}

/** "input_mode" → "Input mode": effect ports carry only a symbol. */
export function controlLabel(label: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(label)) return label;
  const words = label.replace(/_/g, ' ');
  return words[0]!.toUpperCase() + words.slice(1);
}
/** Toggles read On/Off; numbers lose their trailing zeros ("300", "0.25"). */
export function controlDisplay(control: {
  display: string;
  toggle: boolean;
  value: number;
  minimum: number;
}) {
  if (control.toggle) return control.value !== control.minimum ? 'On' : 'Off';
  const number = Number(control.display);
  return Number.isFinite(number) && /^-?\d+(\.\d+)?$/.test(control.display)
    ? String(Math.round(number * 1000) / 1000 + 0)
    : control.display;
}
