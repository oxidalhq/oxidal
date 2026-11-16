import * as React from 'react';
import { CheckCircle, XCircle } from '@phosphor-icons/react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Progress } from '../components/ui/states';
import { Caption } from '../components/ui/text';

const RATES = ['44100', '48000', '96000'];
const FRAMES = ['48', '64', '96', '128', '256'];
const ms = (frames: number, periods: number, rate: number) =>
  ((frames * periods * 2) / rate) * 1000;

type Setting = { rate: number; frames: number; periods: number };

/**
 * Change the running session's rate or buffer without touching the tone:
 * pick, see the round-trip latency it gives, apply. Audio restarts for a
 * moment, then the new setting has fifteen seconds to prove itself: Keep
 * it, or it goes back on its own.
 */
export function AudioChange({
  initial = { rate: 48000, frames: 128, periods: 3 },
}: {
  initial?: Setting;
}) {
  const [current, setCurrent] = React.useState(initial);
  const [draft, setDraft] = React.useState(initial);
  const [phase, setPhase] = React.useState<'idle' | 'restarting' | 'proving'>(
    'idle',
  );
  const [left, setLeft] = React.useState(15);
  const [finder, setFinder] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const before = React.useRef(initial);
  React.useEffect(
    () => () => void (timer.current && clearInterval(timer.current)),
    [],
  );

  const apply = (next: Setting) => {
    before.current = current;
    setCurrent(next);
    setDraft(next);
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
          setDraft(before.current);
          setPhase('idle');
        }
      }, 1000);
    }, 600) as unknown as ReturnType<typeof setInterval>;
  };
  const settle = (keep: boolean) => {
    if (timer.current) clearInterval(timer.current);
    if (!keep) {
      setCurrent(before.current);
      setDraft(before.current);
    }
    setPhase('idle');
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(current);

  return (
    <section
      aria-label="Adjust current session"
      className="grid gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-md font-semibold">Adjust current session</span>
        <span className="font-mono text-sm tabular-nums">
          {current.frames} × {current.periods} · {current.rate / 1000} kHz ·{' '}
          {ms(current.frames, current.periods, current.rate).toFixed(1)} ms
          round trip
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <span className="small-caps text-xs text-muted-foreground">
            Sample rate
          </span>
          <SegmentedControl
            size="sm"
            value={String(draft.rate)}
            onValueChange={(v) => setDraft({ ...draft, rate: Number(v) })}
            aria-label="Session sample rate"
          >
            {RATES.map((r) => (
              <Segment key={r} value={r}>{`${Number(r) / 1000} kHz`}</Segment>
            ))}
          </SegmentedControl>
        </div>
        <div className="grid gap-1">
          <span className="small-caps text-xs text-muted-foreground">
            Buffer
          </span>
          <SegmentedControl
            size="sm"
            value={String(draft.frames)}
            onValueChange={(v) => setDraft({ ...draft, frames: Number(v) })}
            aria-label="Session buffer"
          >
            {FRAMES.map((f) => (
              <Segment key={f} value={f}>
                {f}
              </Segment>
            ))}
          </SegmentedControl>
        </div>
        <div className="grid gap-1">
          <span className="small-caps text-xs text-muted-foreground">
            Periods
          </span>
          <SegmentedControl
            size="sm"
            value={String(draft.periods)}
            onValueChange={(v) => setDraft({ ...draft, periods: Number(v) })}
            aria-label="Session buffer periods"
          >
            {['2', '3', '4'].map((p) => (
              <Segment key={p} value={p}>
                {p}
              </Segment>
            ))}
          </SegmentedControl>
        </div>
      </div>
      {phase === 'idle' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!changed} onClick={() => apply(draft)}>
            Apply and restart audio
          </Button>
          <Button variant="outline" onClick={() => setFinder(true)}>
            Find the smallest safe buffer…
          </Button>
          {changed && (
            <Caption as="span" className="text-xs">
              {ms(draft.frames, draft.periods, draft.rate).toFixed(1)} ms round
              trip. Your tone stays as it is.
            </Caption>
          )}
        </div>
      ) : (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-foreground px-3 py-2"
        >
          {phase === 'restarting' ? (
            <span className="text-sm">Restarting audio…</span>
          ) : (
            <>
              <span className="text-sm">
                Audio is back with no dropouts. Keep this setting? It goes back
                on its own in {left} s.
              </span>
              <span className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => settle(false)}
                >
                  Go back
                </Button>
                <Button size="sm" onClick={() => settle(true)}>
                  Keep
                </Button>
              </span>
            </>
          )}
        </div>
      )}
      <BufferFinder
        open={finder}
        onOpenChange={setFinder}
        rate={current.rate}
        onUse={(s) => apply({ ...s, rate: current.rate })}
      />
    </section>
  );
}

