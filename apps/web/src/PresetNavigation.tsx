import { Button } from '@oxidal/design-system/components/button';
import { Caption } from '@oxidal/design-system/components/text';

import type { MidiMap } from './api';

type Navigation = NonNullable<MidiMap['navigation']>;
export type NavigationKey =
  | 'previous'
  | 'next'
  | 'mute'
  | 'tuner'
  | 'guitar'
  | 'tap'
  | 'boost'
  | 'protect'
  | 'sheet_scroll'
  | 'sheet_speed'
  | 'output_level';
type Trigger = NonNullable<Navigation['previous']>;

const rows: [NavigationKey, string][] = [
  ['previous', 'Previous preset'],
  ['next', 'Next preset'],
  ['mute', 'Mute output'],
  ['tuner', 'Tuner'],
  ['guitar', 'Next guitar'],
  ['tap', 'Tap tempo'],
  ['boost', 'Temporary boost'],
  ['protect', 'Protect'],
  ['output_level', 'Output level'],
  ['sheet_scroll', 'Chord sheet scroll'],
  ['sheet_speed', 'Chord sheet speed'],
];

/** Shows both the friendly and the raw MIDI number so neither is guessed. */
function triggerText(trigger: Trigger | number | null | undefined): string {
  if (typeof trigger === 'number') return `CC ${trigger} · continuous`;
  if (!trigger) return 'Not assigned';
  return trigger.program != null
    ? `Program ${trigger.program + 1} · raw ${trigger.program}`
    : `CC ${trigger.controller} · press`;
}

/**
 * Device-wide actions sit outside every preset, so Clear here can never
 * uncover another action.
 * @see docs/architecture.md
 */
export function PresetNavigation({
  navigation,
  learning,
  canLearn,
  busy,
  onLearn,
  onClear,
}: {
  navigation: MidiMap['navigation'];
  learning: NavigationKey | null;
  canLearn: boolean;
  busy: boolean;
  onLearn: (key: NavigationKey | null) => void;
  onClear: (key: NavigationKey) => void;
}) {
  return (
    <section
      className="min-w-0 border-b border-border last:border-b-0"
      aria-label="Device controls"
    >
      <div className="grid min-w-0 items-center gap-x-4 gap-y-2 bg-muted/55 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h3 className="m-0 text-base">Device controls</h3>
          <Caption className="mt-0.5">
            Previous and Next move through the Mine set-list and stop at the
            first and last preset. Mute silences the output until pressed again.
            Tuner opens the global tuner overlay from any screen when a browser
            is connected. Next guitar switches to the next guitar profile and
            wraps after the last.
          </Caption>
        </div>
      </div>
      <ul className="m-0 list-none p-0">
        {rows.map(([key, label]) => {
          const active = learning === key;
          const assigned = navigation?.[key];
          return (
            <li
              key={key}
              className="group grid min-w-0 items-center gap-x-4 gap-y-2 border-t border-border/70 py-2 pr-3 pl-5 data-[conflict=true]:bg-destructive/5 sm:grid-cols-[minmax(0,1fr)_9.5rem_auto] sm:pl-7"
            >
              <span
                data-midi-row-label=""
                className="text-base font-medium group-data-[off=true]:line-through group-data-[off=true]:opacity-65"
              >
                {label}
              </span>
              <code className="font-mono text-xs wrap-anywhere text-muted-foreground group-data-[off=true]:line-through group-data-[off=true]:opacity-65">
                {active
                  ? key === 'output_level' || key === 'sheet_speed'
                    ? 'Move the control…'
                    : 'Press the switch…'
                  : triggerText(assigned)}
              </code>
              <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                <Button
                  variant={active ? 'secondary' : 'outline'}
                  className="min-w-21 flex-1 sm:flex-none"
                  aria-pressed={active ? true : undefined}
                  disabled={!active && (!canLearn || busy)}
                  onClick={() => onLearn(active ? null : key)}
                >
                  {active ? 'Cancel' : 'Learn'}{' '}
                  <span className="sr-only">{label}</span>
                </Button>
                <Button
                  variant="outline"
                  className="min-w-21 flex-1 sm:flex-none"
                  disabled={!assigned || busy}
                  onClick={() => onClear(key)}
                >
                  Clear <span className="sr-only">{label}</span>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
