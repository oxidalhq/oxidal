import { expect, it } from 'vitest';

import {
  assign,
  clear,
  DEFAULT_MAP,
  DEFAULT_TARGETS,
  formatAddress,
  midiProblems,
  parseMidiBytes,
  scaleFromMidi,
} from './midi';

it('formats, parses and scales messages', () => {
  expect(formatAddress({ kind: 'cc', channel: 1, number: 21 })).toBe(
    'CC 21 · ch 1',
  );
  expect(formatAddress({ kind: 'pc', channel: 3, number: 4 }, false)).toBe(
    'PC 4',
  );
  expect(parseMidiBytes([0xb0, 21, 100])).toEqual({
    kind: 'cc',
    channel: 1,
    number: 21,
    value: 100,
  });
  expect(parseMidiBytes([0xc2, 5])).toEqual({
    kind: 'pc',
    channel: 3,
    number: 5,
  });
  expect(parseMidiBytes([0x90, 60, 100])).toBeNull();
  expect(scaleFromMidi(127, 0, 10)).toBe(10);
  expect(scaleFromMidi(64, 0, 10, 0.5)).toBe(5);
});

it('the default map has every target once and no clashes', () => {
  expect(new Set(DEFAULT_MAP.map((m) => m.target)).size).toBe(
    DEFAULT_MAP.length,
  );
  for (const m of DEFAULT_MAP)
    expect(DEFAULT_TARGETS.some((t) => t.id === m.target)).toBe(true);
  expect(midiProblems(DEFAULT_MAP, DEFAULT_TARGETS)).toEqual([]);
});

it('reports two targets on one message and buttons on fixed-meaning numbers', () => {
  let map = assign(DEFAULT_MAP, 'stage:tuner', {
    kind: 'cc',
    channel: 1,
    number: 18,
  });
  const problems = midiProblems(map, DEFAULT_TARGETS);
  expect(problems.map((p) => p.text)).toEqual([
    'CC 18 · ch 1 does Scene 3 and Tuner',
  ]);
  map = assign(clear(map, 'stage:tuner'), 'stage:boost', {
    kind: 'cc',
    channel: 1,
    number: 64,
  });
  expect(midiProblems(map, DEFAULT_TARGETS)[0]!.text).toMatch(/sustain pedal/);
});
