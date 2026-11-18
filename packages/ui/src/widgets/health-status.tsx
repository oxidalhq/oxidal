import { ArrowRight } from '@phosphor-icons/react';

import { Button } from '../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Caption } from '../components/ui/text';
import { cn } from '../lib/cn';
import { healthOf } from '../lib/health';
import type { ResourceReadings, ResourceState } from './resource-strip';

const DOT = {
  good: 'bg-current',
  busy: 'bg-wire',
  hot: 'bg-brand',
  off: 'bg-transparent border-2 border-current',
} as const;

/** One reading: its name, a bar against its limit, and the number. */
function Reading({
  label,
  value,
  share,
  mark,
  limit,
  note,
}: {
  label: string;
  /** The number as text, such as "42%" or "58 °C". */
  value: string;
  /** How full the bar is, 0 to 1. */
  share: number;
  /** A second point on the bar, such as the peak. */
  mark?: number;
  /** Where the limit sits on the bar, 0 to 1; past it the bar turns oxide. */
  limit?: number;
  note?: string;
}) {
  const over = limit !== undefined && Math.max(share, mark ?? 0) >= limit;
  const at = (v: number) => `${Math.min(100, Math.max(0, v * 100))}%`;
  return (
    <div
      role="group"
      aria-label={`${label}: ${value}${note ? `, ${note}` : ''}`}
      className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-x-3"
    >
      <span className="small-caps text-xs text-muted-foreground">{label}</span>
      <span aria-hidden="true" className="relative h-2 rounded-full bg-wire/30">
        <span
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            over ? 'bg-brand' : 'bg-foreground',
          )}
          style={{ width: at(share) }}
        />
        {mark !== undefined && (
          <span
            className={cn(
              'absolute -inset-y-0.5 w-0.5 rounded-full',
              over ? 'bg-brand' : 'bg-foreground',
            )}
            style={{ left: at(mark) }}
          />
        )}
        {limit !== undefined && (
          <span
            className="absolute -inset-y-1 w-px bg-brand"
            style={{ left: at(limit) }}
          />
        )}
      </span>
      <span
        className={cn(
          'text-right font-mono text-md font-bold tabular-nums',
          over && 'text-brand',
        )}
      >
        {value}
      </span>
      {note && (
        <Caption as="span" className="col-start-2 col-end-4 text-2xs">
          {note}
        </Caption>
      )}
    </div>
  );
}

/**
 * The device's health in one word with a dot — All good, Busy, Dropouts,
 * Clipping, Running hot, Audio stopped, Disconnected — for everyone. Tap it
 * for a small readout: each number with a bar against its limit (the oxide
 * line), dropouts and clips as counts, and the way to the full device page.
 * Players who want the strip always visible turn it on in Settings ›
 * Display.
 */
export function HealthStatus({
  readings,
  state = 'live',
  onDetails,
  className,
}: {
  readings: ResourceReadings;
  state?: ResourceState;
  /** Opens Levels › Device details. */
  onDetails?: () => void;
  className?: string;
}) {
  const health = healthOf(readings, state);
  const off = state !== 'live';
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const xruns = readings.xruns ?? 0;
  const clips = readings.clips ?? 0;
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
      <PopoverContent
        aria-label="Device health"
        className={cn(
          'grid gap-4 p-4',
          off
            ? 'w-96'
            : 'w-[44rem] md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-6',
        )}
      >
        <div className="grid content-start gap-3">
          <div className="grid gap-1">
            <span className="flex items-center gap-2 font-display text-2xl leading-tight font-semibold">
              <span
                aria-hidden="true"
                className={cn('size-3 shrink-0 rounded-full', DOT[health.tone])}
              />
              {health.word}
            </span>
            <Caption>{health.advice}</Caption>
          </div>
          {!off && (
            <div className="grid gap-1">
              <dl className="m-0 grid grid-cols-2 gap-2">
                {(
                  [
                    ['Dropouts', xruns],
                    ['Clips', clips],
                  ] as const
                ).map(([name, count]) => (
                  <div
                    key={name}
                    className={cn(
                      'grid gap-0.5 rounded-lg border border-border px-3 py-2',
                      count > 0 && 'border-brand',
                    )}
                  >
                    <dt className="small-caps text-xs text-muted-foreground">
                      {name}
                    </dt>
                    <dd
                      className={cn(
                        'm-0 font-mono text-2xl leading-tight font-bold tabular-nums',
                        count > 0 && 'text-brand',
                      )}
                    >
                      {count}
                    </dd>
                  </div>
                ))}
              </dl>
              <Caption className="text-2xs">
                Counted since the preset started.
              </Caption>
            </div>
          )}
          {onDetails && (
            <Button
              size="sm"
              variant="outline"
              className="justify-self-start"
              onClick={onDetails}
            >
              Device details <ArrowRight />
            </Button>
          )}
        </div>
        {!off && (
          <div className="grid content-start gap-3 border-t border-border pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
            {readings.dsp && (
              <Reading
                label="Processing"
                value={pct(readings.dsp.p95)}
                share={readings.dsp.p95}
                mark={readings.dsp.peak}
                limit={0.85}
                note={`Peaks at ${pct(readings.dsp.peak)} of each audio period; the line is the limit`}
              />
            )}
            {readings.cpu !== undefined && readings.cpu !== null && (
              <Reading
                label="Whole device"
                value={`${Math.round(readings.cpu)}%`}
                share={readings.cpu / 100}
              />
            )}
            {readings.ram && (
              <Reading
                label="Memory"
                value={`${(readings.ram.used / 1024).toFixed(1)} GB`}
                share={readings.ram.used / readings.ram.total}
                note={`of ${Math.round(readings.ram.total / 1024)} GB`}
              />
            )}
            {readings.temperature !== undefined &&
              readings.temperature !== null && (
                <Reading
                  label="Temperature"
                  value={`${Math.round(readings.temperature)} °C`}
                  share={(readings.temperature - 30) / 60}
                  limit={(80 - 30) / 60}
                />
              )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
