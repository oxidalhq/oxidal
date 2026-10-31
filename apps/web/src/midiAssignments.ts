import type { RigAudioState } from './api';

type Settings = NonNullable<NonNullable<RigAudioState['configured']>['midi']>;

export function midiConflicts(settings: Settings | null) {
  if (!settings) return [];
  const controls = new Map<number, string[]>();
  const programs = new Map<number, string[]>();
  const add = (map: Map<number, string[]>, number: number, label: string) =>
    map.set(number, [...(map.get(number) ?? []), label]);
  settings.bindings.forEach((binding, index) => {
    if (binding.program != null)
      add(programs, binding.program, `Scene ${index + 1}`);
    if (binding.controller != null)
      add(controls, binding.controller, `Scene ${index + 1}`);
  });
  settings.branch_bindings?.forEach((binding) =>
    add(controls, binding.controller, `Switch ${binding.branch}`),
  );
  settings.parameter_bindings?.forEach((binding, index) =>
    add(controls, binding.controller, `Control ${index + 1}`),
  );
  const reserved = [...controls.keys()]
    .filter((number) => number === 0 || number === 32)
    .map((number) => `CC ${number} is reserved for Bank Select`);
  return [
    ...reserved,
    ...[...programs].flatMap(([number, labels]) =>
      labels.length > 1
        ? [`Program ${number + 1} is assigned to ${labels.join(' and ')}`]
        : [],
    ),
    ...[...controls].flatMap(([number, labels]) =>
      labels.length > 1
        ? [`CC ${number} is assigned to ${labels.join(' and ')}`]
        : [],
    ),
  ];
}
