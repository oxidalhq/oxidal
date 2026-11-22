import { useState } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import { Caption } from '@oxidal/design-system/components/text';
import { TempoSource } from '@oxidal/design-system/patterns/tempo-source';

import { sendTempo } from '../../api';
import { friendlyError } from '../../lib/friendlyError';
import { refreshMonitorFeed, useMonitorFeed } from '../../monitorFeed';

const tapNotes = [
  [null, 'Preset division'],
  ['quarter', 'Quarter note'],
  ['dotted_eighth', 'Dotted eighth'],
  ['eighth', 'Eighth note'],
  ['eighth_triplet', 'Eighth-note triplet'],
] as const;

export function PerformanceTempo() {
  const { snapshot, disconnected } = useMonitorFeed(1000);
  const tempo = snapshot?.tempo;
  const [error, setError] = useState('');
  async function submit(command: Parameters<typeof sendTempo>[0]) {
    setError('');
    try {
      await sendTempo(command);
    } catch (cause) {
      setError(friendlyError(cause, 'change the performance tempo'));
    } finally {
      refreshMonitorFeed();
    }
  }
  return (
    <>
      <TempoSource
        state={tempo ?? undefined}
        disabled={disconnected}
        onSelect={(source) => {
          if (tempo)
            void submit(
              source === 'tap'
                ? { kind: 'tap' }
                : { kind: 'select', source, expected_revision: tempo.revision },
            );
        }}
      />
      {tempo && (
        <div className="grid gap-1">
          <Caption as="span">Echo repeats per tap</Caption>
          <Select
            value={tempo.tap_note ?? 'preset'}
            onValueChange={(note) => {
              const choice = tapNotes.find(
                ([value]) => (value ?? 'preset') === note,
              );
              if (choice)
                void submit({
                  kind: 'set_tap_note',
                  tap_note: choice[0],
                  expected_revision: tempo.revision,
                });
            }}
            disabled={disconnected}
          >
            <SelectTrigger aria-label="Echo repeats per tap">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tapNotes.map(([value, label]) => (
                <SelectItem key={value ?? 'preset'} value={value ?? 'preset'}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Caption as="span">
            Applies to synced Echo when Tap is the tempo source. Motion follows
            the beat.
          </Caption>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}
