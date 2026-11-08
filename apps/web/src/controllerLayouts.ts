import type { MidiMap } from './api';

type Navigation = NonNullable<MidiMap['navigation']>;
type Trigger = NonNullable<Navigation['previous']>;
type Template = NonNullable<MidiMap['template']>;

/** What one physical switch sends and what Oxidal does with it. */
export type SwitchRow = {
  switch: string;
  sends: string;
  does: string;
  /** The message it sends, so live input can highlight the right switch. */
  message: { program?: number; controller?: number };
};
export type Layout = {
  id: string;
  label: string;
  summary: string;
  /** Scene-button template to save; `keep` leaves the current one alone. */
  template: Template | 'keep';
  /** Triggers to save; a null entry clears it, a missing one leaves it alone. */
  navigation: {
    previous?: Trigger | null;
    next?: Trigger | null;
    mute?: Trigger | null;
  } | null;
  switches: SwitchRow[];
  /** A message to press and expect, used by the passive message check. */
  check: { press: string; program?: number; controller?: number };
};
export type Profile = {
  id: string;
  name: string;
  /** Where the facts below come from; a template is never proof of a mode. */
  evidence: string;
  setup: string[];
  layouts: Layout[];
};

const program = (p: number): Trigger => ({ program: p, controller: null });
const press = (c: number): Trigger => ({ program: null, controller: c });

const ccScenes = (count: 4 | 8): Layout => ({
  id: `scenes-${count}`,
  label: `${count} scenes`,
  summary: `${count} buttons pick scenes inside the playing preset (CC 40–${39 + count}).`,
  template: { scene_buttons: count, first_controller: 40 },
  navigation: null,
  switches: Array.from({ length: count }, (_, i) => ({
    switch: String(i + 1),
    sends: `CC ${40 + i} press`,
    does: `Scene ${i + 1}`,
    message: { controller: 40 + i },
  })),
  check: { press: '1', controller: 40 },
});

const ccHybrid: Layout = {
  id: 'hybrid',
  label: 'Two scenes + Previous/Next',
  summary: 'Two scenes, then Previous and Next preset on the other buttons.',
  template: { scene_buttons: 2, first_controller: 40 },
  navigation: { previous: press(42), next: press(43) },
  switches: [
    {
      switch: '1',
      sends: 'CC 40 press',
      does: 'Scene 1',
      message: { controller: 40 },
    },
    {
      switch: '2',
      sends: 'CC 41 press',
      does: 'Scene 2',
      message: { controller: 41 },
    },
    {
      switch: '3',
      sends: 'CC 42 press',
      does: 'Previous preset',
      message: { controller: 42 },
    },
    {
      switch: '4',
      sends: 'CC 43 press',
      does: 'Next preset',
      message: { controller: 43 },
    },
  ],
  check: { press: '3', controller: 42 },
};

export const profiles: Profile[] = [
  {
    id: 'chocolate',
    name: 'M-Vave Chocolate (original, USB)',
    evidence:
      'Observed on the owner unit in its current PC-bank mode. Other modes are unverified.',
    setup: [
      'Leave the pedal in its current mode: A–D send Program Change on channel 1.',
      'E (A+B) and F (C+D) change the pedal’s own bank with CC 2 and CC 3 (value 5). Oxidal does not bind them, so A–D keep working.',
    ],
    layouts: [
      {
        id: 'presets',
        label: 'Presets',
        summary:
          'A–D recall Set-list presets 1–4. Program Change already does this; nothing to save.',
        template: 'keep',
        navigation: null,
        switches: ['A', 'B', 'C', 'D'].map((name, i) => ({
          switch: name,
          sends: `Program ${i + 1} (raw ${i})`,
          does: `Set-list preset ${i + 1}`,
          message: { program: i },
        })),
        check: { press: 'A', program: 0 },
      },
      {
        id: 'presets-steps',
        label: 'Two presets + Previous/Next',
        summary:
          'A and B recall presets 1–2; C steps to the previous preset and D to the next.',
        template: 'keep',
        navigation: { previous: program(2), next: program(3) },
        switches: [
          {
            switch: 'A',
            sends: 'Program 1 (raw 0)',
            does: 'Set-list preset 1',
            message: { program: 0 },
          },
          {
            switch: 'B',
            sends: 'Program 2 (raw 1)',
            does: 'Set-list preset 2',
            message: { program: 1 },
          },
          {
            switch: 'C',
            sends: 'Program 3 (raw 2)',
            does: 'Previous preset',
            message: { program: 2 },
          },
          {
            switch: 'D',
            sends: 'Program 4 (raw 3)',
            does: 'Next preset',
            message: { program: 3 },
          },
        ],
        check: { press: 'C', program: 2 },
      },
    ],
  },
  {
    id: 'captain',
    name: 'MIDI Captain STD 10',
    evidence:
      'Not yet observed on the owner unit. Set each switch to send a CC press on one channel.',
    setup: [
      'Program the switches to send the CC numbers shown, as presses, on one channel.',
    ],
    layouts: [ccScenes(8), ccHybrid],
  },
  {
    id: 'generic',
    name: 'Generic controller',
    evidence:
      'Any controller that sends CC presses. Use Learn to match different numbers.',
    setup: ['Set the buttons to send the CC numbers shown, or learn your own.'],
    layouts: [ccScenes(4), ccScenes(8), ccHybrid],
  },
];

