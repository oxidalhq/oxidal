import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  CornersIn,
  CornersOut,
  Minus,
  Moon,
  Plus,
  Sun,
  WarningCircle,
} from '@phosphor-icons/react';
import { tuner, type TunerState } from './api';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import { Button } from './components/ui/button';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';
import { errorDetails } from './lib/friendlyError';
import './Tuner.css';

const NOTES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
/** Within this many cents the note counts as in tune. */
const LOCK = 1;
/** Strobe rows, slowest first: each row has twice the bars of the one before. */
const ROWS = [1, 2, 4, 8];
/** Bar patterns across the first row. */
const BASE_BARS = 4;
/** Bar patterns passed per second for each cent of error, on the first row. */
const DRIFT = 0.08;
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
  const wantMuted = useRef(true);
  const mutedBefore = useRef<boolean | null>(null);
  const lastStart = useRef(0);
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
        // A preset change starts a new audio session: listen again there.
        if (
          next.available &&
          !next.enabled &&
          performance.now() - lastStart.current > 1000
        ) {
          if (mutedBefore.current === null)
            mutedBefore.current = next.output_muted;
          lastStart.current = performance.now();
          next =
            (await tuner({
              enabled: true,
              output_muted: wantMuted.current,
            })) ?? next;
          if (!active) return;
        }
        take(next);
        setError('');
      } catch (cause) {
        if (active) setError(errorDetails(cause));
      } finally {
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
      if (state?.available)
        await tuner({
          enabled: false,
          output_muted: mutedBefore.current ?? false,
        });
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
      className={`tuner-dialog${full ? ' tuner-full' : ''}`}
      onCancel={() => void close()}
    >
      <div className="tuner" data-look={look} data-in-tune={inTune}>
        <div className="tuner-face">
          <div className="tuner-note" aria-label="Detected note">
            <span>{name}</span>
            <sub>{octave}</sub>
          </div>
          <Strobe cents={pitch?.cents ?? null} still={slow} />
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
        {(error || (state && !state.available)) && (
          <Alert variant="warning" role="alert">
            <WarningCircle aria-hidden="true" />
            <AlertTitle>
              {error ? 'Tuner unavailable' : 'Play a preset to tune'}
            </AlertTitle>
            <AlertDescription className="break-words text-current">
              {error ||
                'The tuner listens to the guitar input while audio runs. Start any preset, with or without a TONE3000 tone; this view starts listening by itself.'}
            </AlertDescription>
          </Alert>
        )}
        <div className="tuner-controls">
          <ToggleGroup
            type="single"
            aria-label="Tuner monitoring"
            value={muted ? 'mute' : 'hear'}
            disabled={!listening}
            onValueChange={(value) => {
              if (value) void monitor(value === 'mute');
            }}
          >
            <ToggleGroupItem value="mute">Mute</ToggleGroupItem>
            <ToggleGroupItem value="hear">Hear sound</ToggleGroupItem>
          </ToggleGroup>
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

/**
 * The strobe: rows of bars that drift right when the note is sharp, left when
 * it is flat, faster the further out it is, and stand still when it is in
 * tune. On E-paper the rows do not animate; they sit offset by the error.
 */
function Strobe({ cents, still }: { cents: number | null; still: boolean }) {
  const rows = useRef<(HTMLDivElement | null)[]>([]);
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
    // Without motion the rows sit offset by the error: half a bar at 50 cents.
    if (fixed) place(rows.current, ((cents ?? 0) / 100) * 0.5);
  }, [cents, fixed]);
  useEffect(() => {
    if (fixed) return;
    let phase = 0;
    let before = performance.now();
    let frame = requestAnimationFrame(function step(now: number) {
      const elapsed = Math.min(0.1, (now - before) / 1000);
      before = now;
      phase += (target.current ?? 0) * DRIFT * elapsed;
      place(rows.current, phase);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [fixed]);
  return (
    <div className="tuner-strobe" data-idle={cents === null} aria-hidden="true">
      {ROWS.map((bars, index) => (
        <div
          key={bars}
          ref={(node) => {
            rows.current[index] = node;
          }}
          className="tuner-strobe-row"
          style={{ '--bars': bars * BASE_BARS } as CSSProperties}
        />
      ))}
      <span className="tuner-strobe-mark" />
    </div>
  );
}

/** Moves every row the same distance: `phase` is in first-row bar patterns. */
function place(rows: (HTMLDivElement | null)[], phase: number) {
  rows.forEach((row, index) => {
    if (!row) return;
    const width = row.clientWidth;
    const pattern = width / (BASE_BARS * ROWS[index]!);
    const moved = (phase * width) / BASE_BARS;
    row.style.backgroundPositionX = `${(((moved % pattern) + pattern) % pattern).toFixed(2)}px`;
  });
}
