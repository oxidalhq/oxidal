import {
  CornersIn,
  CornersOut,
  Minus,
  Moon,
  Plus,
  Sun,
} from '@phosphor-icons/react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Segment,
  SegmentedControl,
} from '@oxidal/design-system/components/segmented';
import { StateNotice } from '@oxidal/design-system/components/states';

import './Tuner.css';
import { AdjustmentDialog } from './AdjustmentDialog';
import { tuner, type TunerState } from './api';
import { errorDetails } from './lib/friendlyError';

const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** Within this many cents the note counts as in tune. */
const LOCK = 1;
/** Bars on the coarse strobe ring; the fine ring has twice as many. */
const BARS = 24;
/** Coarse bars passed per second for each cent of error. */
const DRIFT = 0.08;
/** Length of one wave of the sine trace, in dial units. */
const WAVE = 44;
/** A reading is kept this long after the note fades, so the name stays up. */
const HOLD_MS = 700;

type Look = 'night' | 'day';
type Pitch = { note: number; cents: number; frequency: number; at: number };

function recall(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* viewing preferences are optional */
  }
}

/**
 * Oxidal's tuner: a strobe on the raw guitar input of whatever is playing. It
 * mutes the outputs while open, can fill the screen, and has a dark look for
 * the stage and a high-contrast one for daylight.
 * @see docs/audio.md
 */