/** The map content after applying a layout; presets and scene maps are untouched. */
export function applyLayout(
  map: Pick<MidiMap, 'template' | 'navigation'>,
  layout: Layout,
) {
  return {
    template: layout.template === 'keep' ? map.template : layout.template,
    navigation: layout.navigation
      ? { ...map.navigation, ...layout.navigation }
      : map.navigation,
  };
}

const numberOf = (trigger: Trigger) =>
  trigger.program != null
    ? `Program ${trigger.program + 1}`
    : `CC ${trigger.controller}`;

/**
 * Existing preset mappings that already use a number the layout would claim.
 * Saving would be refused by the device, so the preview names them first.
 */
export function layoutConflicts(
  map: Pick<MidiMap, 'entries'>,
  layout: Layout,
  nameOf: (entry: MidiMap['entries'][number]['entry']) => string,
): string[] {
  if (!layout.navigation) return [];
  const claimed = Object.values(layout.navigation).filter(
    (t): t is Trigger => !!t,
  );
  const found: string[] = [];
  for (const item of map.entries) {
    const uses = (program: number | null, controller: number | null) =>
      claimed.some(
        (t) =>
          (program != null && t.program === program) ||
          (controller != null && t.controller === controller),
      );
    const label = (trigger: Trigger) =>
      `${numberOf(trigger)} · ${nameOf(item.entry)}`;
    for (const b of item.bindings)
      if (uses(b.program ?? null, b.controller ?? null))
        found.push(
          label({
            program: b.program ?? null,
            controller: b.controller ?? null,
          }),
        );
    for (const b of item.branch_bindings)
      if (uses(null, b.controller)) found.push(label(press(b.controller)));
    for (const b of item.parameter_bindings)
      if (uses(null, b.controller)) found.push(label(press(b.controller)));
  }
  return found;
}

/** True once a received message is the one the layout's check asks you to press. */
export function checkPassed(
  layout: Layout,
  messages: {
    kind: string;
    program?: number;
    controller?: number;
    value?: number;
  }[],
): boolean {
  return messages.some((m) =>
    layout.check.program != null
      ? m.kind === 'program' && m.program === layout.check.program
      : m.kind === 'control' &&
        m.controller === layout.check.controller &&
        (m.value ?? 0) >= 64,
  );
}

type SavedLayout = NonNullable<MidiMap['saved_layouts']>[number];

/** A saved layout as an applicable one; it replaces all three device triggers. */
export function savedToLayout(saved: SavedLayout): Layout {
  return {
    id: saved.id,
    label: saved.name,
    summary: describeSaved(saved),
    template: saved.template ?? 'keep',
    navigation: {
      previous: saved.navigation?.previous ?? null,
      next: saved.navigation?.next ?? null,
      mute: saved.navigation?.mute ?? null,
    },
    switches: [],
    check: { press: '' },
  };
}

/** What a saved layout will set, in one line. */
export function describeSaved(saved: SavedLayout): string {
  const parts: string[] = [];
  const t = saved.template;
  if (t)
    parts.push(
      `${t.scene_buttons} scene buttons · CC ${t.first_controller}–${t.first_controller + t.scene_buttons - 1}`,
    );
  const nav = saved.navigation;
  for (const [label, trigger] of [
    ['Previous', nav?.previous],
    ['Next', nav?.next],
    ['Mute', nav?.mute],
  ] as const)
    if (trigger) parts.push(`${label} ${numberOf(trigger)}`);
  return parts.join(' · ') || 'No template or triggers';
}

/** The current template and triggers as a new saved layout. */
export function layoutFromCurrent(
  map: Pick<MidiMap, 'template' | 'navigation'>,
  profile: string,
  name: string,
  taken: string[],
): SavedLayout {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 30) || 'layout';
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return {
    id,
    name: name.trim().slice(0, 48),
    profile,
    ...(map.template ? { template: map.template } : {}),
    navigation: { ...map.navigation },
  };
}
