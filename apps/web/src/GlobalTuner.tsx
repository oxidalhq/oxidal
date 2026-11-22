import {
  CornersIn,
  CornersOut,
  Minus,
  Moon,
  Plus,
  Sun,
} from '@phosphor-icons/react';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Segment,
  SegmentedControl,
} from '@oxidal/design-system/components/segmented';
import { StateNotice } from '@oxidal/design-system/components/states';
import { TunerFace } from '@oxidal/design-system/widgets/tuner-face';

import { AdjustmentDialog } from './AdjustmentDialog';
import { tuner, type TunerState } from './api';
import { errorDetails } from './lib/friendlyError';

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
function useTunerOwner(watch: boolean, start: boolean, slow: boolean) {
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
  const owned = useRef<TunerState | null>(null);
  const opening = useRef<Promise<TunerState | null> | null>(null);
  const closing = useRef(false);
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
    if (!watch) return;
    closing.current = false;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        let next = await tuner();
        if (!active || closing.current) return;
        if (!next)
          throw new Error(
            'This unit’s software has no Oxidal tuner yet. Update it.',
          );
        // Start listening: under whatever plays, or, with nothing playing,
        // in the tuner's own silent session. A preset change starts a new
        // audio session, so this also listens again there.
        if (start && !next.enabled && performance.now() > lastStart.current) {
          if (next.available && mutedBefore.current === null)
            mutedBefore.current = next.output_muted;
          // Opening the interface can fail (unplugged): do not hammer it.
          lastStart.current =
            performance.now() + (next.available ? 1000 : 5000);
          setStarting(!next.available);
          try {
            opening.current = tuner({
              enabled: true,
              output_muted: wantMuted.current,
            });
            const started = await opening.current;
            if (started?.enabled) owned.current = started;
            next = started ?? next;
            startFailure.current = '';
          } catch (cause) {
            startFailure.current = errorDetails(cause);
          } finally {
            opening.current = null;
          }
          if (!active) return;
        }
        if (closing.current) return;
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
  }, [slow, watch, start]);

  async function monitor(next: boolean) {
    if (!state?.enabled || next === state.output_muted) return;
    wantMuted.current = next;
    setMuted(next);
    try {
      const changed = await tuner({ enabled: true, output_muted: next });
      if (changed) setState(changed);
    } catch (cause) {
      setError(errorDetails(cause));
    }
  }
  async function close() {
    closing.current = true;
    try {
      await opening.current;
      const session = owned.current;
      if (session?.standalone) await tuner({ enabled: false });
      else if (session?.available)
        await tuner({
          enabled: false,
          output_muted: mutedBefore.current ?? session.output_muted,
        });
    } catch (cause) {
      setError(errorDetails(cause));
    }
    owned.current = null;
    mutedBefore.current = null;
    lastStart.current = 0;
    wantMuted.current = true;
  }
  function tune(next: number) {
    const value = Math.min(450, Math.max(430, next));
    setA4(value);
    remember('oxidal.tuner.a4', String(value));
  }

  const listening = watch && !!state?.available && !!state.enabled && !error;
  return {
    state,
    pitch,
    error,
    muted: state?.enabled ? state.output_muted : muted,
    full,
    setFull,
    look,
    setLook,
    a4,
    tune,
    starting,
    monitor,
    close,
    listening,
  };
}

type Owner = ReturnType<typeof useTunerOwner>;
const TunerContext = createContext<Owner | null>(null);

export function TunerProvider({
  watch,
  start,
  slow,
  children,
}: {
  watch: boolean;
  start: boolean;
  slow: boolean;
  children: ReactNode;
}) {
  const owner = useTunerOwner(watch, start, slow);
  return (
    <TunerContext.Provider value={owner}>{children}</TunerContext.Provider>
  );
}

export function TunerTool({
  onStart,
  stage = false,
}: {
  onStart: () => void;
  stage?: boolean;
}) {
  const owner = useContext(TunerContext);
  if (!owner) return null;
  const { state, pitch, error, a4, look, monitor, listening } = owner;
  return (
    <>
      <TunerFace
        size={stage ? 'lg' : 'md'}
        note={listening ? (pitch?.note ?? null) : null}
        cents={pitch?.cents ?? 0}
        frequency={pitch?.frequency}
        reference={a4}
        day={look === 'day'}
        muted={state?.output_muted}
        onMuted={
          listening && !state?.standalone
            ? (next) => void monitor(next)
            : undefined
        }
      />
      {error && <p role="alert">{error}</p>}
      <Button variant="outline" onClick={onStart}>
        {listening ? 'Tuner controls' : 'Start tuning'}
      </Button>
    </>
  );
}

export function GlobalTuner({
  onClose,
  slow = false,
}: {
  onClose: () => void;
  slow?: boolean;
}) {
  const owner = useContext(TunerContext);
  if (!owner)
    return (
      <TunerProvider watch start slow={slow}>
        <GlobalTuner onClose={onClose} slow={slow} />
      </TunerProvider>
    );
  return <TunerDialog owner={owner} slow={slow} onClose={onClose} />;
}

function TunerDialog({
  owner,
  slow,
  onClose,
}: {
  owner: Owner;
  slow: boolean;
  onClose: () => void;
}) {
  const {
    state,
    pitch,
    error,
    muted,
    full,
    setFull,
    look,
    setLook,
    a4,
    tune,
    starting,
    monitor,
    close,
    listening,
  } = owner;
  const idleLabel = listening
    ? 'Play one string'
    : starting || !state
      ? 'Opening the input…'
      : 'Not listening';
  return (
    <AdjustmentDialog
      title="Tuner"
      className={
        full
          ? `top-0! left-0 h-dvh max-h-none! w-screen max-w-none translate-none rounded-none border-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ${look === 'night' ? 'bg-[var(--tuner-surface)] text-foreground [--background:var(--tuner-surface)] [--card:var(--tuner-surface)] [--foreground:var(--tuner-foreground)] [--input:var(--tuner-amber)] [--muted-foreground:var(--tuner-foreground)] [--muted:var(--tuner-surface)] [--raised:var(--tuner-surface)]' : ''}`
          : 'max-w-2xl'
      }
      onCancel={() => void close().then(onClose)}
    >
      <div className="grid min-w-0 gap-4">
        <TunerFace
          precision
          still={slow}
          note={listening ? (pitch?.note ?? null) : null}
          cents={pitch?.cents ?? 0}
          frequency={pitch?.frequency}
          reference={a4}
          day={look === 'day'}
          idleLabel={idleLabel}
        />
        {error && (
          <StateNotice kind="error" title="Tuner unavailable">
            {error}
          </StateNotice>
        )}
        {state?.standalone && !error && (
          <p className="text-sm text-muted-foreground">
            Nothing is playing, so the tuner opened the input by itself and
            stays silent.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-center gap-2">
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
          <div
            className="inline-flex items-center gap-2 font-mono text-sm tabular-nums"
            role="group"
            aria-label="Reference pitch"
          >
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
