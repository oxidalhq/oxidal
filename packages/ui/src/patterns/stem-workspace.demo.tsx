import * as React from 'react';

import type { StemControls, StemRole } from '../widgets/stem-strip';
import {
  type StemImport,
  type StemMix,
  type StemSplit,
  StemWorkspace,
} from './stem-workspace';

const on = (level = 0): StemControls => ({ level, muted: false, solo: false });
const off: StemControls = { level: -60, muted: true, solo: false };
const ALL: StemRole[] = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
const full = (): StemMix =>
  Object.fromEntries(ALL.map((r) => [r, on()])) as StemMix;

const STARTS = [
  { id: 'noguitar', name: 'No guitar', mix: { ...full(), guitar: off } },
  { id: 'all', name: 'Every stem', mix: full() },
  {
    id: 'rhythm',
    name: 'Drums and bass',
    mix: {
      drums: on(),
      bass: on(-2),
      vocals: off,
      guitar: off,
      piano: off,
      other: off,
    },
  },
];

/** Stands in for the device: splits in a moment, saves mixes, imports files. */
export function StemWorkspaceDemo({
  split: ready = true,
}: {
  split?: boolean;
}) {
  const [split, setSplit] = React.useState<StemSplit>(
    ready ? { state: 'ready', count: 6 } : { state: 'none' },
  );
  const [saved, setSaved] = React.useState(['No guitar']);
  const [pending, setPending] = React.useState<StemImport | undefined>();
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearInterval(timer.current)),
    [],
  );
  return (
    <StemWorkspace
      song={{ name: 'Iron Pulse', length: '3:42' }}
      split={split}
      starts={STARTS}
      saved={saved}
      pendingImport={pending}
      onSplit={() => {
        let p = 0;
        setSplit({ state: 'splitting', progress: p });
        timer.current = setInterval(() => {
          p += 20;
          if (p <= 100) return setSplit({ state: 'splitting', progress: p });
          if (timer.current) clearInterval(timer.current);
          setSplit({ state: 'ready', count: 6 });
        }, 150);
      }}
      onSave={(name) => setSaved((s) => [...s, name])}
      onLink={() => {}}
      onImport={() =>
        setPending({
          song: 'Glass Room',
          files: ['drums.wav', 'bass.wav', 'keys.wav', 'vocals.wav'].map(
            (name) => ({ name, caption: '48 kHz · 2:58' }),
          ),
        })
      }
      onConfirmImport={() => setPending(undefined)}
      onCancelImport={() => setPending(undefined)}
    />
  );
}
