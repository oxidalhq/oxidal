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

it.each([
  [0, 0, ['Loop length', 'Tape speed', 'Size and decay', 'Echo spread']],
  [1, 1, ['Slice size', 'Travel', 'Delay time', 'Feedback']],
  [2, 2, ['Slice size', 'Sensitivity', 'Sample size', 'Pitch speed']],
])(
  'names Moment controls for loop %s and wet %s without changing values',
  (loop, wet, labels) => {
    const original = [
      control('loopmode', loop),
      control('wetmode', wet),
      ...['length', 'move', 'time', 'shape'].map((symbol) =>
        control(symbol, 50),
      ),
    ];
    const result = oxidalEffectControls(
      original,
      'urn:oxidal:plugin:moment#stereo',
    );
    expect(result.slice(2).map((c) => c.label)).toEqual(labels);
    result.forEach((c, index) =>
      expect(c).toEqual({ ...original[index], label: c.label }),
    );
  },
);

it('keeps Moment labels when modes are missing or unknown', () => {
  const original = [control('length', 50), control('shape', 50)];
  expect(
    oxidalEffectControls(original, 'urn:oxidal:plugin:moment#mono'),
  ).toEqual(original);
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
