import { createElement } from 'react';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { vi } from 'vitest';
import { TouchAdjust } from './TouchAdjust';
import { expect, it } from 'vitest';
import { lv2Control } from './lv2Control';
import type { Lv2Plugin } from './api';

const port: Lv2Plugin['ports'][number] = {
  index: 0,
  symbol: 'test',
  audio: false,
  control: true,
  input: true,
  output: false,
  integer: false,
  toggled: false,
  logarithmic: false,
  latency: false,
  minimum: -70,
  maximum: 70,
  default: 0,
};

it('keeps native entry and logarithmic drag consistent', () => {
  const gain = lv2Control(port)!;
  expect(gain.native(gain.normalized(-35))).toBe(-35);
  const frequency = lv2Control({
    ...port,
    minimum: 20,
    maximum: 20000,
    logarithmic: true,
  })!;
  expect(frequency.native(0.5)).toBeCloseTo(Math.sqrt(20 * 20000));
  expect(frequency.normalized(2000)).toBeCloseTo(2 / 3);
  expect(frequency.nudge(1, 1)).toBe(1);
  expect(frequency.normalized(-1)).toBeNaN();
});

it('visits every integer without dead or skipped nudges on either taper', () => {
  for (const logarithmic of [false, true]) {
    const scale = lv2Control({
      ...port,
      minimum: 1,
      maximum: 200,
      integer: true,
      logarithmic,
    })!;
    let value = 0;
    for (let expected = 2; expected <= 200; expected++) {
      value = scale.nudge(value, 1);
      expect(scale.native(value)).toBe(expected);
    }
    for (let expected = 199; expected >= 1; expected--) {
      value = scale.nudge(value, -1);
      expect(scale.native(value)).toBe(expected);
    }
    expect(scale.snap(scale.normalized(57.4))).toBeCloseTo(
      scale.normalized(57),
    );
  }
});

it('uses native threshold for toggles and rejects incomplete ranges', () => {
  const toggle = lv2Control({
    ...port,
    minimum: 1,
    maximum: 100,
    toggled: true,
    logarithmic: true,
  })!;
  expect(toggle.format(0.6)).toBe('Off');
  expect(toggle.format(toggle.nudge(0, 1))).toBe('On');
  expect(toggle.format(toggle.nudge(1, -1))).toBe('Off');
  expect(lv2Control({ ...port, minimum: null })).toBeUndefined();
  expect(
    lv2Control({ ...port, minimum: 0, logarithmic: true }),
  ).toBeUndefined();
});

it('touch and keyboard nudges use the native integer step', () => {
  const scale = lv2Control({
    ...port,
    minimum: 1,
    maximum: 200,
    integer: true,
    logarithmic: true,
  })!;
  const change = vi.fn();
  render(
    createElement(TouchAdjust, {
      label: 'voices',
      value: 0,
      baseline: 0,
      min: 0,
      max: 1,
      step: 0.001,
      disabled: false,
      onChange: change,
      format: scale.format,
      snap: scale.snap,
      nudge: scale.nudge,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Increase voices' }));
  expect(scale.native(change.mock.calls.at(-1)![0])).toBe(2);
  fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' });
  expect(scale.native(change.mock.calls.at(-1)![0])).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Decrease voices' }));
  expect(change.mock.calls.at(-1)![0]).toBe(0);
  cleanup();
});
