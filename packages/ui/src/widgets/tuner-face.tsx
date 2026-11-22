import { SpeakerSlash } from '@phosphor-icons/react';

import { cn } from '../lib/cn';
import { TunerStrobe } from './tuner-strobe';

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Within this many cents the note counts as in tune. */
const LOCK = 3;

/**
 * The tuner, readable from the floor: the note name in the display size, a
 * cents scale with one needle, flat on the left and sharp on the right. In
 * tune turns the needle green and the name steady; otherwise amber. The
 * face is dark by default (the stage), white in day mode, and black and
 * white in E-paper where the tokens flatten it. No animation besides the
 * needle moving. With `onMuted` it offers a quiet switch to mute the outputs
 * while tuning; the choice is kept without a Save button.
 */
export function TunerFace({
  note,
  cents,
  frequency,
  reference = 440,
  day = false,
  size = 'md',
  precision = false,
  idleLabel = 'Play a string',
  still = false,
  muted,
  onMuted,
  className,
}: {
  /** MIDI note number, or null when nothing is heard. */
  note: number | null;
  /** −50 … +50 relative to the note. */
  cents: number;
  frequency?: number | null;
  reference?: number;
  day?: boolean;
  size?: 'md' | 'lg';
  /** Show the one-cent strobe dial and tenths of a cent. */
  precision?: boolean;
  idleLabel?: string;
  still?: boolean;
  /** The outputs are muted while the tuner is open. */
  muted?: boolean;
  onMuted?: (muted: boolean) => void;
  className?: string;
}) {
  const heard = note !== null;
  const inTune = heard && Math.abs(cents) <= (precision ? 1 : LOCK);
  const name = heard ? NAMES[((note % 12) + 12) % 12] : '—';
  const octave = heard ? Math.floor(note / 12) - 1 : '';
  const position = 50 + Math.max(-50, Math.min(50, cents));
  const ink = day
    ? inTune
      ? 'var(--tuner-day-green)'
      : 'var(--tuner-day-ink)'
    : inTune
      ? 'var(--tuner-green)'
      : 'var(--tuner-amber)';
  const shown = heard ? Math.round(cents * 10) / 10 : null;
  return (
    <div
      data-slot="tuner"
      style={{
        background: day ? 'var(--tuner-day-surface)' : 'var(--tuner-surface)',
        color: day ? 'var(--tuner-day-ink)' : 'var(--tuner-foreground)',
      }}
      className={cn(
        'grid justify-items-center gap-2 rounded-lg p-6 select-none',
        size === 'lg' && 'gap-4 p-10',
        className,
      )}
    >
      <div
        data-slot="tuner-face"
        data-in-tune={inTune || undefined}
        data-heard={heard || undefined}
        role="status"
        aria-live="polite"
        aria-label={
          heard
            ? `${name}${octave}, ${cents > 0 ? '+' : ''}${cents.toFixed(precision ? 1 : 0)} cents${inTune ? ', in tune' : ''}`
            : precision
              ? idleLabel
              : 'Tuner: no note'
        }
        className={cn(
          'grid w-full justify-items-center gap-4',
          size === 'lg' && 'gap-6',
        )}
      >
        <div className="grid w-full justify-items-center gap-1">
          <span className="small-caps text-sm font-medium opacity-70">
            {heard
              ? `${frequency ? `${frequency.toFixed(precision ? 2 : 1)} Hz · ` : ''}A = ${reference} Hz`
              : idleLabel}
          </span>
          {precision ? (
            <div className="w-full" style={{ color: ink }}>
              <TunerStrobe
                cents={heard ? cents : null}
                name={name ?? '—'}
                octave={String(octave)}
                still={still}
              />
            </div>
          ) : (
            <span
              className={cn(
                'font-display font-semibold tracking-tight tabular-nums',
                size === 'lg'
                  ? 'text-[clamp(5rem,20vw,10rem)] leading-none'
                  : 'text-display',
              )}
              style={{
                color: heard ? ink : undefined,
              }}
            >
              {name}
              {heard && (
                <span className="text-[0.35em] font-normal opacity-70">
                  {octave}
                </span>
              )}
            </span>
          )}
        </div>
        <div className="grid w-full max-w-md gap-1">
          {!precision && (
            <div className="relative h-10" aria-hidden="true">
              {/* Scale: ticks every 10 cents, a tall tick at 0. */}
              {Array.from({ length: 11 }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    'absolute top-1/2 w-px -translate-y-1/2 bg-current',
                    index === 5 ? 'h-8 opacity-80' : 'h-3 opacity-35',
                  )}
                  style={{ left: `${index * 10}%` }}
                />
              ))}
              {heard && (
                <span
                  className="absolute top-0 h-10 w-1 -translate-x-1/2 rounded-full transition-[left] duration-[var(--duration-fast)]"
                  style={{
                    left: `${position}%`,
                    background: ink,
                  }}
                />
              )}
            </div>
          )}
          <div
            role={precision ? 'meter' : undefined}
            aria-label={precision ? 'Tuning cents' : undefined}
            aria-valuemin={precision ? -50 : undefined}
            aria-valuemax={precision ? 50 : undefined}
            aria-valuenow={precision ? (shown ?? 0) : undefined}
            aria-valuetext={
              precision
                ? shown === null
                  ? 'No clear note'
                  : `${shown} cents`
                : undefined
            }
            className="flex justify-between small-caps text-sm font-medium"
          >
            <span
              data-on={heard && !inTune && cents < 0}
              className={
                precision ? 'opacity-70 data-[on=true]:opacity-100' : undefined
              }
            >
              ♭ flat
            </span>
            <span className="font-mono tabular-nums">
              {precision && shown !== null
                ? inTune
                  ? 'In tune'
                  : `${shown > 0 ? '+' : '−'}${Math.abs(shown).toFixed(1)} cents`
                : heard
                  ? `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${Math.abs(cents).toFixed(0)}¢`
                  : ''}
            </span>
            <span
              data-on={heard && !inTune && cents > 0}
              className={
                precision ? 'opacity-70 data-[on=true]:opacity-100' : undefined
              }
            >
              sharp ♯
            </span>
          </div>
        </div>
      </div>
      {onMuted && (
        <button
          type="button"
          role="switch"
          aria-checked={Boolean(muted)}
          onClick={() => onMuted(!muted)}
          className="inline-flex min-h-touch items-center gap-2 rounded-md px-2 text-sm font-medium opacity-80 hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          <SpeakerSlash aria-hidden="true" className="size-4" />
          Mute while tuning
          <span
            aria-hidden="true"
            className={cn(
              'relative h-4 w-7 rounded-full border border-current',
              muted && 'bg-current',
            )}
          >
            <span
              className="absolute top-1/2 size-2.5 -translate-y-1/2 rounded-full transition-[left] duration-[var(--duration-fast)]"
              style={{
                left: muted ? '0.875rem' : '0.125rem',
                background: muted
                  ? day
                    ? 'var(--tuner-day-surface)'
                    : 'var(--tuner-surface)'
                  : 'currentColor',
              }}
            />
          </span>
        </button>
      )}
    </div>
  );
}
