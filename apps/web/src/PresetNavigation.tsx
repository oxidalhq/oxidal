import { Button } from './components/ui/button';
import type { MidiMap } from './api';

type Navigation = NonNullable<MidiMap['navigation']>;
export type NavigationKey = 'previous' | 'next';
type Trigger = NonNullable<Navigation['previous']>;

const rows: [NavigationKey, string][] = [
  ['previous', 'Previous preset'],
  ['next', 'Next preset'],
];

/** Shows both the friendly and the raw MIDI number so neither is guessed. */
function triggerText(trigger: Trigger | null | undefined): string {
  if (!trigger) return 'Not assigned';
  return trigger.program != null
    ? `Program ${trigger.program + 1} · raw ${trigger.program}`
    : `CC ${trigger.controller} · press`;
}

/**
 * Device-wide Previous/Next through the Mine set-list. They sit outside every
 * preset, so Clear here can never uncover another action.
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
    <section className="midi-preset-group" aria-label="Preset navigation">
      <div className="midi-group-head">
        <div className="min-w-0">
          <h3 className="m-0 text-base">Preset navigation</h3>
          <p className="caption mt-0.5">
            Move through the Mine set-list from a footswitch. It stops at the
            first and last preset.
          </p>
        </div>
      </div>
      <ul className="m-0 list-none p-0">
        {rows.map(([key, label]) => {
          const active = learning === key;
          const assigned = navigation?.[key];
          return (
            <li key={key} className="midi-row">
              <span className="midi-row-label">{label}</span>
              <code className="midi-address">
                {active ? 'Press the switch…' : triggerText(assigned)}
              </code>
              <div className="midi-actions">
                <Button
                  variant={active ? 'secondary' : 'outline'}
                  className="midi-action"
                  aria-pressed={active ? true : undefined}
                  disabled={!active && (!canLearn || busy)}
                  onClick={() => onLearn(active ? null : key)}
                >
                  {active ? 'Cancel' : 'Learn'}
                  <span className="sr-only"> {label}</span>
                </Button>
                <Button
                  variant="outline"
                  className="midi-action"
                  disabled={!assigned || busy}
                  onClick={() => onClear(key)}
                >
                  Clear<span className="sr-only"> {label}</span>
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
