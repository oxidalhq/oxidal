import { cn } from '../lib/cn';

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

/** Within this many cents the note counts as in tune. */
const LOCK = 3;

/**
 * The tuner, readable from the floor: the note name in the display size, a
 * cents scale with one needle, flat on the left and sharp on the right. In
 * tune turns the needle green and the name steady; otherwise amber. The
 * face is dark by default (the stage), white in day mode, and black and
 * white in E-paper where the tokens flatten it. No animation besides the
 * needle moving.
 */
export function TunerFace({
  note,
  cents,
  frequency,
  reference = 440,
  day = false,
  size = 'md',
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
  className?: string;
}) {
  const heard = note !== null;
  const inTune = heard && Math.abs(cents) <= LOCK;
  const name = heard ? NAMES[((note % 12) + 12) % 12] : '—';
  const octave = heard ? Math.floor(note / 12) - 1 : '';
  const position = 50 + Math.max(-50, Math.min(50, cents));
  const ink = inTune ? 'var(--tuner-green)' : 'var(--tuner-amber)';
  return (
    <div
      data-slot="tuner-face"
      data-in-tune={inTune || undefined}
      data-heard={heard || undefined}
      role="status"
      aria-live="polite"
      aria-label={
        heard
          ? `${name}${octave}, ${cents > 0 ? '+' : ''}${cents.toFixed(0)} cents${inTune ? ', in tune' : ''}`
          : 'Tuner: no note'
      }
      style={{
        background: day ? 'var(--tuner-day-surface)' : 'var(--tuner-surface)',
        color: day ? 'var(--tuner-day-ink)' : 'var(--enclosure-foreground)',
      }}
      className={cn(
        'grid justify-items-center gap-4 rounded-lg p-6 select-none',
        size === 'lg' && 'gap-6 p-10',
        className,
      )}
    >
      <div className="grid justify-items-center gap-1">
        <span className="small-caps text-sm font-medium opacity-70">
          {heard
            ? `${frequency ? `${frequency.toFixed(1)} Hz · ` : ''}A = ${reference} Hz`
            : 'Play a string'}
        </span>
        <span
          className={cn(
            'font-display font-semibold tracking-tight tabular-nums',
            size === 'lg'
              ? 'text-[clamp(5rem,20vw,10rem)] leading-none'
              : 'text-display',
          )}
          style={{
            color: heard
              ? day && inTune
                ? 'var(--tuner-day-green)'
                : ink
              : undefined,
          }}
        >
          {name}
          {heard && (
            <span className="text-[0.35em] font-normal opacity-70">
              {octave}
            </span>
          )}
        </span>
      </div>
      <div className="grid w-full max-w-md gap-1">
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
                background: day && inTune ? 'var(--tuner-day-green)' : ink,
              }}
            />
          )}
        </div>
        <div className="flex justify-between small-caps text-sm font-medium opacity-70">
          <span>♭ flat</span>
          <span className="font-mono tabular-nums">
            {heard
              ? `${cents > 0 ? '+' : cents < 0 ? '−' : ''}${Math.abs(cents).toFixed(0)}¢`
              : ''}
          </span>
          <span>sharp ♯</span>
        </div>
      </div>
    </div>
  );
}