const TRIALS: { frames: number; periods: number; xruns: number }[] = [
  { frames: 128, periods: 3, xruns: 0 },
  { frames: 96, periods: 3, xruns: 0 },
  { frames: 64, periods: 3, xruns: 2 },
  { frames: 96, periods: 2, xruns: 0 },
];

/**
 * The buffer finder: steps the buffer down while you play hard, listens for
 * dropouts at each step, then tries fewer periods at the best size. It
 * keeps the last clean setting and offers it.
 */
export function BufferFinder({
  open,
  onOpenChange,
  rate,
  onUse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rate: number;
  onUse: (setting: { frames: number; periods: number }) => void;
}) {
  const [step, setStep] = React.useState(-1);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearInterval(timer.current)),
    [],
  );
  const done = step >= TRIALS.length;
  const best = TRIALS.slice(0, Math.max(0, step))
    .filter((t) => t.xruns === 0)
    .at(-1);
  const start = () => {
    let n = 0;
    setStep(0);
    timer.current = setInterval(() => {
      n += 1;
      setStep(n);
      if (n >= TRIALS.length && timer.current) clearInterval(timer.current);
    }, 700);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          if (timer.current) clearInterval(timer.current);
          setStep(-1);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Find the smallest safe buffer"
          description="Play hard, with your loudest preset, while each size is tried for ten seconds."
        />
        <DialogBody className="grid gap-3">
          {step >= 0 && !done && (
            <Progress
              value={(step / TRIALS.length) * 100}
              label="Finder progress"
            />
          )}
          <ul
            aria-label="Buffer sizes tried"
            className="m-0 grid list-none gap-1 p-0 text-sm"
          >
            {TRIALS.slice(0, Math.max(0, step)).map((t) => (
              <li
                key={`${t.frames}x${t.periods}`}
                className="flex items-center gap-2"
              >
                {t.xruns ? (
                  <XCircle aria-hidden="true" className="text-brand" />
                ) : (
                  <CheckCircle aria-hidden="true" />
                )}
                <span className="font-mono tabular-nums">
                  {t.frames} × {t.periods}
                </span>
                <Caption as="span" className="text-xs">
                  {ms(t.frames, t.periods, rate).toFixed(1)} ms ·{' '}
                  {t.xruns ? `${t.xruns} dropouts` : 'clean'}
                </Caption>
              </li>
            ))}
          </ul>
          {done && best && (
            <p role="status" className="m-0 text-sm font-semibold">
              Smallest clean setting: {best.frames} × {best.periods},{' '}
              {ms(best.frames, best.periods, rate).toFixed(1)} ms round trip.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {done ? 'Keep current' : 'Cancel'}
          </Button>
          {step < 0 && <Button onClick={start}>Start</Button>}
          {done && best && (
            <Button
              onClick={() => {
                onUse({ frames: best.frames, periods: best.periods });
                onOpenChange(false);
              }}
            >
              Use {best.frames} × {best.periods}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
