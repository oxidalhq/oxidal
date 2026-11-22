import { Button } from '@oxidal/design-system/components/button';
import { Caption } from '@oxidal/design-system/components/text';

import type { MidiMap } from './api';

type Backing = NonNullable<NonNullable<MidiMap['navigation']>['backing']>;
/** A backing-player action a switch triggers, or the level knob. */
export type BackingKey = Exclude<keyof Backing, 'level'> | 'level';
type Trigger = NonNullable<Backing['play_pause']>;

const rows: [BackingKey, string][] = [
  ['play_pause', 'Play/Pause'],
  ['stop', 'Stop track'],
  ['next', 'Next track'],
  ['previous', 'Previous track'],
  ['skip_back', 'Back 10 s'],
  ['skip_forward', 'Forward 10 s'],
  ['repeat', 'Loop'],
  ['click', 'Click'],
  ['level', 'Level knob'],
];

/** Shows both the friendly and the raw MIDI number so neither is guessed. */
function assignedText(backing: Backing | undefined, key: BackingKey): string {
  if (key === 'level') {
    const controller = backing?.level;
    return controller == null ? 'Not assigned' : `CC ${controller} · any value`;
  }
  const trigger: Trigger | null | undefined = backing?.[key];
  if (!trigger) return 'Not assigned';
  return trigger.program != null
    ? `Program ${trigger.program + 1} · raw ${trigger.program}`
    : `CC ${trigger.controller} · press`;
}

/**
 * Footswitches for the backing player. Like the other device controls they
 * sit outside every preset, work with no browser open and run the same
 * player action as the on-screen buttons. Learn listens to the controller
 * chosen under Learn from; the level knob learns a CC and follows any value.
 * @see docs/media.md
 */
export function BackingPlayerControls({
  backing,
  learning,
  canLearn,
  busy,
  onLearn,
  onClear,
}: {
  backing: Backing | undefined;
  learning: BackingKey | null;
  canLearn: boolean;
  busy: boolean;
  onLearn: (key: BackingKey | null) => void;
  onClear: (key: BackingKey) => void;
}) {
  return (
    <section
      className="min-w-0 border-b border-border last:border-b-0"
      aria-label="Backing player"
    >
      <div className="grid min-w-0 items-center gap-x-4 gap-y-2 bg-muted/55 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h3 className="m-0 text-base">Backing player</h3>
          <Caption className="mt-0.5">
            These work with no browser open. Next and Previous cue the next or
            previous track, stopped. Nothing is assigned until you learn it.
          </Caption>
        </div>
      </div>
      <ul className="m-0 list-none p-0">
        {rows.map(([key, label]) => {
          const active = learning === key;
          const assigned =
            key === 'level' ? backing?.level != null : !!backing?.[key];
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
                  ? key === 'level'
                    ? 'Turn the knob…'
                    : 'Press the switch…'
                  : assignedText(backing, key)}
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
