import * as React from 'react';
import {
  AudioChange,
  type AudioChangePhase,
  type AudioSetting,
  type BufferTrial,
} from './audio-change';

const TRIALS: BufferTrial[] = [
  { frames: 128, periods: 3, xruns: 0 },
  { frames: 96, periods: 3, xruns: 0 },
  { frames: 64, periods: 3, xruns: 2 },
  { frames: 96, periods: 2, xruns: 0 },
];

/** Stands in for the device: restarts, proves for 15 s, finds a buffer. */
export function AudioChangeDemo({
  initial = { rate: 48000, frames: 128, periods: 3 },
}: {
  initial?: AudioSetting;
}) {
  const [current, setCurrent] = React.useState(initial);
  const [phase, setPhase] = React.useState<AudioChangePhase>('idle');
  const [left, setLeft] = React.useState(15);
  const [tried, setTried] = React.useState(-1);
  const before = React.useRef(initial);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const finder = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      if (finder.current) clearInterval(finder.current);
    },
    [],
  );
  const apply = (next: AudioSetting) => {
    before.current = current;
    setCurrent(next);
    setPhase('restarting');
    let n = 15;
    setLeft(n);
    timer.current = setTimeout(() => {
      setPhase('proving');
      timer.current = setInterval(() => {
        n -= 1;
        setLeft(n);
        if (n <= 0) {
          if (timer.current) clearInterval(timer.current);
          setCurrent(before.current);
          setPhase('idle');
        }
      }, 1000);
    }, 600) as unknown as ReturnType<typeof setInterval>;
  };
  return (
    <AudioChange
      current={current}
      phase={phase}
      secondsLeft={left}
      onApply={apply}
      onSettle={(keep) => {
        if (timer.current) clearInterval(timer.current);
        if (!keep) setCurrent(before.current);
        setPhase('idle');
      }}
      finder={{
        trials: TRIALS.slice(0, Math.max(0, tried)),
        total: TRIALS.length,
        state: tried < 0 ? 'idle' : tried >= TRIALS.length ? 'done' : 'running',
        onStart: () => {
          let n = 0;
          setTried(0);
          finder.current = setInterval(() => {
            n += 1;
            setTried(n);
            if (n >= TRIALS.length && finder.current)
              clearInterval(finder.current);
          }, 700);
        },
        onCancel: () => {
          if (finder.current) clearInterval(finder.current);
          setTried(-1);
        },
      }}
    />
  );
}
