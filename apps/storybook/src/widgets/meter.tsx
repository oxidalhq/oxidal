import { cn } from '../lib/cn';

/**
 * The one level meter: master, edge meters on stage, Levels page, Sound
 * check tiles. Values are dBFS from −60 to 0. The bar is ink; the last
 * 6 dB are drawn in the wire colour so "hot" reads without colour; a clip
 * holds an oxide mark at the top until cleared. Peak hold is a thin line.
 * Four states beside the value: live, stale, stopped, unavailable.
 */
export type MeterState = 'live' | 'stale' | 'stopped' | 'unavailable';

const FLOOR = -60;

function fraction(db: number) {
  return Math.min(1, Math.max(0, (db - FLOOR) / -FLOOR));
}

export function Meter({
  value,
  peak,
  clipped = false,
  state = 'live',
  orientation = 'horizontal',
  label,
  showValue = true,
  size = 'md',
  className,
}: {
  /** Current level in dBFS. */
  value: number | null;
  /** Held peak in dBFS. */
  peak?: number | null;
  clipped?: boolean;
  state?: MeterState;
  orientation?: 'horizontal' | 'vertical';
  label: string;
  showValue?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const vertical = orientation === 'vertical';
  const live = state === 'live' && value !== null;
  const level = live ? fraction(value) : 0;
  const hot = fraction(-6);
  const held =
    peak !== null && peak !== undefined && live ? fraction(peak) : null;
  const text =
    state === 'unavailable'
      ? '—'
      : state === 'stopped'
        ? 'Stopped'
        : value === null
          ? '—'
          : `${value <= FLOOR ? '−∞' : value.toFixed(1)} dB`;
  const thickness = { sm: 'h-1.5', md: 'h-2.5', lg: 'h-4' }[size];
  const width = { sm: 'w-1.5', md: 'w-2.5', lg: 'w-4' }[size];
  return (
    <div
      data-slot="meter"
      data-state={state}
      data-clipped={clipped || undefined}
      role="meter"
      aria-label={label}
      aria-valuemin={FLOOR}
      aria-valuemax={0}
      aria-valuenow={live ? Math.max(FLOOR, Math.min(0, value)) : FLOOR}
      aria-valuetext={text}
      className={cn(
        vertical
          ? 'grid h-full grid-rows-[auto_minmax(0,1fr)_auto] justify-items-center gap-1'
          : 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1',
        className,
      )}
    >
      {showValue && (
        <span
          className={cn(
            'font-mono text-xs font-medium tabular-nums',
            vertical ? 'row-start-1' : 'col-start-2 row-start-1',
            clipped && 'text-brand',
          )}
        >
          {clipped ? 'Clip' : text}
        </span>
      )}
      {!vertical && (
        <span className="col-start-1 row-start-1 small-caps text-sm font-medium text-muted-foreground">
          {label}
        </span>
      )}
      <div
        aria-hidden="true"
        className={cn(
          'relative overflow-hidden rounded-full bg-wire/30',
          vertical
            ? cn('row-start-2 h-full', width)
            : cn('col-span-2 row-start-2 w-full', thickness),
          state === 'unavailable' &&
            'bg-[repeating-linear-gradient(45deg,transparent,transparent_3px,var(--wire)_3px,var(--wire)_4px)] opacity-50',
        )}
      >
        {/* Fill up to the level; the hot zone is painted over the top 6 dB. */}
        <div
          className={cn(
            'absolute bg-foreground',
            vertical ? 'inset-x-0 bottom-0' : 'inset-y-0 left-0',
          )}
          style={
            vertical
              ? { height: `${level * 100}%` }
              : { width: `${level * 100}%` }
          }
        />
        <div
          className={cn(
            'absolute bg-wire',
            vertical ? 'inset-x-0 bottom-0' : 'inset-y-0 left-0',
          )}
          style={
            vertical
              ? {
                  height: `${Math.max(0, level - hot) * 100}%`,
                  bottom: `${hot * 100}%`,
                }
              : {
                  width: `${Math.max(0, level - hot) * 100}%`,
                  left: `${hot * 100}%`,
                }
          }
        />
        {held !== null && (
          <div
            className={cn(
              'absolute bg-foreground',
              vertical ? 'inset-x-0 h-0.5' : 'inset-y-0 w-0.5',
            )}
            style={
              vertical
                ? { bottom: `calc(${held * 100}% - 1px)` }
                : { left: `calc(${held * 100}% - 1px)` }
            }
          />
        )}
        {clipped && (
          <div
            className={cn(
              'absolute bg-brand',
              vertical ? 'inset-x-0 top-0 h-1.5' : 'inset-y-0 right-0 w-1.5',
            )}
          />
        )}
      </div>
      {vertical && (
        <span className="row-start-3 small-caps text-sm font-medium text-muted-foreground">
          {label}
        </span>
      )}
    </div>
  );
}

/** Left and right of one point in the signal, sharing a label. */
export function StereoMeter({
  left,
  right,
  peaks,
  clipped,
  state,
  label,
  orientation = 'horizontal',
  size = 'md',
  className,
}: {
  left: number | null;
  right: number | null;
  peaks?: [number | null, number | null];
  clipped?: [boolean, boolean];
  state?: MeterState;
  label: string;
  orientation?: 'horizontal' | 'vertical';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const vertical = orientation === 'vertical';
  return (
    <div
      data-slot="stereo-meter"
      className={cn(
        vertical
          ? 'grid h-full grid-rows-[minmax(0,1fr)_auto] justify-items-center gap-1'
          : 'grid gap-1',
        className,
      )}
    >
      <div className={cn(vertical ? 'flex h-full gap-1' : 'grid gap-1')}>
        <Meter
          value={left}
          peak={peaks?.[0]}
          clipped={clipped?.[0]}
          state={state}
          label={`${label} left`}
          orientation={orientation}
          size={size}
          showValue={!vertical}
        />
        <Meter
          value={right}
          peak={peaks?.[1]}
          clipped={clipped?.[1]}
          state={state}
          label={`${label} right`}
          orientation={orientation}
          size={size}
          showValue={false}
        />
      </div>
      {vertical && (
        <span className="small-caps text-sm font-medium text-muted-foreground">
          {label}
        </span>
      )}
    </div>
  );
}
