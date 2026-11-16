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

/**
 * The strip that stays under the masthead on every screen: measured
 * processing against the period deadline, host CPU, RAM, xruns and clips,
 * with the state said in words. Compact, readable in every mode, no
 * animation, and it never takes a touch target. On phones the middle
 * readouts fold into the first row's second line.
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
  const off = state !== 'live';
  const dash = '—';
  const pct = (value: number | null | undefined) =>
    off || value === null || value === undefined
      ? dash
      : `${Math.round(value)}%`;
  const items: {
    label: string;
    value: string;
    warn?: boolean;
    wide?: boolean;
  }[] = [
    {
      label: 'DSP p95',
      value:
        off || !readings.dsp
          ? dash
          : `${Math.round(readings.dsp.p95 * 100)}% · pk ${Math.round(readings.dsp.peak * 100)}%`,
      warn: !off && !!readings.dsp && readings.dsp.peak > 0.8,
      wide: true,
    },
    { label: 'CPU', value: pct(readings.cpu) },
    {
      label: 'RAM',
      value:
        off || !readings.ram
          ? dash
          : `${(readings.ram.used / 1024).toFixed(1)} / ${(readings.ram.total / 1024).toFixed(0)} GB`,
      wide: true,
    },
    {
      label: 'Xruns',
      value:
        off || readings.xruns === null || readings.xruns === undefined
          ? dash
          : String(readings.xruns),
      warn: !off && (readings.xruns ?? 0) > 0,
    },
    {
      label: 'Clips',
      value:
        off || readings.clips === null || readings.clips === undefined
          ? dash
          : String(readings.clips),
      warn: !off && (readings.clips ?? 0) > 0,
    },
    {
      label: 'Temp',
      value:
        off ||
        readings.temperature === null ||
        readings.temperature === undefined
          ? dash
          : `${Math.round(readings.temperature)}°`,
      warn: !off && (readings.temperature ?? 0) >= 75,
    },
  ];
  return (
    <div
      data-slot="resource-strip"
      data-state={state}
      role="group"
      aria-label="DSP and system resources"
      className={cn(
        'flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-border bg-background px-page py-1.5 text-xs',
        className,
      )}
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={cn(
            'flex items-baseline gap-1.5',
            item.wide ? 'min-w-28' : 'min-w-12',
          )}
        >
          <span className="small-caps font-medium text-muted-foreground">
            {item.label}
          </span>
          <span
            className={cn(
              'font-mono font-medium tabular-nums',
              item.warn ? 'text-brand' : 'text-foreground',
              off && 'text-muted-foreground',
            )}
          >
            {item.value}
          </span>
        </div>
      ))}
      {state !== 'live' && (
        <span className="ml-auto small-caps font-medium text-foreground">
          {
            {
              stale: 'Stale',
              stopped: 'Audio stopped',
              disconnected: 'Disconnected',
            }[state]
          }
        </span>
      )}
    </div>
  );
}
