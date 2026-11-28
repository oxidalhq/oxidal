import * as React from 'react';

import { EvenOutPanel } from './even-out';
import {
  LevelMatch,
  type LevelMatchState,
  SoundCheck,
  type SoundCheckItem,
} from './guitar-tools';

/** Runs a pretend measurement: progress 0–100 over `ms`, then done. */
function useMeasure(ms: number) {
  const [progress, setProgress] = React.useState<number | undefined>();
  const [done, setDone] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearInterval(timer.current)),
    [],
  );
  const start = () => {
    let p = 0;
    setDone(false);
    setProgress(0);
    timer.current = setInterval(() => {
      p += 10;
      if (p <= 100) return setProgress(p);
      if (timer.current) clearInterval(timer.current);
      setProgress(undefined);
      setDone(true);
    }, ms / 10);
  };
  return { progress, done, start, reset: () => setDone(false) };
}

const CHECKS: SoundCheckItem[] = [
  {
    ok: false,
    title: 'Input peaks at −3 dBFS',
    fix: 'Turn the interface gain down a little; aim for −12 when you play hard.',
    action: 'Show input meter',
  },
  {
    ok: false,
    title: 'Lead boost clips twice a minute',
    fix: "Lower that preset's Level by about 2 dB.",
    action: 'Open Lead boost',
  },
  {
    ok: true,
    title: 'No dropouts in the last hour',
    fix: '128 × 3 at 48 kHz is holding.',
  },
  {
    ok: true,
    title: 'Presets are within 1.5 dB of each other',
    fix: 'Even out ran on Monday.',
  },
];

export const SoundCheckDemo = () => <SoundCheck checks={CHECKS} />;

export function LevelMatchDemo() {
  const m = useMeasure(1600);
  const [kept, setKept] = React.useState<boolean | undefined>();
  const state: LevelMatchState =
    m.progress !== undefined
      ? { step: 'listening', progress: m.progress }
      : m.done
        ? {
            step: 'measured',
            before: '−13.8 dBFS',
            target: '−18.0 dBFS',
            level: '−4.0 dB',
          }
        : { step: 'ready', kept };
  return (
    <LevelMatch
      preset="Rhythm section"
      state={state}
      onStart={() => {
        setKept(undefined);
        m.start();
      }}
      onKeep={() => {
        setKept(true);
        m.reset();
      }}
      onUndo={() => {
        setKept(false);
        m.reset();
      }}
    />
  );
}

/** Measured before correction, and the correction a run stores. */
const LOUDNESS: [string, number, number][] = [
  ['Rhythm section · Verse', -18.2, -1.8],
  ['Rhythm section · Chorus', -16.9, -3.1],
  ['Ambient swell · Pad', -22.9, 2.6],
  ['Lead boost', -13.4, -6.5],
  ['Brown Crunch · Intro', -16.1, -3.8],
  ['Brown Crunch · Rhythm', -15.4, -4.7],
  ['Neon Clean', -21.0, 1.1],
  ['Doom Smoke · Lead', -14.6, -5.3],
];

/** Even out on sample sounds: a run measures for two seconds, then evens. */
export function EvenOutDemo() {
  const m = useMeasure(2000);
  return (
    <EvenOutPanel
      sounds={LOUDNESS.map(([name, lufs, offset]) => ({
        key: name,
        name,
        lufs,
        offset_db: m.done ? offset : 0,
      }))}
      target={m.done ? -20 : null}
      pending={m.done ? 0 : LOUDNESS.length}
      progress={{
        running: m.progress !== undefined,
        done: Math.round(((m.progress ?? 0) / 100) * LOUDNESS.length),
        total: LOUDNESS.length,
        current:
          LOUDNESS[
            Math.min(
              LOUDNESS.length - 1,
              Math.round(((m.progress ?? 0) / 100) * LOUDNESS.length),
            )
          ]![0],
      }}
      onAction={(action) => {
        if (action === 'run' || action === 'run_all') m.start();
        if (action === 'reset') m.reset();
      }}
    />
  );
}
