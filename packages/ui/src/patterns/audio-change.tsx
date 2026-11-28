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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Progress } from '../components/ui/states';
import { Caption } from '../components/ui/text';
import { cn } from '../lib/cn';
import { ConfirmChange } from './confirm-change';

const RATES = ['44100', '48000', '96000'];
const FRAMES = ['48', '64', '96', '128', '256'];
/** Device buffer length, as the app works it out: period size × periods at the rate. */
const ms = (frames: number, periods: number, rate: number) =>
  ((frames * periods) / rate) * 1000;

export type AudioSetting = { rate: number; frames: number; periods: number };
export type AudioChangePhase = 'idle' | 'restarting' | 'proving' | 'reverting';
export type BufferTrial = {
  frames: number;
  periods: number;
  xruns?: number | null;
  deadline_misses?: number | null;
  invalid_samples?: number | null;
  outcome?: 'clean' | 'failed' | 'unavailable';
  elapsed_ms?: number;
  reason?: string | null;
};
export type BufferFinderRun = {
  /** Sizes tried so far, in order. */
  trials: BufferTrial[];
  /** How many sizes the finder will try. */
  total: number;
  state: 'idle' | 'running' | 'done';
  onStart: () => void;
  onCancel: () => void;
  onUse?: (setting: { frames: number; periods: number }) => void;
  recommended?: { frames: number; periods: number } | null;
  message?: string | null;
  startDisabled?: boolean;
  cancelDisabled?: boolean;
  canUse?: boolean;
};

