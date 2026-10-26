import type { CSSProperties, ReactElement } from 'react';
import { ResponsiveContainer } from 'recharts';

/** Semantic chart container following shadcn's composable Recharts pattern.
 * @see https://ui.shadcn.com/docs/components/radix/chart
 */
export function ChartContainer({
  children,
  label,
  config,
}: {
  children: ReactElement;
  label: string;
  config: Record<string, { label: string; color: string; dashed?: boolean }>;
}) {
  const style = Object.fromEntries(
    Object.entries(config).map(([key, value]) => [
      `--color-${key}`,
      value.color,
    ]),
  ) as CSSProperties;
  return (
    <figure
      aria-label={label}
      className="min-w-0 rounded-md border border-border p-3"
      style={style}
    >
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm font-medium">
        {label}
        <span className="flex gap-3 text-xs">
          {Object.entries(config).map(([key, value]) => (
            <span key={key} className="flex items-center gap-1">
              <span
                aria-hidden="true"
                className="w-5 border-t-2"
                style={{
                  borderColor: value.color,
                  borderStyle: value.dashed ? 'dashed' : 'solid',
                }}
              />
              {value.label}
            </span>
          ))}
        </span>
      </figcaption>
      <div className="h-40 min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          {children}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
