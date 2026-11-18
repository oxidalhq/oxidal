import { expect, it } from 'vitest';

import { rigBusy, rigLocked, soundingLane } from './mixedRigViewModel';

const gain = (port: number, value: number) => ({
  node: 'scene-left',
  port,
  value,
});
const branches = [
  { id: 'clean', name: 'Clean', gains: [gain(0, 1)] },
  { id: 'lead', name: 'Lead', gains: [gain(1, 1)] },
];

it('finds a scene’s lane from the path its levels open, not from its id', () => {
  const lead = { id: 'lead', gains: [gain(0, 0), gain(1, 1)] };
  expect(soundingLane(lead, branches)).toBe(1);
  // A duplicated or copied scene has a new id and no path of its own.
  expect(soundingLane({ ...lead, id: 'scene-1a2b3c4d' }, branches)).toBe(1);
  // A renamed id that matches another path still follows its levels.
  expect(soundingLane({ ...lead, id: 'clean' }, branches)).toBe(1);
  // A scene that opens nothing falls back to the path named like it.
  expect(
    soundingLane({ id: 'lead', gains: [gain(0, 0), gain(1, 0)] }, branches),
  ).toBe(1);
  expect(soundingLane(undefined, branches)).toBe(-1);
  expect(soundingLane({ id: 'x', gains: [] }, branches)).toBe(-1);
});

it('has one busy rule, and a selection lock that never needs audio', () => {
  const idle = { edit: null, editing: false, picker: null, switching: false };
  expect(rigBusy({ disabled: false }, idle)).toBe(false);
  expect(rigBusy({ disabled: true }, idle)).toBe(true);
  for (const reason of [
    { edit: {} },
    { editing: true },
    { picker: {} },
    { switching: true },
  ])
    expect(rigBusy({ disabled: false }, { ...idle, ...reason })).toBe(true);
  // Blocks stay selectable while audio is stopped or a preset switches.
  expect(rigLocked({ ...idle, switching: true })).toBe(false);
  expect(rigLocked({ ...idle, picker: {} })).toBe(true);
  expect(rigLocked({ ...idle, edit: {} })).toBe(true);
  expect(rigLocked({ ...idle, editing: true })).toBe(true);
});
