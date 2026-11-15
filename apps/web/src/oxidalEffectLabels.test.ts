import { expect, it } from 'vitest';
import type { Control } from './generated/contract';
import { oxidalEffectControls } from './oxidalEffectLabels';

const control = (symbol: string, value: number): Control => ({
  display: String(value),
  integer: true,
  label: symbol,
  logarithmic: false,
  maximum: 8,
  minimum: 0,
  scale_points: [],
  target: { kind: 'lv2', node: 'motion', symbol },
  toggle: false,
  value,
});

it('names Motion shapes for the playing mode and leaves other plugins alone', () => {
  const phaser = oxidalEffectControls(
    [control('mode', 2), control('shape', 1)],
    'urn:oxidal:plugin:motion#stereo',
  );
  const shape = phaser.find(
    (c) => c.target.kind === 'lv2' && c.target.symbol === 'shape',
  )!;
  expect(shape.display).toBe('Six stages');
  expect(shape.scale_points?.map((p) => p.label)).toEqual([
    'Four stages',
    'Six stages',
    'Eight stages',
  ]);
  const other = [control('mode', 2), control('shape', 1)];
  expect(oxidalEffectControls(other, 'urn:oxidal:plugin:echo#stereo')).toBe(
    other,
  );
});
