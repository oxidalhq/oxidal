import { Warning } from '@phosphor-icons/react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { useConfirm } from '../components/ui/confirm';
import { List, ListRow } from '../components/ui/list-row';
import { StableLabel } from '../components/ui/stable-label';
import { Caption } from '../components/ui/text';
import {
  clear,
  DEFAULT_MAP,
  DEFAULT_TARGETS,
  formatAddress,
  midiProblems,
  type MidiTargetInfo,
} from '../lib/midi';
import { useMidi } from './midi-context';

/**
 * Settings › MIDI: every control you can map, grouped, with what it is
 * mapped to, Learn and Clear on each, the problems at the top (two controls
 * on one message, buttons on numbers controllers use for something else),
 * and Reset to the default map.
 */
export function MidiMap() {
  const midi = useMidi();
  const { ask, dialog } = useConfirm();
  if (!midi) return null;
  const all: MidiTargetInfo[] = [
    ...midi.targets,
    ...DEFAULT_TARGETS.filter((d) => !midi.targets.some((t) => t.id === d.id)),
  ];
  const groups = [...new Set(all.map((t) => t.group))];
  const problems = midiProblems(midi.mappings, all);
  return (
    <div data-slot="midi-map" className="grid gap-4">
      {problems.length > 0 && (
        <section
          aria-label="MIDI problems"
          className="grid gap-1 rounded-lg border-2 border-foreground p-3"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Warning weight="fill" aria-hidden="true" /> {problems.length}{' '}
            {problems.length === 1 ? 'problem' : 'problems'} in the map
          </span>
          {problems.map((p, i) => (
            <Caption key={i} className="text-sm">
              {p.text}
            </Caption>
          ))}
        </section>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Caption>
          {midi.mappings.length} mappings · channel numbers as your controller
          shows them
        </Caption>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            if (
              await ask({
                title: 'Reset to the default map?',
                body: 'Scenes on CC 16–23, Previous and Next on CC 24 and 25, Tuner 26, Tap 27, Boost 28, block on/off from CC 48. Your own mappings are replaced.',
                confirm: 'Reset',
              })
            )
              midi.setMappings(DEFAULT_MAP);
          }}
        >
          Reset to the default map
        </Button>
      </div>
      {groups.map((group) => (
        <section key={group} aria-label={group} className="grid gap-1">
          <h3 className="m-0 small-caps text-sm font-medium text-muted-foreground">
            {group}
          </h3>
          <List>
            {all
              .filter((t) => t.group === group)
              .map((t) => {
                const mapping = midi.mappings.find((m) => m.target === t.id);
                const problem = problems.some((p) => p.targets.includes(t.id));
                return (
                  <ListRow
                    key={t.id}
                    title={t.label}
                    caption={
                      mapping
                        ? `${formatAddress(mapping.address)}${mapping.mode ? ` · ${mapping.mode === 'toggle' ? 'each press toggles' : 'on while held'}` : ''}`
                        : 'Not mapped'
                    }
                    trailing={
                      <>
                        {problem && (
                          <Badge tone="warning" size="sm">
                            Clash
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant={
                            midi.learning === t.id ? 'default' : 'outline'
                          }
                          onClick={() =>
                            midi.learn(midi.learning === t.id ? null : t.id)
                          }
                        >
                          <StableLabel
                            value={
                              midi.learning === t.id ? 'Listening…' : 'Learn'
                            }
                            options={['Learn', 'Listening…']}
                          />
                        </Button>
                        {mapping && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              midi.setMappings(clear(midi.mappings, t.id))
                            }
                          >
                            Clear
                          </Button>
                        )}
                      </>
                    }
                  />
                );
              })}
          </List>
        </section>
      ))}
      {dialog}
    </div>
  );
}
