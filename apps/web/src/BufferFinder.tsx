import { useRef, useState } from 'react';
import type { StartAudio } from './api';
import { Button } from './components/ui/button';
import { BUFFER_SIZES, bufferMs } from './bufferTiming';
import { useMonitorReadings } from './monitorFeed';

type Stream = StartAudio['stream'];
type Buffer = { frames: number; periods: number };

const MIN_PERIODS = 2;
const START_MS = 15000;
const LISTEN_MS = 60000;

const ms = (n: number) => `${n.toFixed(1)} ms`;
const label = (b: Buffer) => `${b.frames} × ${b.periods}`;
function withBuffer(stream: Stream, b: Buffer): Stream {
  return {
    ...stream,
    input: { ...stream.input, period_frames: b.frames, periods: b.periods },
    output: { ...stream.output, period_frames: b.frames, periods: b.periods },
  };
}
/** Next smaller size the list offers, or null at the floor. */
function smaller(frames: number) {
  return [...BUFFER_SIZES].reverse().find((size) => size < frames) ?? null;
}

type Run = {
  base: Stream;
  good: Buffer;
  /** First shrink the period size, then the number of periods at the best size. */
  phase: 'frames' | 'periods';
  trial: {
    buffer: Buffer;
    since: number | null;
    xruns: number;
    deadlineMisses: number;
    invalidSamples: number;
    frames: number | null;
    startDeadline: number;
  } | null;
  log: string[];
  result: string | null;
};

/**
 * Guided search for the smallest buffer that runs without dropouts on this rig.
 * Steps the period size down through the sizes interfaces commonly accept (48 is
 * the usual 1 ms USB floor), then tries fewer periods at the best size. Each step
 * listens for xruns and the search keeps the last clean setting.
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

  function trial(next: Run, buffer: Buffer, note?: string) {
    void apply(withBuffer(next.base, buffer));
    setRun({
      ...next,
      trial: {
        buffer,
        since: null,
        xruns: 0,
        deadlineMisses: 0,
        invalidSamples: 0,
        frames: null,
        startDeadline: performance.now() + START_MS,
      },
      log: note ? [...next.log, note] : next.log,
    });
  }
  function settle(next: Run, note: string) {
    const t = next.trial?.buffer;
    if (!t || t.frames !== next.good.frames || t.periods !== next.good.periods)
      void apply(withBuffer(next.base, next.good));
    const at = withBuffer(next.base, next.good).input;
    setRun({
      ...next,
      trial: null,
      log: [...next.log, note],
      result: `Lowest stable buffer: ${label(next.good)} (${ms(bufferMs(at))}).`,
    });
  }
  /** After the period size bottoms out, try fewer periods at the best size. */
  function towardFewerPeriods(next: Run, note: string) {
    if (next.good.periods > MIN_PERIODS)
      trial(
        { ...next, phase: 'periods' },
        { frames: next.good.frames, periods: next.good.periods - 1 },
        note,
      );
    else settle(next, note);
  }
  function failed(r: Run, note: string) {
    // The failing setting is undone by the next trial or by settle.
    if (r.phase === 'frames') towardFewerPeriods(r, note);
    else settle(r, note);
  }

  useMonitorReadings(1000, (feed) => {
    const r = current.current;
    const t = r?.trial;
    if (!r || !t) return;
    const snap = feed.snapshot;
    const now = performance.now();
    const live =
      snap?.stream?.input.period_frames === t.buffer.frames &&
      snap.stream.input.periods === t.buffer.periods &&
      [snap.audio_phase, snap.rig_phase, snap.graph_phase].includes('running');
    if (!live) {
      if (t.since != null) {
        failed(r, `${label(t.buffer)}: audio stopped or restarted.`);
        return;
      }
      if (now > t.startDeadline)
        failed(
          r,
          `${label(t.buffer)}: the interface refused it or audio did not start.`,
        );
      return;
    }
    const xruns = snap.audio?.xruns ?? snap.xruns ?? 0;
    const deadlineMisses = snap.audio?.deadline_misses ?? 0;
    const invalidSamples = snap.audio?.invalid_samples ?? 0;
    const frames = snap.audio?.frames ?? null;
    if (t.since == null) {
      setRun({
        ...r,
        trial: {
          ...t,
          since: now,
          xruns,
          deadlineMisses,
          invalidSamples,
          frames,
        },
      });
      return;
    }
    if (frames != null && t.frames != null && frames < t.frames) {
      failed(r, `${label(t.buffer)}: the audio worker restarted.`);
      return;
    }
    if (xruns > t.xruns) {
      failed(
        r,
        `${label(t.buffer)}: ${xruns - t.xruns} dropout${xruns - t.xruns === 1 ? '' : 's'}.`,
      );
      return;
    }
    if (deadlineMisses > t.deadlineMisses) {
      failed(
        r,
        `${label(t.buffer)}: ${deadlineMisses - t.deadlineMisses} audio deadline ${deadlineMisses - t.deadlineMisses === 1 ? 'miss' : 'misses'}.`,
      );
      return;
    }
    if (invalidSamples > t.invalidSamples) {
      failed(r, `${label(t.buffer)}: invalid audio samples detected.`);
      return;
    }
    if (frames !== t.frames) setRun({ ...r, trial: { ...t, frames } });
    if (now - t.since < LISTEN_MS) return;
    const passed = { ...r, good: t.buffer };
    const note = `${label(t.buffer)}: clean for ${LISTEN_MS / 1000} s.`;
    const next = r.phase === 'frames' ? smaller(t.buffer.frames) : null;
    if (next != null)
      trial(passed, { frames: next, periods: t.buffer.periods }, note);
    else if (r.phase === 'frames') towardFewerPeriods(passed, note);
    else if (t.buffer.periods > MIN_PERIODS)
      trial(passed, { ...t.buffer, periods: t.buffer.periods - 1 }, note);
    else settle(passed, note);
  });

  const testing = !!run?.trial;
  const now: Buffer = {
    frames: stream.input.period_frames,
    periods: stream.input.periods,
  };
  const first = smaller(now.frames);
  return (
    <div className="control-stack" aria-label="Find lowest stable buffer">
      <p className="caption">
        Buffer now: {now.frames} samples × {now.periods} at{' '}
        {stream.input.sample_rate} Hz = {ms(bufferMs(stream.input))}. Smaller is
        snappier under your fingers but needs more processing headroom.
      </p>
      {testing ? (
        <>
          <p role="status">
            Testing {label(run.trial!.buffer)}
            {run.trial!.since == null
              ? ' · starting audio…'
              : ' · listening for dropouts…'}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              const r = current.current!;
              settle(
                {
                  ...r,
                  trial: { ...r.trial!, buffer: { frames: -1, periods: -1 } },
                },
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
            disabled ||
            !running ||
            (first == null && now.periods <= MIN_PERIODS)
          }
          onClick={() => {
            const base: Run = {
              base: stream,
              good: now,
              phase: first == null ? 'periods' : 'frames',
              trial: null,
              log: [],
              result: null,
            };
            if (first == null)
              trial(base, { frames: now.frames, periods: now.periods - 1 });
            else trial(base, { frames: first, periods: now.periods });
          }}
        >
          Find lowest stable buffer
        </Button>
      )}
      {!testing && (
        <p className="caption">
          Restarts audio several times: first smaller sizes, then fewer periods.
          Each running step listens for one minute and rejects xruns, deadline
          misses, invalid samples, stopped audio or a worker restart. Load your
          heaviest preset first. You don&apos;t need to play: processing load is
          the same in silence.
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
