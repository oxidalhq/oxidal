import { CheckCircle, XCircle } from '@phosphor-icons/react';
import * as React from 'react';

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
import { ConfirmChange } from './confirm-change';

const RATES = ['44100', '48000', '96000'];
const FRAMES = ['48', '64', '96', '128', '256'];
const ms = (frames: number, periods: number, rate: number) =>
  ((frames * periods * 2) / rate) * 1000;

export type AudioSetting = { rate: number; frames: number; periods: number };
export type AudioChangePhase = 'idle' | 'restarting' | 'proving';
export type BufferTrial = { frames: number; periods: number; xruns: number };
export type BufferFinderRun = {
  /** Sizes tried so far, in order. */
  trials: BufferTrial[];
  /** How many sizes the finder will try. */
  total: number;
  state: 'idle' | 'running' | 'done';
  onStart: () => void;
  onCancel: () => void;
};

/**
 * Change the running session's rate or buffer without touching the tone:
 * pick, see the round-trip latency it gives, apply. Audio restarts for a
 * moment, then the new setting has fifteen seconds to prove itself: Keep
 * it, or it goes back on its own.
 */
export function AudioChange({
  current,
  phase,
  secondsLeft,
  finder,
  onApply,
  onSettle,
}: {
  current: AudioSetting;
  phase: AudioChangePhase;
  /** While proving: seconds until it goes back on its own. */
  secondsLeft: number;
  finder: BufferFinderRun;
  onApply: (setting: AudioSetting) => void;
  /** Keep the new setting (true) or go back now (false). */
  onSettle: (keep: boolean) => void;
}) {
  const [draft, setDraft] = React.useState(current);
  const [finding, setFinding] = React.useState(false);
  const [seen, setSeen] = React.useState(current);
  if (seen !== current) {
    setSeen(current);
    setDraft(current);
  }
  const apply = (next: AudioSetting) => onApply(next);
  const settle = onSettle;
  const left = secondsLeft;
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
      {phase === 'idle' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!changed} onClick={() => apply(draft)}>
            Apply and restart audio
          </Button>
          <Button variant="outline" onClick={() => setFinding(true)}>
            Find the smallest safe buffer…
          </Button>
          {changed && (
            <Caption as="span" className="text-xs">
              {ms(draft.frames, draft.periods, draft.rate).toFixed(1)} ms round
              trip. Your tone stays as it is.
            </Caption>
          )}
        </div>
      )}
      <ConfirmChange
        open={phase !== 'idle'}
        title="Keep this audio setting?"
        applying={phase === 'restarting' ? 'Restarting audio…' : undefined}
        body={
          <>
            Audio is back at {current.frames} × {current.periods},{' '}
            {current.rate / 1000} kHz, with no dropouts. If it sounds right,
            keep it.
          </>
        }
        secondsLeft={left}
        totalSeconds={15}
        keepLabel="Keep"
        onKeep={() => settle(true)}
        onGoBack={() => settle(false)}
      />
      <BufferFinder
        {...finder}
        open={finding}
        onOpenChange={setFinding}
        rate={current.rate}
        onUse={(s) => apply({ ...s, rate: current.rate })}
      />
    </section>
  );
}

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
  trials,
  total,
  state,
  onStart,
  onCancel,
}: BufferFinderRun & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rate: number;
  onUse: (setting: { frames: number; periods: number }) => void;
}) {
  const done = state === 'done';
  const best = trials.filter((t) => t.xruns === 0).at(-1);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader
          title="Find the smallest safe buffer"
          description="Play hard, with your loudest preset, while each size is tried for ten seconds."
        />
        <DialogBody className="grid gap-3">
          {state === 'running' && (
            <Progress
              value={(trials.length / total) * 100}
              label="Finder progress"
            />
          )}
          <ul
            aria-label="Buffer sizes tried"
            className="m-0 grid list-none gap-1 p-0 text-sm"
          >
            {trials.map((t) => (
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
          {state === 'idle' && <Button onClick={onStart}>Start</Button>}
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
