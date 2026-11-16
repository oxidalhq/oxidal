import * as React from 'react';
import { ResponsiveContainer } from 'recharts';
import { cn } from '../../lib/cn';

export type ChartConfig = Record<
  string,
  { label: string; color: string; dashed?: boolean }
>;

/**
 * shadcn's chart pattern on Recharts (the product's `ChartContainer`): a
 * figure with the title and a legend from `config`, each series' colour as
 * `--color-<key>`, and a responsive plot. One series needs no legend; the
 * title names it. Charts are ink on paper; oxide only marks a limit.
 * @see https://ui.shadcn.com/docs/components/chart
 */
export function ChartContainer({
  label,
  value,
  config,
  height = 'h-40',
  className,
  children,
}: {
  label: string;
  /** The current reading, shown large beside the title. */
  value?: React.ReactNode;
  config: ChartConfig;
  height?: string;
  className?: string;
  children: React.ReactElement;
}) {
  const style = Object.fromEntries(
    Object.entries(config).map(([key, v]) => [`--color-${key}`, v.color]),
  ) as React.CSSProperties;
  const entries = Object.entries(config);
  return (
    <figure
      data-slot="chart"
      aria-label={label}
      className={cn('m-0 grid min-w-0 gap-2', className)}
      style={style}
    >
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="small-caps text-sm font-medium text-muted-foreground">
          {label}
        </span>
        {value !== undefined && (
          <span className="font-mono text-lg font-semibold tabular-nums">
            {value}
          </span>
        )}
        {entries.length > 1 && (
          <span className="flex w-full flex-wrap gap-3 text-xs">
            {entries.map(([key, v]) => (
              <span key={key} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="w-5 border-t-2"
                  style={{
                    borderColor: v.color,
                    borderStyle: v.dashed ? 'dashed' : 'solid',
                  }}
                />
                {v.label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <div className={cn('min-w-0 overflow-hidden', height)}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** The hover card: the time on top, then each value in ink with its unit. */
export function ChartTooltipContent({
  active,
  payload,
  label,
  unit = '',
  labelFormat = (l) => String(l),
}: {
  active?: boolean;
  payload?: {
    name?: string;
    value?: number | string;
    dataKey?: string | number;
  }[];
  label?: string | number;
  unit?: string;
  labelFormat?: (label: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="grid gap-0.5 rounded-md border border-border bg-raised px-2.5 py-1.5 text-xs shadow-raised">
      {label !== undefined && (
        <span className="text-muted-foreground">{labelFormat(label)}</span>
      )}
      {payload.map((p) => (
        <span
          key={String(p.dataKey)}
          className="flex justify-between gap-3 font-mono tabular-nums"
        >
          <span className="font-sans">{p.name}</span>
          {typeof p.value === 'number' ? p.value.toFixed(1) : p.value}
          {unit}
        </span>
      ))}
    </div>
  );
}
