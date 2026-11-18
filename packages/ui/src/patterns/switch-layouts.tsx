import * as React from 'react';
import { cn } from '../lib/cn';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { Caption, Eyebrow } from '../components/ui/text';
import type { ControllerProfile } from '../widgets/controllers';

export type SwitchMode = 'stomp' | 'scene' | 'preset';

export type Named = { id: string; name: string };
type Lists = { blocks: Named[]; scenes: Named[]; presets: Named[] };

const DIVISIONS = [
  ['1/4', '♩'],
  ['3/16', '♪.'],
  ['1/8', '♪'],
  ['1/12', '♪³'],
] as const;
const DIVISION_NAMES: Record<string, string> = {
  '1/4': 'quarter',
  '3/16': 'dotted eighth',
  '1/8': 'eighth',
  '1/12': 'triplet',
};

const MODES: Record<SwitchMode, { name: string; caption: string }> = {
  stomp: {
    name: 'Stomp',
    caption: 'Switches turn blocks on and off, like a pedalboard.',
  },
  scene: {
    name: 'Scenes',
    caption: 'One switch per scene of the playing preset; no gap between them.',
  },
  preset: {
    name: 'Presets',
    caption:
      'A bank of presets; the next one is already warm, so its trails can carry over.',
  },
};

/** What a press or a hold does, as a Select value. */
type Action = string;
type Extra = {
  division?: string;
  freeze?: string;
  latch?: boolean;
};

function labelOf(
  action: Action,
  extra: Extra | undefined,
  lists: Lists,
): string {
  const [kind, id] = action.split(':');
  const find = (list: Named[]) => list.find((x) => x.id === id)?.name ?? '';
  switch (kind) {
    case 'block':
      return find(lists.blocks);
    case 'scene':
      return find(lists.scenes);
    case 'preset':
      return find(lists.presets);
    case 'tap':
      return `Tap ${DIVISIONS.find(([v]) => v === (extra?.division ?? '1/4'))?.[1] ?? ''}`;
    case 'freeze':
      return `Freeze ${find(lists.blocks)}`;
    case 'tuner':
      return 'Tuner';
    case 'mode':
      return 'Next mode';
    case 'bank-up':
      return 'Bank up';
    case 'bank-down':
      return 'Bank down';
    default:
      return '—';
  }
}

function defaults(
  profile: ControllerProfile,
  mode: SwitchMode,
  { blocks, scenes, presets }: Lists,
): { tap: Action; hold: Action }[] {
  const n = profile.switches.length;
  const last = n - 1;
  return profile.switches.map((_, i) => {
    if (i === last) return { tap: 'tap', hold: 'mode' };
    if (mode === 'stomp')
      return {
        tap: blocks.length ? `block:${blocks[i % blocks.length]!.id}` : 'none',
        hold: i === 0 ? 'tuner' : 'none',
      };
    if (mode === 'scene')
      return {
        tap: i < scenes.length ? `scene:${scenes[i]!.id}` : 'none',
        hold: i === 0 ? 'tuner' : 'none',
      };
    return {
      tap:
        i === last - 1 && n > 4
          ? 'bank-up'
          : i < presets.length
            ? `preset:${presets[i]!.id}`
            : 'none',
      hold: i === 0 ? 'tuner' : 'none',
    };
  });
}

/**
 * What each switch of a foot controller does, in three modes (H-5):
 * **Stomp** (blocks on and off), **Scenes** and **Presets**. A held switch
 * changes mode, so a 4-switch unit reaches all three. Any switch, tapped or
 * held, can also be **tap tempo** with its note value or **freeze** a delay
 * or reverb, held down or latched (H-7). Each preset can keep its own
 * layout.
 */
