import type { BlockControl, BlockModel } from '../widgets/block-editor';

/** One value as short as it can be read: 8 kHz, −48 dB, 6.5. */
export function shortValue(
  control: Pick<BlockControl, 'value' | 'step' | 'unit'>,
) {
  const { value, unit } = control;
  if (unit === 'Hz' && Math.abs(value) >= 1000) {
    const k = value / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)} kHz`;
  }
  const whole = Number.isInteger(value) && unit;
  const digits = whole || (control.step && control.step >= 1) ? 0 : 1;
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

/** The preview line each block shows in the chain, from its main values. */
export function previewOf(block: BlockModel) {
  return block.controls
    .filter((c) => c.main)
    .slice(0, 2)
    .map(shortValue)
    .join(' · ');
}