export function GlobalTuner({
  onClose,
  slow = false,
}: {
  onClose: () => void;
  slow?: boolean;
}) {
  const [state, setState] = useState<TunerState | null>(null);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(true);
  const [full, setFull] = useState(() => recall('oxidal.tuner.full') === '1');
  const [look, setLook] = useState<Look>(() =>
    recall('oxidal.tuner.look') === 'day' ? 'day' : 'night',
  );
  const [a4, setA4] = useState(() => {
    const stored = Number(recall('oxidal.tuner.a4'));
    return stored >= 430 && stored <= 450 ? stored : 440;
  });
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [starting, setStarting] = useState(false);
  const wantMuted = useRef(true);
  const mutedBefore = useRef<boolean | null>(null);
  const lastStart = useRef(0);
  const startFailure = useRef('');
  const reference = useRef(a4);
  useEffect(() => {
    reference.current = a4;
  }, [a4]);

  const take = useEffectEvent((next: TunerState) => {
    setState(next);
    const reading = next.reading;
    const now = performance.now();
    if (!reading || reading.frequency <= 0 || reading.confidence < 0.7) {
      setPitch((held) => (held && now - held.at < HOLD_MS ? held : null));
      return;
    }
    const exact = 69 + 12 * Math.log2(reading.frequency / reference.current);
    const note = Math.round(exact);
    const cents = (exact - note) * 100;
    setPitch((held) => ({
      note,
      // Steady the last digit without lagging a turning peg.
      cents:
        held && held.note === note && Math.abs(held.cents - cents) < 3
          ? held.cents + (cents - held.cents) * 0.6
          : cents,
      frequency: reading.frequency,
      at: now,
    }));
  });
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        let next = await tuner();
        if (!active) return;
        if (!next)
          throw new Error(
            'This unit’s software has no Oxidal tuner yet. Update it.',
          );
        // Start listening: under whatever plays, or, with nothing playing,
        // in the tuner's own silent session. A preset change starts a new
        // audio session, so this also listens again there.
        if (!next.enabled && performance.now() > lastStart.current) {
          if (next.available && mutedBefore.current === null)
            mutedBefore.current = next.output_muted;
          // Opening the interface can fail (unplugged): do not hammer it.
          lastStart.current =
            performance.now() + (next.available ? 1000 : 5000);
          setStarting(!next.available);
          try {
            next =
              (await tuner({
                enabled: true,
                output_muted: wantMuted.current,
              })) ?? next;
            startFailure.current = '';
          } catch (cause) {
            startFailure.current = errorDetails(cause);
          }
          if (!active) return;
        }
        take(next);
        // A failed start stays on screen between the spaced-out retries.
        setError(next.enabled ? '' : startFailure.current);
      } catch (cause) {
        if (active) setError(errorDetails(cause));
      } finally {
        if (active) setStarting(false);
        if (active) timer = setTimeout(() => void poll(), slow ? 1000 : 100);
      }
    }
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [slow]);

  async function monitor(next: boolean) {
    if (next === muted) return;
    wantMuted.current = next;
    setMuted(next);
    try {
      await tuner({ enabled: true, output_muted: next });
    } catch (cause) {
      setError(errorDetails(cause));
    }
  }
  async function close() {
    try {
      if (state?.available && !state.standalone)
        await tuner({
          enabled: false,
          output_muted: mutedBefore.current ?? false,
        });
      else if (state?.standalone) await tuner({ enabled: false });
    } catch {
      /* Closing never waits on a stopped engine. */
    }
    onClose();
  }
  function tune(next: number) {
    const value = Math.min(450, Math.max(430, next));
    setA4(value);
    remember('oxidal.tuner.a4', String(value));
  }

  const listening = !!state?.available && !error;
  const inTune = pitch !== null && Math.abs(pitch.cents) <= LOCK;
  const shown = pitch === null ? null : Math.round(pitch.cents * 10) / 10;
  const name = pitch === null ? '—' : NOTES[((pitch.note % 12) + 12) % 12]!;
  const octave = pitch === null ? '' : String(Math.floor(pitch.note / 12) - 1);
  return (
    <AdjustmentDialog
      title="Tuner"
      className={full ? 'tuner-dialog tuner-full' : 'tuner-dialog'}
      onCancel={() => void close()}
    >
      <div className="tuner" data-look={look} data-in-tune={inTune}>
        <div className="tuner-face">
          <Dial
            cents={pitch?.cents ?? null}
            name={name}
            octave={octave}
            still={slow}
          />
          <div
            role="meter"
            aria-label="Tuning cents"
            aria-valuemin={-50}
            aria-valuemax={50}
            aria-valuenow={shown ?? 0}
            aria-valuetext={shown === null ? 'No clear note' : `${shown} cents`}
            className="tuner-reading"
          >
            <span
              className="tuner-side"
              data-on={shown !== null && shown < -LOCK}
            >
              ◀ flat
            </span>
            <strong aria-live="polite">
              {shown === null
                ? listening
                  ? 'Play one string'
                  : starting || !state
                    ? 'Opening the input…'
                    : 'Not listening'
                : inTune
                  ? 'In tune'
                  : `${shown > 0 ? '+' : '−'}${Math.abs(shown).toFixed(1)} cents`}
            </strong>
            <span
              className="tuner-side"
              data-on={shown !== null && shown > LOCK}
            >
              sharp ▶
            </span>
          </div>
          <p className="tuner-hz">
            {pitch ? `${pitch.frequency.toFixed(2)} Hz · ` : ''}A4 = {a4} Hz
          </p>
        </div>
        {error && (
          <StateNotice kind="error" title="Tuner unavailable">
            {error}
          </StateNotice>
        )}
        {state?.standalone && !error && (
          <p className="caption tuner-alone">
            Nothing is playing, so the tuner opened the input by itself and
            stays silent.
          </p>
        )}
        <div className="tuner-controls">
          <SegmentedControl
            aria-label="Tuner monitoring"
            value={muted || state?.standalone ? 'mute' : 'hear'}
            disabled={!listening || !!state?.standalone}
            onValueChange={(value) => {
              if (value) void monitor(value === 'mute');
            }}
          >
            <Segment value="mute">Mute</Segment>
            <Segment value="hear">Hear sound</Segment>
          </SegmentedControl>
          <div className="tuner-a4" role="group" aria-label="Reference pitch">
            <Button
              variant="outline"
              aria-label="Lower reference pitch"
              disabled={a4 <= 430}
              onClick={() => tune(a4 - 1)}
            >
              <Minus aria-hidden="true" />
            </Button>
            <span>A4 {a4}</span>
            <Button
              variant="outline"
              aria-label="Raise reference pitch"
              disabled={a4 >= 450}
              onClick={() => tune(a4 + 1)}
            >
              <Plus aria-hidden="true" />
            </Button>
          </div>
          <Button
            variant="outline"
            aria-pressed={look === 'day'}
            onClick={() => {
              const next = look === 'day' ? 'night' : 'day';
              setLook(next);
              remember('oxidal.tuner.look', next);
            }}
          >
            {look === 'day' ? (
              <Moon aria-hidden="true" />
            ) : (
              <Sun aria-hidden="true" />
            )}
            {look === 'day' ? 'Night look' : 'Day look'}
          </Button>
          <Button
            variant="outline"
            aria-pressed={full}
            onClick={() => {
              setFull(!full);
              remember('oxidal.tuner.full', full ? '0' : '1');
            }}
          >
            {full ? (
              <CornersIn aria-hidden="true" />
            ) : (
              <CornersOut aria-hidden="true" />
            )}
            {full ? 'Smaller' : 'Full screen'}
          </Button>
        </div>
      </div>
    </AdjustmentDialog>
  );
}

