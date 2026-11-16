import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from '../components/ui/badge';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { ChartContainer, ChartTooltipContent } from '../components/ui/chart';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Caption } from '../components/ui/text';
import {
  AUDIT,
  CORES,
  CORE_HISTORY,
  DISK,
  DROPOUTS,
  MEMORY,
  PROCESSING,
  STREAM,
  TEMPERATURE,
} from './device-dashboard.data';

const INK = 'var(--foreground)';
const LIMIT = 'var(--brand)';
const AXIS = { fontSize: 11, fill: 'var(--muted-foreground)' };
const ago = (t: string | number) => {
  const m = -Number(t);
  return m < 0.05 ? 'Now' : `${m.toFixed(1)} min ago`;
};

/**
 * Device details, for players who want every number: headline readings,
 * then graphs over the last ten minutes (processing against the spare the
 * device keeps, temperature against its limit, each core, memory), where
 * the storage goes, dropouts per minute, the audio stream and engines, and
 * the audit log. Readings marked "New" are not reported by the device yet.
 */
export function DeviceDashboard() {
  const last = (d: { v: number }[]) => d[d.length - 1]!.v;
  return (
    <div className="grid gap-4 px-page">
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ['Processing', `${last(PROCESSING)}%`],
          ['CPU', `${Math.round(CORES.reduce((s, c) => s + c.load, 0) / 4)}%`],
          ['Memory', `${last(MEMORY)} GB`],
          ['Temperature', `${last(TEMPERATURE)} °C`],
          ['Storage', `${DISK.used} / ${DISK.total} GB`],
          ['Uptime', '2 d 4 h'],
        ].map(([k, v]) => (
          <div
            key={k}
            className="grid gap-0.5 rounded-lg border border-border bg-card px-3 py-2"
          >
            <dt className="small-caps text-xs text-muted-foreground">{k}</dt>
            <dd className="m-0 font-mono text-lg font-semibold tabular-nums">
              {v}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Trend
            label="Processing, share of each audio period"
            data={PROCESSING}
            unit="%"
            domain={[0, 100]}
            limit={85}
            limitLabel="Spare kept above 85%"
          />
        </Card>
        <Card>
          <Trend
            label="Temperature"
            data={TEMPERATURE}
            unit=" °C"
            domain={[40, 90]}
            limit={80}
            limitLabel="Protect at 80 °C"
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>CPU cores</CardTitle>
            <Badge size="sm">New</Badge>
          </CardHeader>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {CORE_HISTORY.map((data, i) => (
              <Trend
                key={i}
                compact
                label={`Core ${i + 1}${CORES[i]!.audio ? ' · audio' : ''}`}
                data={data}
                unit="%"
                domain={[0, 100]}
              />
            ))}
          </div>
        </Card>
        <Card>
          <Trend
            label="Memory · of 8 GB"
            data={MEMORY}
            unit=" GB"
            domain={[0, 8]}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Storage · SD card</CardTitle>
            <Badge size="sm">New</Badge>
          </CardHeader>
          <ChartContainer
            label={`${DISK.used} of ${DISK.total} GB used`}
            config={{ gb: { label: 'GB', color: INK } }}
            height="h-44"
          >
            <BarChart
              data={DISK.parts}
              layout="vertical"
              margin={{ left: 0, right: 56 }}
            >
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis
                type="category"
                dataKey="name"
                width={150}
                tick={AXIS}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'var(--accent)' }}
                content={<ChartTooltipContent unit=" GB" />}
              />
              <Bar
                dataKey="gb"
                name="Size"
                fill="var(--color-gb)"
                radius={[0, 4, 4, 0]}
                barSize={12}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey="gb"
                  position="right"
                  style={AXIS}
                  formatter={(v) => `${v} GB`}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        </Card>
        <Card>
          <ChartContainer
            label="Dropouts per minute"
            value={`${STREAM.xruns} now`}
            config={{ count: { label: 'Dropouts', color: INK } }}
            height="h-32"
          >
            <BarChart data={DROPOUTS} margin={{ left: -24, right: 4 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis
                dataKey="minute"
                tick={AXIS}
                tickFormatter={(m) => (m === 0 ? 'now' : `${-m}m`)}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={AXIS}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'var(--accent)' }}
                content={
                  <ChartTooltipContent
                    labelFormat={(m) =>
                      Number(m) === 0 ? 'This minute' : `${-Number(m)} min ago`
                    }
                  />
                }
              />
              <Bar
                dataKey="count"
                barSize={14}
                name="Dropouts"
                fill="var(--color-count)"
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </ChartContainer>
          <Caption className="text-xs">
            {STREAM.recovered} recovered on their own since boot.
          </Caption>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Audio stream</CardTitle>
          </CardHeader>
          <Facts
            rows={[
              ['Interface', STREAM.device],
              ['Sample rate', `${STREAM.rate / 1000} kHz`],
              ['Period', `${STREAM.frames} frames × ${STREAM.periods}`],
              [
                'Round trip',
                `${(((STREAM.frames * STREAM.periods * 2) / STREAM.rate) * 1000).toFixed(1)} ms`,
              ],
              ['Processed', `${STREAM.hours.toFixed(1)} h since boot`],
            ]}
          />
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Engines</CardTitle>
          </CardHeader>
          <Facts
            rows={[
              ['Audio', 'Running'],
              ['NAM engine', '3 captures loaded'],
              ['Effects graph', '9 blocks'],
              ['Stem splitter', 'Idle · 4 jobs today'],
              ['Screens', '2 · Wi-Fi hotspot'],
            ]}
          />
        </Card>
      </div>
      <AuditLog />
    </div>
  );
}

