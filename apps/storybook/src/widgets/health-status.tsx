import { cn } from '../lib/cn';
import { healthOf } from '../lib/health';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Caption } from '../components/ui/text';
import type { ResourceReadings, ResourceState } from './resource-strip';

const DOT = {
  good: 'bg-foreground',
  busy: 'bg-wire',
  hot: 'bg-brand',
  off: 'bg-transparent border-2 border-foreground',
} as const;

/**
 * The device's health in one word with a dot — All good, Busy, Dropouts,
 * Clipping, Running hot, Audio stopped, Disconnected — for everyone. Tap it
 * for the numbers in plain sentences. Players who want the full strip turn
 * it on in Settings › Display.
 */
export function HealthStatus({
  readings,
  state = 'live',
  className,
}: {
  readings: ResourceReadings;
  state?: ResourceState;
  className?: string;
}) {
  const health = healthOf(readings, state);
  const off = state !== 'live';
  const pct = (v: number | undefined) =>
    v === undefined ? '—' : `${Math.round(v * 100)}%`;
  const lines = off
    ? []
    : [
        readings.dsp &&
          `Processing uses ${pct(readings.dsp.p95)} of each audio period (peaks at ${pct(readings.dsp.peak)}).`,
        readings.cpu !== undefined &&
          readings.cpu !== null &&
          `The whole device is ${Math.round(readings.cpu)}% busy.`,
        readings.ram &&
          `Memory: ${(readings.ram.used / 1024).toFixed(1)} of ${Math.round(readings.ram.total / 1024)} GB in use.`,
        readings.temperature !== undefined &&
          readings.temperature !== null &&
          `The chip is at ${Math.round(readings.temperature)} °C.`,
        `${readings.xruns ?? 0} dropouts and ${readings.clips ?? 0} clips since the preset started.`,
      ].filter(Boolean);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="health-status"
          data-tone={health.tone}
          className={cn(
            'inline-flex min-h-8 items-center gap-2 rounded-full border border-border bg-background px-3 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            health.tone === 'hot' && 'border-brand',
            className,
          )}
        >
          <span
            aria-hidden="true"
            className={cn('size-2.5 rounded-full', DOT[health.tone])}
          />
          {health.word}
          <span className="sr-only">, device health. Show details</span>
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label="Device health" className="grid w-80 gap-2">
        <span className="text-md font-semibold">{health.word}</span>
        <Caption>{health.advice}</Caption>
        {lines.length > 0 && (
          <ul className="m-0 grid gap-1 border-t border-border pt-2 pl-4 text-sm">
            {lines.map((line) => (
              <li key={String(line)}>{line}</li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
