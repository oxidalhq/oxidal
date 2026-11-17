import * as React from 'react';
import {
  EvenOut,
  LevelMatch,
  SoundCheck,
  type LevelMatchState,
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
            before: '−13.8 LUFS',
            target: '−18.0 LUFS',
            level: '−4.2 dB',
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

const LOUDNESS = [
  ['Rhythm section', -18.2, -18.0],
  ['Ambient swell', -22.9, -18.3],
  ['Lead boost', -13.4, -17.6],
  ['Brown Crunch', -16.1, -18.1],
  ['Neon Clean', -21.0, -18.4],
] as const;

export function EvenOutDemo() {
  const m = useMeasure(2000);
  return (
    <EvenOut
      presets={LOUDNESS.map(([name, before, after]) => ({
        name,
        lufs: m.done ? after : before,
      }))}
      progress={m.progress}
      evened={m.done}
      scenes={14}
      onStart={m.start}
    />
  );
}
