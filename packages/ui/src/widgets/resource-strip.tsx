import { Warning } from '@phosphor-icons/react';
import { cn } from '../lib/cn';

export type ResourceReadings = {
  /** Audio processing time as a fraction of the period deadline, p95 and peak. */
  dsp?: { p95: number; peak: number } | null;
  /** Total host CPU, 0–100. */
  cpu?: number | null;
  /** RAM used and total, in MiB. */
  ram?: { used: number; total: number } | null;
  xruns?: number | null;
  clips?: number | null;
  /** SoC temperature in °C. */
  temperature?: number | null;
};

export type ResourceState = 'live' | 'stale' | 'stopped' | 'disconnected';

const OFF: Record<Exclude<ResourceState, 'live'>, [string, string]> = {
  stale: ['Readings are out of date', 'Waiting for new numbers from Oxidal.'],
  stopped: ['Audio stopped', 'Readings come back when audio starts.'],
  disconnected: ['Disconnected', 'Trying to reach Oxidal again.'],
};

type Cell = {
  label: string;
  value: string;
  /** Said after the value, smaller, such as the peak. */
  extra?: string;
  /** How full the bar is, 0 to 1; counters have no bar. */
  share?: number;
  /** A second point on the bar, such as the peak. */
  mark?: number;
  warn?: boolean;
};

const at = (v: number) => `${Math.min(100, Math.max(0, v * 100))}%`;

/**
 * The strip that stays under the masthead on every screen, read at a glance:
 * each reading is a bold number with a bar, and anything past its limit turns
 * oxide with a warning mark. When there is nothing to measure it says so in
 * one line instead of a row of dashes. No animation, and it never takes a
 * touch target. On phones the six readings sit in two rows of three.
 */
export function ResourceStrip({
  readings,
  state = 'live',
  className,
}: {
  readings: ResourceReadings;
  state?: ResourceState;
  className?: string;
}) {
  if (state !== 'live') {
    const [word, about] = OFF[state];
    return (
      <div
        data-slot="resource-strip"
        data-state={state}
        role="status"
        aria-label="DSP and system resources"
        className={cn(
          'flex flex-wrap items-baseline gap-x-2 border-b border-border bg-background px-page py-2 text-sm',
          className,
        )}
      >
        <span className="font-semibold">{word}</span>
        <span className="text-xs text-muted-foreground">{about}</span>
      </div>
    );
  }
  const { dsp, cpu, ram, xruns, clips, temperature } = readings;
  const dash = '—';
  const cells: Cell[] = [
    {
      label: 'DSP',
      value: dsp ? `${Math.round(dsp.p95 * 100)}%` : dash,
      extra: dsp ? `peak ${Math.round(dsp.peak * 100)}%` : undefined,
      share: dsp?.p95 ?? 0,
      mark: dsp?.peak,
      warn: !!dsp && dsp.peak > 0.8,
    },
    {
      label: 'CPU',
      value: typeof cpu === 'number' ? `${Math.round(cpu)}%` : dash,
      share: (cpu ?? 0) / 100,
      warn: (cpu ?? 0) >= 85,
    },
    {
      label: 'RAM',
      value: ram ? `${(ram.used / 1024).toFixed(1)} GB` : dash,
      extra: ram ? `of ${(ram.total / 1024).toFixed(0)}` : undefined,
      share: ram ? ram.used / ram.total : 0,
      warn: !!ram && ram.used / ram.total >= 0.9,
    },
    {
      label: 'Dropouts',
      value: typeof xruns === 'number' ? String(xruns) : dash,
      warn: (xruns ?? 0) > 0,
    },
    {
      label: 'Clips',
      value: typeof clips === 'number' ? String(clips) : dash,
      warn: (clips ?? 0) > 0,
    },
    {
      label: 'Temp',
      value:
        typeof temperature === 'number' ? `${Math.round(temperature)}°` : dash,
      share: (temperature ?? 0) / 85,
      warn: (temperature ?? 0) >= 75,
    },
  ];
  return (
    <div
      data-slot="resource-strip"
      data-state={state}
      role="group"
      aria-label="DSP and system resources"
      className={cn(
        'grid grid-cols-3 gap-x-4 gap-y-2 border-b border-border bg-background px-page py-2 md:grid-cols-6 md:gap-x-6',
        className,
      )}
    >
      {cells.map((cell) => (
        <div
          key={cell.label}
          role="group"
          aria-label={`${cell.label}: ${cell.value}${cell.extra ? `, ${cell.extra}` : ''}${cell.warn ? ', over its limit' : ''}`}
          className="grid min-w-0 content-start gap-1"
        >
          <div className="flex min-w-0 items-baseline justify-between gap-1.5">
            <span className="truncate small-caps text-2xs font-medium text-muted-foreground">
              {cell.label}
            </span>
            <span
              className={cn(
                'inline-flex shrink-0 items-baseline gap-1 font-mono text-md leading-none font-bold tabular-nums',
                cell.warn ? 'text-brand' : 'text-foreground',
              )}
            >
              {cell.warn && (
                <Warning
                  aria-hidden="true"
                  weight="fill"
                  className="size-3.5 self-center"
                />
              )}
              {cell.value}
              {cell.extra && (
                <span className="text-2xs font-medium text-muted-foreground max-lg:hidden">
                  {cell.extra}
                </span>
              )}
            </span>
          </div>
          <span
            aria-hidden="true"
            className={cn(
              'relative h-1 rounded-full',
              cell.share !== undefined && 'bg-wire/30',
            )}
          >
            {cell.share !== undefined && (
              <span
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full',
                  cell.warn ? 'bg-brand' : 'bg-foreground',
                )}
                style={{ width: at(cell.share) }}
              />
            )}
            {cell.mark !== undefined && (
              <span
                className={cn(
                  'absolute -inset-y-0.5 w-0.5 rounded-full',
                  cell.warn ? 'bg-brand' : 'bg-foreground',
                )}
                style={{ left: at(cell.mark) }}
              />
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