/** One sine trace, wide enough to slide a whole wave either way. */
const TRACE =
  '-44,178.00 -42,179.97 -40,181.78 -38,183.29 -36,184.37 -34,184.93 -32,184.93 -30,184.37 -28,183.29 -26,181.78 -24,179.97 -22,178.00 -20,176.03 -18,174.22 -16,172.71 -14,171.63 -12,171.07 -10,171.07 -8,171.63 -6,172.71 -4,174.22 -2,176.03 0,178.00 2,179.97 4,181.78 6,183.29 8,184.37 10,184.93 12,184.93 14,184.37 16,183.29 18,181.78 20,179.97 22,178.00 24,176.03 26,174.22 28,172.71 30,171.63 32,171.07 34,171.07 36,171.63 38,172.71 40,174.22 42,176.03 44,178.00 46,179.97 48,181.78 50,183.29 52,184.37 54,184.93 56,184.93 58,184.37 60,183.29 62,181.78 64,179.97 66,178.00 68,176.03 70,174.22 72,172.71 74,171.63 76,171.07 78,171.07 80,171.63 82,172.71 84,174.22 86,176.03 88,178.00 90,179.97 92,181.78 94,183.29 96,184.37 98,184.93 100,184.93 102,184.37 104,183.29 106,181.78 108,179.97 110,178.00 112,176.03 114,174.22 116,172.71 118,171.63 120,171.07 122,171.07 124,171.63 126,172.71 128,174.22 130,176.03 132,178.00 134,179.97 136,181.78 138,183.29 140,184.37 142,184.93 144,184.93 146,184.37 148,183.29 150,181.78 152,179.97 154,178.00 156,176.03 158,174.22 160,172.71 162,171.63 164,171.07 166,171.07 168,171.63 170,172.71 172,174.22 174,176.03 176,178.00 178,179.97 180,181.78 182,183.29 184,184.37 186,184.93 188,184.93 190,184.37 192,183.29 194,181.78 196,179.97 198,178.00 200,176.03 202,174.22 204,172.71 206,171.63 208,171.07 210,171.07 212,171.63 214,172.71 216,174.22 218,176.03 220,178.00 222,179.97 224,181.78 226,183.29 228,184.37 230,184.93 232,184.93 234,184.37 236,183.29 238,181.78 240,179.97 242,178.00 244,176.03 246,174.22 248,172.71 250,171.63 252,171.07 254,171.07 256,171.63 258,172.71 260,174.22 262,176.03 264,178.00 266,179.97 268,181.78 270,183.29 272,184.37 274,184.93 276,184.93 278,184.37 280,183.29 282,181.78 284,179.97';

/**
 * The dial. Two strobe rings turn clockwise when the note is sharp and the
 * other way when it is flat, faster the further out it is, and stand still in
 * tune. Below the note a sine trace slides the same way against a fixed, dim
 * reference trace; in tune the two lie on top of each other. On E-paper
 * nothing animates: rings and trace sit offset by the error.
 */
function Dial({
  cents,
  name,
  octave,
  still,
}: {
  cents: number | null;
  name: string;
  octave: string;
  still: boolean;
}) {
  const rings = useRef<SVGGElement | null>(null);
  const trace = useRef<SVGPolylineElement | null>(null);
  const target = useRef(cents);
  const [calm] = useState(
    () =>
      typeof requestAnimationFrame !== 'function' ||
      (typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches),
  );
  const fixed = still || calm;
  useEffect(() => {
    target.current = cents;
    // Without motion: half a bar and half a wave out at 50 cents.
    if (fixed) place(rings.current, trace.current, ((cents ?? 0) / 100) * 0.5);
  }, [cents, fixed]);
  useEffect(() => {
    if (fixed) return;
    let phase = 0;
    let before = performance.now();
    let frame = requestAnimationFrame(function step(now: number) {
      const elapsed = Math.min(0.1, (now - before) / 1000);
      before = now;
      phase += (target.current ?? 0) * DRIFT * elapsed;
      place(rings.current, trace.current, phase);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [fixed]);
  return (
    <svg
      className="tuner-dial"
      viewBox="0 0 240 240"
      data-idle={cents === null}
    >
      <defs>
        <clipPath id="tuner-window">
          <circle cx="120" cy="120" r="80" />
        </clipPath>
      </defs>
      <g ref={rings} className="tuner-rings" aria-hidden="true">
        <circle
          cx="120"
          cy="120"
          r="104"
          pathLength={BARS * 2}
          strokeDasharray="1 1"
          strokeWidth="9"
        />
        <circle
          cx="120"
          cy="120"
          r="92"
          pathLength={BARS * 4}
          strokeDasharray="1 1"
          strokeWidth="6"
        />
      </g>
      <path
        className="tuner-mark"
        d="M113 0 L127 0 L120 11 Z"
        aria-hidden="true"
      />
      <g clipPath="url(#tuner-window)" aria-hidden="true">
        <polyline className="tuner-trace-reference" points={TRACE} />
        <polyline ref={trace} className="tuner-trace" points={TRACE} />
      </g>
      <text className="tuner-note" x="120" y="138" aria-label="Detected note">
        <tspan>{name}</tspan>
        <tspan className="tuner-octave" dy="-2">
          {octave}
        </tspan>
      </text>
    </svg>
  );
}

/** Turns the rings and slides the trace; `phase` is in coarse bars passed. */
function place(
  rings: SVGGElement | null,
  trace: SVGPolylineElement | null,
  phase: number,
) {
  rings?.setAttribute(
    'transform',
    `rotate(${(((phase * 360) / BARS) % 360).toFixed(2)} 120 120)`,
  );
  const slide = (((phase * WAVE) % WAVE) + WAVE) % WAVE;
  trace?.setAttribute('transform', `translate(${slide.toFixed(2)} 0)`);
}