/**
 * Change the running session's rate or buffer without touching the tone:
 * pick, see its calculated buffer time, apply. Audio restarts for a
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
  choices,
  disabled = false,
  additionalChanges = false,
  details,
  currentBufferMs,
  confirmation,
  canKeep = true,
  confirmationDisabled,
  canApply = true,
  onReset,
  value,
  onChange,
  waiting,
  recovery,
  finderOpen,
  onFinderOpenChange,
  caption,
}: {
  /** A line under the heading, such as what Resume keeps. */
  caption?: React.ReactNode;
  current: AudioSetting;
  phase: AudioChangePhase;
  /** While proving: seconds until it goes back on its own. */
  secondsLeft: number;
  finder?: BufferFinderRun;
  finderOpen?: boolean;
  onFinderOpenChange?: (open: boolean) => void;
  choices?: {
    rates: number[];
    frames: number[];
    periods: number[];
    /**
     * Rarer values, offered in an "Other…" list beside the common ones so a
     * setting such as a 512 buffer or 6 periods stays one step away.
     */
    more?: { rates?: number[]; frames?: number[]; periods?: number[] };
  };
  disabled?: boolean;
  additionalChanges?: boolean;
  details?: React.ReactNode;
  currentBufferMs?: number;
  confirmation?: React.ReactNode;
  canKeep?: boolean;
  confirmationDisabled?: boolean;
  canApply?: boolean;
  onReset?: () => void;
  value?: AudioSetting;
  onChange?: (value: AudioSetting) => void;
  waiting?: string;
  recovery?: React.ReactNode;
  onApply: (setting: AudioSetting) => void;
  /** Keep the new setting (true) or go back now (false). */
  onSettle: (keep: boolean) => void;
}) {
  const [localDraft, setLocalDraft] = React.useState(current);
  const draft = value ?? localDraft;
  const setDraft = (next: AudioSetting) =>
    onChange ? onChange(next) : setLocalDraft(next);
  const [localFinding, setLocalFinding] = React.useState(false);
  const finding = finderOpen ?? localFinding;
  const setFinding = onFinderOpenChange ?? setLocalFinding;
  const currentKey = JSON.stringify(current);
  const [seen, setSeen] = React.useState(currentKey);
  if (seen !== currentKey) {
    setSeen(currentKey);
    setLocalDraft(current);
  }
  const apply = (next: AudioSetting) => onApply(next);
  const settle = onSettle;
  const left = secondsLeft;
  const changed = JSON.stringify(draft) !== currentKey || additionalChanges;
  const locked = disabled || phase !== 'idle';
  // Up to five choices show side by side; more than that is a Select. Rarer
  // values sit in an "Other…" list after them.
  const field = (
    key: keyof AudioSetting,
    label: string,
    values: number[],
    format: (value: number) => string = String,
  ) => {
    const rarer = (
      choices?.more?.[
        key === 'rate' ? 'rates' : key === 'frames' ? 'frames' : 'periods'
      ] ?? []
    ).filter((v) => !values.includes(v));
    const pick = (value: string) =>
      setDraft({ ...draft, [key]: Number(value) });
    const main =
      values.length > 5 ? (
        <Select
          value={String(draft[key])}
          disabled={locked}
          onValueChange={pick}
        >
          <SelectTrigger aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[...values, ...rarer].map((value) => (
              <SelectItem key={value} value={String(value)}>
                {format(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <SegmentedControl
          size="sm"
          value={values.includes(draft[key]) ? String(draft[key]) : ''}
          disabled={locked}
          onValueChange={(value) => value && pick(value)}
          aria-label={label}
          className="w-full"
        >
          {values.map((value) => (
            <Segment key={value} value={String(value)}>
              {format(value)}
            </Segment>
          ))}
        </SegmentedControl>
      );
    if (values.length > 5 || !rarer.length) return main;
    const other = rarer.includes(draft[key]);
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1">{main}</div>
        <Select
          value={other ? String(draft[key]) : ''}
          disabled={locked}
          onValueChange={pick}
        >
          <SelectTrigger
            size="sm"
            aria-label={`${label}: other values`}
            className={cn('w-auto shrink-0', other && 'border-foreground')}
          >
            <SelectValue placeholder="Other…" />
          </SelectTrigger>
          <SelectContent>
            {rarer.map((value) => (
              <SelectItem key={value} value={String(value)}>
                {format(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <section
      aria-label="Adjust current session"
      data-slot="setting-group"
      className="grid gap-3 border-b border-border pb-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 className="m-0 flex min-h-control items-center small-caps text-sm font-medium text-muted-foreground">
          Adjust current session
        </h3>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {current.frames} × {current.periods} · {current.rate / 1000} kHz ·{' '}
          {(
            currentBufferMs ?? ms(current.frames, current.periods, current.rate)
          ).toFixed(1)}{' '}
          ms calculated buffer time
        </span>
        {caption && <Caption className="basis-full text-xs">{caption}</Caption>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <span className="small-caps text-xs text-muted-foreground">
            Sample rate
          </span>
          {field(
            'rate',
            'Session sample rate',
            choices?.rates ?? RATES.map(Number),
            (value) => `${value / 1000} kHz`,
          )}
        </div>
        <div className="grid gap-1">
          <span className="small-caps text-xs text-muted-foreground">
            Buffer
          </span>
          {field(
            'frames',
            'Session buffer',
            choices?.frames ?? FRAMES.map(Number),
          )}
        </div>
        <div className="grid gap-1">
          <span className="small-caps text-xs text-muted-foreground">
            Periods
          </span>
          {field(
            'periods',
            'Session buffer periods',
            choices?.periods ?? [2, 3, 4],
          )}
        </div>
      </div>
      {details && (
        <fieldset disabled={locked} className="grid min-w-0 gap-3">
          {details}
        </fieldset>
      )}
      {phase === 'idle' && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!changed || disabled || !canApply}
            onClick={() => apply(draft)}
          >
            Apply and restart audio
          </Button>
          {finder && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled && finder.state === 'idle'}
              onClick={() => setFinding(true)}
            >
              {finder.state === 'running'
                ? 'View buffer test…'
                : finder.state === 'done'
                  ? 'View buffer results…'
                  : 'Find the smallest safe buffer…'}
            </Button>
          )}
          {changed && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setDraft(current);
                onReset?.();
              }}
            >
              Reset changes
            </Button>
          )}
          {changed && (
            <Caption as="span" className="text-xs">
              {ms(draft.frames, draft.periods, draft.rate).toFixed(1)} ms
              calculated buffer time; one period{' '}
              {((1000 * draft.frames) / draft.rate).toFixed(2)} ms. Your tone
              stays as it is.
            </Caption>
          )}
        </div>
      )}
      <ConfirmChange
        open={phase !== 'idle'}
        title="Keep this audio setting?"
        applying={
          waiting ??
          (phase === 'restarting'
            ? 'Restarting audio…'
            : phase === 'reverting'
              ? 'Restoring previous audio settings…'
              : undefined)
        }
        recovery={recovery}
        disabled={confirmationDisabled ?? disabled}
        keepDisabled={!canKeep}
        canGoBackWhileApplying={phase === 'restarting'}
        body={
          <>
            Audio is back at {current.frames} × {current.periods},{' '}
            {current.rate / 1000} kHz. Check the sound and reported dropouts
            before keeping it.
            {confirmation}
          </>
        }
        secondsLeft={left}
        totalSeconds={15}
        keepLabel="Keep"
        onKeep={() => settle(true)}
        onGoBack={() => settle(false)}
      />
      {finder && (
        <BufferFinder
          {...finder}
          open={finding}
          onOpenChange={setFinding}
          rate={current.rate}
          onUse={(s) =>
            finder.onUse ? finder.onUse(s) : apply({ ...s, rate: current.rate })
          }
        />
      )}
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
  recommended,
  message,
  startDisabled = false,
  cancelDisabled = false,
  canUse = true,
}: BufferFinderRun & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rate: number;
  onUse: (setting: { frames: number; periods: number }) => void;
}) {
  const done = state === 'done';
  const clean = (trial: BufferTrial) =>
    trial.outcome === 'clean' ||
    (trial.outcome === undefined && trial.xruns === 0);
  const best =
    recommended === undefined ? trials.filter(clean).at(-1) : recommended;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Find the smallest safe buffer"
          description="Play your intended rig while each setting is measured for one minute. The device restores the original buffer after each test. Closing this panel leaves testing running."
        />
        <DialogBody className="grid gap-3">
          {message && (
            <p role="status" className="text-sm break-words">
              {message}
            </p>
          )}
          {state === 'running' && (
            <Progress
              value={total > 0 ? (trials.length / total) * 100 : 0}
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
                className="flex min-w-0 flex-wrap items-center gap-2"
              >
                {!clean(t) ? (
                  <XCircle aria-hidden="true" className="text-brand" />
                ) : (
                  <CheckCircle aria-hidden="true" />
                )}
                <span className="font-mono tabular-nums">
                  {t.frames} × {t.periods}
                </span>
                <Caption as="span" className="text-xs">
                  {ms(t.frames, t.periods, rate).toFixed(1)} ms ·{' '}
                  {clean(t)
                    ? 'clean'
                    : t.outcome === 'unavailable'
                      ? 'unavailable'
                      : 'failed'}
                  {' · '}xruns {t.xruns ?? 'unknown'}
                  {t.outcome !== undefined && (
                    <>
                      {' '}
                      · deadlines {t.deadline_misses ?? 'unknown'} · invalid{' '}
                      {t.invalid_samples ?? 'unknown'}
                    </>
                  )}
                  {t.elapsed_ms !== undefined &&
                    ` · ${(t.elapsed_ms / 1000).toFixed(1)} s`}
                  {t.reason && (
                    <span className="block max-w-full break-words">
                      {t.reason}
                    </span>
                  )}
                </Caption>
              </li>
            ))}
          </ul>
          {done && best && (
            <p role="status" className="m-0 text-sm font-semibold">
              Smallest clean setting: {best.frames} × {best.periods},{' '}
              {ms(best.frames, best.periods, rate).toFixed(1)} ms calculated
              buffer time.
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {done
              ? 'Keep current'
              : state === 'running'
                ? 'Close panel'
                : 'Cancel'}
          </Button>
          {state === 'idle' && (
            <Button disabled={startDisabled} onClick={onStart}>
              Start
            </Button>
          )}
          {state === 'done' && (
            <Button
              variant="outline"
              disabled={startDisabled}
              onClick={onStart}
            >
              Run again
            </Button>
          )}
          {state === 'running' && (
            <Button
              variant="outline"
              disabled={cancelDisabled}
              onClick={onCancel}
            >
              Stop test and restore
            </Button>
          )}
          {done && best && (
            <Button
              disabled={!canUse}
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