function Trend({
  label,
  data,
  unit,
  domain,
  limit,
  limitLabel,
  compact = false,
}: {
  label: string;
  data: { t: number; v: number }[];
  unit: string;
  domain: [number, number];
  limit?: number;
  limitLabel?: string;
  compact?: boolean;
}) {
  const now = data[data.length - 1]!.v;
  const hot = limit !== undefined && now >= limit;
  return (
    <ChartContainer
      label={label}
      value={`${now}${unit}`}
      config={{ v: { label, color: hot ? LIMIT : INK } }}
      height={compact ? 'h-14' : 'h-40'}
    >
      <AreaChart
        data={data}
        margin={
          compact
            ? { top: 2, bottom: 2, left: 0, right: 0 }
            : { top: 8, right: 8, left: -16, bottom: 0 }
        }
      >
        {!compact && <CartesianGrid vertical={false} stroke="var(--border)" />}
        <XAxis
          dataKey="t"
          type="number"
          domain={['dataMin', 0]}
          hide={compact}
          ticks={[-9.8, -5, 0]}
          tickFormatter={(t) => (t === 0 ? 'now' : `${Math.round(-t)} min`)}
          tick={AXIS}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={domain}
          hide={compact}
          tick={AXIS}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip
          cursor={{ stroke: INK, strokeWidth: 1, strokeDasharray: '3 3' }}
          content={<ChartTooltipContent unit={unit} labelFormat={ago} />}
        />
        {limit !== undefined && (
          <ReferenceLine
            y={limit}
            stroke={LIMIT}
            strokeDasharray="4 4"
            label={
              compact
                ? undefined
                : {
                    value: limitLabel,
                    position: 'insideTopRight',
                    fontSize: 11,
                    fill: 'var(--muted-foreground)',
                  }
            }
          />
        )}
        <Area
          dataKey="v"
          name={compact ? label : 'Now'}
          type="monotone"
          stroke="var(--color-v)"
          strokeWidth={2}
          fill="var(--color-v)"
          fillOpacity={0.08}
          dot={false}
          activeDot={{ r: 4, stroke: 'var(--card)', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

function AuditLog() {
  const [show, setShow] = useState<'all' | 'refused'>('all');
  const rows = AUDIT.filter((r) => show === 'all' || r.outcome !== 'Accepted');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <SegmentedControl
          size="sm"
          value={show}
          onValueChange={(v) => setShow(v as 'all' | 'refused')}
          aria-label="Show"
        >
          <Segment value="all">All</Segment>
          <Segment value="refused">Refused</Segment>
        </SegmentedControl>
      </CardHeader>
      <Caption className="text-xs">
        Every control request, without its contents. Accepted means the device
        took the request, not that the sound has changed yet.
      </Caption>
      <ul
        aria-label="Audit log entries"
        className="m-0 grid list-none p-0 text-sm"
      >
        {rows.map((r) => (
          <li
            key={r.at + r.operation}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-border py-1.5"
          >
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {r.at}
            </span>
            <span className="min-w-0 truncate">{r.operation}</span>
            <span className="text-right font-mono text-xs tabular-nums">
              {r.ms} ms
            </span>
            {r.outcome !== 'Accepted' && (
              <span className="col-start-2">
                <Badge
                  size="sm"
                  tone="warning"
                >{`${r.outcome} · ${r.status}`}</Badge>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="m-0 text-right font-mono text-xs tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