export function SwitchLayouts({
  profile,
  blocks,
  scenes,
  presets,
}: {
  profile: ControllerProfile;
  /** Blocks of the playing preset a switch can turn on and off. */
  blocks: Named[];
  /** Scenes of the playing preset. */
  scenes: Named[];
  /** The presets of the current bank. */
  presets: Named[];
}) {
  const lists = { blocks, scenes, presets };
  const [mode, setMode] = React.useState<SwitchMode>('scene');
  const [layouts, setLayouts] = React.useState(() => ({
    stomp: defaults(profile, 'stomp', lists),
    scene: defaults(profile, 'scene', lists),
    preset: defaults(profile, 'preset', lists),
  }));
  const [extras, setExtras] = React.useState<Record<string, Extra>>({});
  const [selected, setSelected] = React.useState(0);
  const [perPreset, setPerPreset] = React.useState(true);
  const perPresetId = React.useId();
  const layout = layouts[mode];
  const sw = profile.switches[selected]!;
  const key = (press: 'tap' | 'hold', at = selected) =>
    `${mode}:${profile.switches[at]!.id}:${press}`;
  const set = (press: 'tap' | 'hold', action: Action) =>
    setLayouts((all) => ({
      ...all,
      [mode]: all[mode].map((s, i) =>
        i === selected ? { ...s, [press]: action } : s,
      ),
    }));
  const extra = (press: 'tap' | 'hold', change: Extra) =>
    setExtras((all) => ({
      ...all,
      [key(press)]: { ...all[key(press)], ...change },
    }));

  const editor = (press: 'tap' | 'hold') => {
    const action = layout[selected]![press];
    const own = extras[key(press)];
    const label = press === 'tap' ? 'Press' : 'Hold';
    return (
      <div className="grid gap-1.5">
        <span className="small-caps text-xs text-muted-foreground">
          {label}
        </span>
        <Select value={action} onValueChange={(v) => set(press, v)}>
          <SelectTrigger
            aria-label={`${label} switch ${sw.name}`}
            className="w-full"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nothing</SelectItem>
            <SelectGroup>
              <SelectLabel>Blocks on or off</SelectLabel>
              {blocks.map(({ id, name }) => (
                <SelectItem key={id} value={`block:${id}`}>
                  {name}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Scenes</SelectLabel>
              {scenes.map(({ id, name }) => (
                <SelectItem key={id} value={`scene:${id}`}>
                  {name}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Presets</SelectLabel>
              {presets.map(({ id, name }) => (
                <SelectItem key={id} value={`preset:${id}`}>
                  {name}
                </SelectItem>
              ))}
              <SelectItem value="bank-up">Bank up</SelectItem>
              <SelectItem value="bank-down">Bank down</SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Time and tools</SelectLabel>
              <SelectItem value="tap">Tap tempo</SelectItem>
              {blocks
                .filter((b) =>
                  /echo|bloom|hold|delay|reverb/i.test(b.name + b.id),
                )
                .map(({ id, name }) => (
                  <SelectItem key={id} value={`freeze:${id}`}>
                    Freeze {name}
                  </SelectItem>
                ))}
              <SelectItem value="tuner">Tuner</SelectItem>
              <SelectItem value="mode">Next mode</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        {action === 'tap' && (
          <div className="grid gap-1">
            <SegmentedControl
              size="sm"
              value={own?.division ?? '1/4'}
              onValueChange={(division) =>
                division && extra(press, { division })
              }
              aria-label={`Delay repeats per tap, switch ${sw.name}`}
            >
              {DIVISIONS.map(([v, glyph]) => (
                <Segment
                  key={v}
                  value={v}
                  aria-label={`${glyph} ${DIVISION_NAMES[v]}`}
                >
                  {glyph}
                </Segment>
              ))}
            </SegmentedControl>
            <Caption className="text-xs">
              Echo repeats on the {DIVISION_NAMES[own?.division ?? '1/4']} of
              the tapped beat; Motion follows the beat.
            </Caption>
          </div>
        )}
        {action.startsWith('freeze:') && (
          <div className="grid gap-1">
            <SegmentedControl
              size="sm"
              value={own?.latch ? 'latch' : 'held'}
              onValueChange={(v) => v && extra(press, { latch: v === 'latch' })}
              aria-label={`Freeze, switch ${sw.name}`}
            >
              <Segment value="held">While held</Segment>
              <Segment value="latch">Until pressed again</Segment>
            </SegmentedControl>
            <Caption className="text-xs">
              Freeze keeps the{' '}
              {labelOf(action, own, lists).replace('Freeze ', '')} sound ringing
              while you play over it.
            </Caption>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Eyebrow>{profile.name}</Eyebrow>
        <SegmentedControl
          size="sm"
          value={mode}
          onValueChange={(v) => v && setMode(v as SwitchMode)}
          aria-label="Mode"
          className="justify-self-start"
        >
          {(Object.keys(MODES) as SwitchMode[]).map((m) => (
            <Segment key={m} value={m}>
              {MODES[m].name}
            </Segment>
          ))}
        </SegmentedControl>
        <Caption className="text-xs">{MODES[mode].caption}</Caption>
      </div>
      <div
        role="radiogroup"
        aria-label={`Switches in ${MODES[mode].name} mode`}
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${Math.min(profile.columns, 5)}, minmax(0, 1fr))`,
        }}
      >
        {profile.switches.map((s, i) => {
          const tap = labelOf(layout[i]!.tap, extras[key('tap', i)], lists);
          const hold = labelOf(layout[i]!.hold, extras[key('hold', i)], lists);
          return (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={i === selected}
              onClick={() => setSelected(i)}
              className={cn(
                'grid min-h-20 min-w-0 content-start gap-0.5 rounded-pad border border-input bg-card px-2 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                i === selected && 'border-2 border-foreground',
              )}
            >
              <span className="small-caps text-xs text-muted-foreground">
                {s.name}
              </span>
              <span className="truncate text-sm font-semibold">{tap}</span>
              {hold !== '—' && (
                <span className="truncate text-xs text-muted-foreground">
                  Hold: {hold}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-2">
        <span className="text-sm font-semibold sm:col-span-2">
          Switch {sw.name} in {MODES[mode].name} mode
        </span>
        {editor('tap')}
        {editor('hold')}
      </div>
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={perPresetId} className="grid gap-0.5">
          <span className="text-sm font-semibold">
            Each preset keeps its own layout
          </span>
          <Caption as="span" className="text-xs">
            {perPreset
              ? 'Changes here belong to the playing preset; others keep theirs.'
              : 'One layout for every preset.'}{' '}
            Hold switch {profile.switches.at(-1)!.name} to change mode.
          </Caption>
        </label>
        <Switch
          id={perPresetId}
          checked={perPreset}
          onCheckedChange={setPerPreset}
        />
      </div>
    </div>
  );
}
