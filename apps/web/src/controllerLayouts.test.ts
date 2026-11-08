import { expect, it } from 'vitest';
import {
  applyLayout,
  checkPassed,
  layoutConflicts,
  profiles,
} from './controllerLayouts';

const layout = (profile: string, id: string) =>
  profiles.find((p) => p.id === profile)!.layouts.find((l) => l.id === id)!;
const ref = { kind: 'rig', id: 'a'.repeat(64) } as const;

it('never claims the pedal bank combinations and keeps A–D as program recall', () => {
  const choc = profiles.find((p) => p.id === 'chocolate')!;
  expect(choc.setup.join(' ')).toMatch(/CC 2 and CC 3/);
  for (const l of choc.layouts)
    for (const row of l.switches) expect(row.sends).toMatch(/^Program/);
  const steps = layout('chocolate', 'presets-steps');
  expect(steps.navigation).toEqual({
    previous: { program: 2, controller: null },
    next: { program: 3, controller: null },
  });
});

it('applies only the template and navigation, leaving the rest as is', () => {
  const current = {
    template: { scene_buttons: 8 as const, first_controller: 50 },
    navigation: { next: { program: 1, controller: null } },
  };
  expect(applyLayout(current, layout('chocolate', 'presets'))).toEqual(current);
  const hybrid = applyLayout(current, layout('generic', 'hybrid'));
  expect(hybrid.template).toEqual({ scene_buttons: 2, first_controller: 40 });
  expect(hybrid.navigation).toEqual({
    previous: { program: null, controller: 42 },
    next: { program: null, controller: 43 },
  });
});

it('names existing mappings that already use a number the layout needs', () => {
  const map = {
    entries: [
      {
        entry: ref,
        bindings: [{ scene: 'lead', program: null, controller: 42 }],
        branch_bindings: [
          { branch: 'x', controller: 43, mode: 'toggle' as const },
        ],
        parameter_bindings: [],
      },
    ],
  };
  const found = layoutConflicts(
    map,
    layout('generic', 'hybrid'),
    () => 'Stage Rig',
  );
  expect(found).toEqual(['CC 42 · Stage Rig', 'CC 43 · Stage Rig']);
  expect(
    layoutConflicts(map, layout('generic', 'scenes-4'), () => 'x'),
  ).toEqual([]);
});

it('passes the message check only for the expected press, not a release', () => {
  const hybrid = layout('generic', 'hybrid');
  expect(
    checkPassed(hybrid, [{ kind: 'control', controller: 42, value: 0 }]),
  ).toBe(false);
  expect(
    checkPassed(hybrid, [{ kind: 'control', controller: 42, value: 127 }]),
  ).toBe(true);
  const presets = layout('chocolate', 'presets');
  expect(checkPassed(presets, [{ kind: 'program', program: 1 }])).toBe(false);
  expect(checkPassed(presets, [{ kind: 'program', program: 0 }])).toBe(true);
});
