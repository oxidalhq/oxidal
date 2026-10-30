import { useRef, useState } from 'react';
import type { StartAudio } from './api';
import { Button } from './components/ui/button';
import { bufferMs } from './bufferTiming';
import { useMonitorReadings } from './monitorFeed';

type Stream = StartAudio['stream'];

const FLOOR = 32;
const START_MS = 15000;
const LISTEN_MS = 20000;

const ms = (n: number) => `${n.toFixed(1)} ms`;
function withFrames(stream: Stream, frames: number): Stream {
  return {
    ...stream,
    input: { ...stream.input, period_frames: frames },
    output: { ...stream.output, period_frames: frames },
  };
}

type Run = {
  base: Stream;
  good: number;
  trial: {
    frames: number;
    since: number | null;
    xruns: number;
    deadline: number;
  } | null;
  log: string[];
  result: string | null;
};

/**
 * Guided search for the smallest buffer that runs without dropouts on this rig.
 * Halves the buffer, listens for xruns, and settles on the last clean size.
 * @see docs/audio.md
 */
export function BufferFinder({
  stream,
  running,
  disabled,
  apply,
}: {
  stream: Stream;
  running: boolean;
  disabled: boolean;
  apply: (stream: Stream) => Promise<unknown> | void;
}) {
  const [run, setState] = useState<Run | null>(null);
  // Readings can arrive before React re-renders, so the machine keeps its own copy.
  const current = useRef(run);
  function setRun(next: Run) {
    current.current = next;
    setState(next);
  }

  function trial(next: Run, frames: number, note?: string) {
    void apply(withFrames(next.base, frames));
    setRun({
      ...next,
      trial: {
        frames,
        since: null,
        xruns: 0,
        deadline: performance.now() + START_MS,
      },
      log: note ? [...next.log, note] : next.log,
    });
  }
  function settle(next: Run, note: string) {
    if (next.good !== next.trial?.frames)
      void apply(withFrames(next.base, next.good));
    const at = withFrames(next.base, next.good).input;
    setRun({
      ...next,
      trial: null,
      log: [...next.log, note],
      result: `Lowest stable buffer: ${next.good} samples × ${at.periods} (${ms(bufferMs(at))}).`,
    });
  }

  useMonitorReadings(1000, (feed) => {
    const r = current.current;
    const t = r?.trial;
    if (!r || !t) return;
    const snap = feed.snapshot;
    const now = performance.now();
    const live =
      snap?.stream?.input.period_frames === t.frames &&
      [snap.audio_phase, snap.rig_phase, snap.graph_phase].includes('running');
    if (!live) {
      if (now > t.deadline)
        settle(
          r,
          `${t.frames} samples: the interface refused it or audio did not start.`,
        );
      return;
    }
    const xruns = snap.audio?.xruns ?? snap.xruns ?? 0;
    if (t.since == null) {
      setRun({ ...r, trial: { ...t, since: now, xruns } });
      return;
    }
    if (xruns > t.xruns) {
      settle(
        r,
        `${t.frames} samples: ${xruns - t.xruns} dropout${xruns - t.xruns === 1 ? '' : 's'}.`,
      );
      return;
    }
    if (now - t.since < LISTEN_MS) return;
    const passed = { ...r, good: t.frames };
    const note = `${t.frames} samples: clean for ${LISTEN_MS / 1000} s.`;
    if (t.frames / 2 < FLOOR) settle(passed, note);
    else trial(passed, t.frames / 2, note);
  });

  const testing = !!run?.trial;
  const start = withFrames(stream, stream.input.period_frames);
  return (
    <div className="control-stack" aria-label="Find lowest stable buffer">
      <p className="caption">
        Buffer now: {stream.input.period_frames} samples ×{' '}
        {stream.input.periods} at {stream.input.sample_rate} Hz ={' '}
        {ms(bufferMs(stream.input))}. Smaller is snappier under your fingers but
        needs more processing headroom.
      </p>
      {testing ? (
        <>
          <p role="status">
            Testing {run.trial!.frames} samples
            {run.trial!.since == null
              ? ' · starting audio…'
              : ' · listening for dropouts…'}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              const r = current.current!;
              settle(
                { ...r, trial: { ...r.trial!, frames: -1 } },
                'Stopped by you.',
              );
            }}
          >
            Stop test
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          disabled={
            disabled || !running || start.input.period_frames / 2 < FLOOR
          }
          onClick={() => {
            const base = stream;
            trial(
              {
                base,
                good: base.input.period_frames,
                trial: null,
                log: [],
                result: null,
              },
              base.input.period_frames / 2,
            );
          }}
        >
          Find lowest stable buffer
        </Button>
      )}
      {!testing && (
        <p className="caption">
          Restarts audio several times, about 20 seconds per step, then keeps
          the smallest buffer with no dropouts. Load your heaviest preset first.
          You don&apos;t need to play: processing load is the same in silence.
        </p>
      )}
      {run && run.log.length > 0 && (
        <ul className="caption">
          {run.log.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      {run?.result && <p role="status">{run.result}</p>}
    </div>
  );
}
