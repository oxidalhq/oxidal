import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { DEFAULT_TARGETS } from '@oxidal/design-system/lib/midi';

import defaults from '../../../crates/oxidal-presets/midi-defaults.json';
import type { MidiMap } from './api';
import { presetTriggerConflicts } from './controllerLayouts';

type Navigation = NonNullable<MidiMap['navigation']>;
type Trigger = NonNullable<Navigation['previous']>;

const device = {
  sheet_scroll: 'sheet:scroll',
  previous: 'stage:previous',
  next: 'stage:next',
  tuner: 'stage:tuner',
  tap: 'stage:tap',
  boost: 'stage:boost',
  protect: 'stage:protect',
} as const;
const player = {
  play_pause: 'player:play',
  stop: 'player:stop',
  previous: 'player:previous',
  next: 'player:next',
  repeat: 'player:loop',
  click: 'player:click',
} as const;

function defaultRows<K extends string>(
  targets: Record<K, string>,
  current: Partial<Record<K, Trigger | null>> | undefined,
  accepted: Record<K, Trigger>,
) {
  return (Object.keys(targets) as K[]).map((key) => ({
    key,
    target: targets[key],
    before: current?.[key],
    after: accepted[key],
  }));
}

function previous(trigger: Trigger | null | undefined) {
  if (trigger?.program != null) return `Program ${trigger.program + 1}`;
  if (trigger?.controller != null) return `CC ${trigger.controller}`;
  return 'Unassigned';
}

export function MidiDefaults({
  map,
  disabled,
  nameOf,
  onApply,
}: {
  map: MidiMap;
  disabled: boolean;
  nameOf: (entry: MidiMap['entries'][number]['entry']) => string;
  onApply: (
    content: Pick<MidiMap, 'navigation' | 'template'>,
  ) => Promise<unknown>;
}) {
  const [review, setReview] = useState(false);
  if (!review)
    return (
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => setReview(true)}
      >
        Reset to default MIDI controls…
      </Button>
    );
  const nav = map.navigation;
  const backing = nav?.backing;
  const deviceRows = defaultRows<keyof typeof device>(
    device,
    nav,
    defaults.navigation,
  );
  const playerRows = defaultRows<keyof typeof player>(
    player,
    backing,
    defaults.navigation.backing,
  );
  const rows = [
    {
      target: 'stage:level',
      before: { program: null, controller: nav?.output_level ?? null },
      after: { program: null, controller: defaults.navigation.output_level },
    },
    {
      target: 'sheet:speed',
      before: { program: null, controller: nav?.sheet_speed ?? null },
      after: { program: null, controller: defaults.navigation.sheet_speed },
    },
    ...deviceRows,
    ...playerRows,
  ];
  const conflicts = presetTriggerConflicts(
    map,
    rows.map((row) => row.after),
    nameOf,
  );
  const first = defaults.template.first_controller;
  const last = first + defaults.template.scene_buttons - 1;
  const retained: [string, number | null | undefined][] = [
    ['Mute output', nav?.mute?.controller],
    ['Next guitar', nav?.guitar?.controller],
    ['Back 10 s', backing?.skip_back?.controller],
    ['Forward 10 s', backing?.skip_forward?.controller],
    ['Backing level', backing?.level],
  ];
  const reservedSlots: string[] = [];
  for (const [label, number] of retained) {
    if (number != null && number >= 48 && number <= 63)
      reservedSlots.push(`CC ${number} · ${label}`);
    if (
      number != null &&
      ((number >= first && number <= last) ||
        rows.some((row) => row.after.controller === number))
    )
      conflicts.push(`CC ${number} · ${label}`);
  }
  return (
    <section
      className="rounded-lg border border-border bg-card p-3"
      aria-label="Review default MIDI controls"
    >
      <h3>Reset to default MIDI controls?</h3>
      <p>
        Scene template for new presets: CC {first}–{last}. Existing preset
        mappings and controller channels keep their settings.
      </p>
      <ul>
        {rows.map((row) => (
          <li key={row.target}>
            {DEFAULT_TARGETS.find((target) => target.id === row.target)?.label}:{' '}
            {previous(row.before)} → CC {row.after.controller}
          </li>
        ))}
      </ul>
      <p>
        Choose a continuous control in the preset’s MIDI assignments to use an
        expression pedal on CC 11. New Rig presets map CC 48–55 to their first
        eight bypassable blocks and CC 56–63 to their first eight named
        branches. Each switch toggles on press. Assigned device controls keep
        their numbers. Use Apply template on a saved Rig to replace its
        assignments.
      </p>
      {reservedSlots.length > 0 && (
        <p>
          These switches keep their device assignments and will be skipped in
          new Rig presets: {reservedSlots.join(', ')}.
        </p>
      )}
      {conflicts.length > 0 && (
        <p role="alert">
          Clear or reassign these controls before resetting:{' '}
          {conflicts.join(', ')}.
        </p>
      )}
      <Button
        disabled={disabled || conflicts.length > 0}
        onClick={async () => {
          const navigation = {
            ...nav,
            output_level: defaults.navigation.output_level,
            sheet_speed: defaults.navigation.sheet_speed,
            backing: { ...backing },
          };
          for (const row of deviceRows) navigation[row.key] = row.after;
          for (const row of playerRows) navigation.backing[row.key] = row.after;
          try {
            await onApply({
              navigation,
              template: defaults.template,
            });
            setReview(false);
          } catch {
            /* The map screen displays the daemon error. */
          }
        }}
      >
        Apply default controls
      </Button>
      <Button variant="ghost" onClick={() => setReview(false)}>
        Cancel
      </Button>
    </section>
  );
}
