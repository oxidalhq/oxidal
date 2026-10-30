import { ControlAudit } from './ControlAudit';
import { MonitoringHistory } from './MonitoringHistory';
import './Monitoring.css';
import { useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Monitoring as Readings } from './api';
import { useMonitorReadings } from './monitorFeed';
import { Button } from './components/ui/button';
import { ChartContainer } from './components/ui/chart';
type Point = {
  time: string;
  left: number | null;
  right: number | null;
  deadline: number | null;
  cpu: number | null;
  memory: number | null;
  temperature: number | null;
  xruns: number | null;
};
const colour = {
  left: { label: 'Left', color: 'var(--control-accent)' },
  right: { label: 'Right', color: 'var(--chart-secondary)', dashed: true },
};
const tooltipStyle = {
  background: 'var(--popover)',
  color: 'var(--popover-foreground)',
  border: '1px solid var(--border)',
  borderRadius: 6,
};
const number = (value: number | null | undefined, suffix = '') =>
  value == null ? 'Unavailable' : `${value.toFixed(1)}${suffix}`;
function Meter({
  label,
  channel,
  clips,
  stale,
}: {
  label: string;
  channel: NonNullable<Readings['audio']>['input'][number] | undefined;
  clips: number;
  stale: boolean;
}) {
  const level =
    channel && !stale
      ? Math.max(0, Math.min(100, ((channel.peak_dbfs + 60) / 60) * 100))
      : 0;
  const rms =
    channel && !stale
      ? Math.max(0, Math.min(100, ((channel.rms_dbfs + 60) / 60) * 100))
      : 0;
  return (
    <div className="meter-row" data-clip={clips > 0 || undefined}>
      <span className="meter-label">{label}</span>
      <div
        role="meter"
        aria-label={`${label} peak`}
        aria-valuemin={-60}
        aria-valuemax={0}
        aria-valuenow={
          channel && !stale
            ? Math.max(-60, Math.min(0, channel.peak_dbfs))
            : undefined
        }
        aria-valuetext={
          stale ? 'No live reading' : number(channel?.peak_dbfs, ' dBFS')
        }
        className="meter-track"
      >
        <i style={{ width: `${rms}%` }} />
        <b style={{ left: `${level}%` }} />
      </div>
      <span className="meter-read">
        {stale || !channel ? '—' : channel.peak_dbfs.toFixed(1)}
        <small> pk</small>
      </span>
      <span className="meter-sub">
        {clips > 0
          ? `Clip · ${clips}`
          : stale
            ? 'No live reading'
            : `RMS ${number(channel?.rms_dbfs)}`}
      </span>
    </div>
  );
}
export function Monitoring({ displayMode }: { displayMode: string }) {
  const [state, setState] = useState<Readings | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [error, setError] = useState('');
  const [frozen, setFrozen] = useState(false);
  const [slow, setSlow] = useState(false);
  const [baseline, setBaseline] = useState([0, 0, 0, 0]);
  const latest = useRef(0);
  const lastAudio = useRef<{
    source: string | null | undefined;
    frames: number;
  } | null>(null);
  const every = slow || displayMode === 'epaper' ? 5000 : 1000;
  const accepted = useRef(0);
  useMonitorReadings(every, (feed) => {
    if (frozen) return;
    if (feed.disconnected && feed.link == null) {
      setError('Disconnected · readings are stale');
      return;
    }
    const next = feed.snapshot;
    if (!next || feed.at == null) return;
    // Other views may keep the shared feed faster; Slow refresh still thins this page.
    if (feed.at - accepted.current < every - 100) return;
    accepted.current = feed.at;
    setState(next);
    setError('');
    if (next.audio) {
      if (
        lastAudio.current &&
        (lastAudio.current.source !== next.source ||
          next.audio.frames < lastAudio.current.frames)
      )
        setBaseline([0, 0, 0, 0]);
      lastAudio.current = {
        source: next.source,
        frames: next.audio.frames,
      };
    }
    if (next.sequence !== latest.current) {
      latest.current = next.sequence;
      const valid =
        next.audio && next.audio_age_ms != null && next.audio_age_ms < 3000;
      setHistory((h) => [
        ...h.slice(-119),
        {
          time: new Date().toLocaleTimeString(),
          left: valid ? next.audio!.output[0].peak_dbfs : null,
          right: valid ? next.audio!.output[1].peak_dbfs : null,
          deadline:
            valid && next.audio!.deadline_us > 0
              ? (100 * next.audio!.process_us_p95) / next.audio!.deadline_us
              : null,
          cpu: next.host.cpu_percent ?? null,
          memory:
            next.host.memory_used_bytes != null
              ? next.host.memory_used_bytes / 1048576
              : null,
          temperature: next.host.temperature_c ?? null,
          xruns: valid ? (next.xruns ?? null) : null,
        },
      ]);
    }
  });
  const stale =
    !!error ||
    !state?.audio ||
    state.audio_age_ms == null ||
    state.audio_age_ms >= 3000;
  const channels = [
    ...(state?.audio?.input ?? []),
    ...(state?.audio?.output ?? []),
  ];
  const stream = state?.stream;
  return (
    <section
      className="instrument-surface grid gap-4"
      aria-label="Audio and system monitoring"
    >
      <div className="monitor-bar">
        <p
          role="status"
          className="monitor-state"
          data-live={
            (!frozen && !error && !!state?.source && !stale) || undefined
          }
        >
          {frozen
            ? 'Frozen readings'
            : error ||
              (state?.source
                ? `${state.source} · ${stale ? 'waiting for live readings' : 'live'}`
                : 'Audio stopped')}
        </p>
        <div className="monitor-actions">
          <Button
            variant="ghost"
            aria-label={frozen ? 'Resume readings' : 'Freeze readings'}
            aria-pressed={frozen}
            onClick={() => setFrozen((v) => !v)}
          >
            {frozen ? 'Resume' : 'Freeze'}
          </Button>
          <Button
            variant="ghost"
            aria-label="Reset view"
            onClick={() => {
              setBaseline(channels.map((c) => c.clips));
              setHistory([]);
            }}
          >
            Reset
          </Button>
          <Button
            variant="ghost"
            aria-pressed={slow || displayMode === 'epaper'}
            disabled={displayMode === 'epaper'}
            onClick={() => setSlow((v) => !v)}
          >
            Slow refresh
          </Button>
        </div>
      </div>
      <div className="meter-list" aria-label="Levels">
        {['Input L', 'Input R', 'Output L', 'Output R'].map((label, i) => (
          <Meter
            key={label}
            label={label}
            channel={channels[i]}
            clips={Math.max(0, (channels[i]?.clips ?? 0) - (baseline[i] ?? 0))}
            stale={stale}
          />
        ))}
      </div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <ChartContainer label="Output peak · dBFS" config={colour}>
          <LineChart
            accessibilityLayer
            data={history}
            margin={{ left: 0, right: 5 }}
          >
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="time" hide />
            <YAxis
              width={38}
              domain={[-60, 0]}
              ticks={[-60, -30, 0]}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <ReferenceLine y={0} stroke="var(--destructive)" />
            <Tooltip contentStyle={tooltipStyle} />
            <Line
              name="Left dBFS"
              type="linear"
              dataKey="left"
              stroke="var(--color-left)"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              name="Right dBFS"
              type="linear"
              dataKey="right"
              stroke="var(--color-right)"
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
        <ChartContainer
          label="Processing budget · %"
          config={{
            deadline: { label: 'DSP p95', color: 'var(--control-accent)' },
            cpu: {
              label: 'System CPU',
              color: 'var(--chart-secondary)',
              dashed: true,
            },
          }}
        >
          <AreaChart accessibilityLayer data={history}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="time" hide />
            <YAxis
              width={38}
              domain={[0, 100]}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <ReferenceLine y={100} stroke="var(--destructive)" />
            <Tooltip contentStyle={tooltipStyle} />
            <Area
              name="DSP deadline %"
              type="linear"
              dataKey="deadline"
              stroke="var(--color-deadline)"
              fill="var(--color-deadline)"
              fillOpacity={0.12}
              isAnimationActive={false}
            />
            <Line
              name="System CPU %"
              type="linear"
              dataKey="cpu"
              stroke="var(--color-cpu)"
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ChartContainer>
      </div>
      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <ChartContainer
          label="Memory & temperature"
          config={{
            memory: { label: 'RAM · MiB', color: 'var(--control-accent)' },
            temperature: {
              label: 'CPU · °C',
              color: 'var(--chart-secondary)',
              dashed: true,
            },
          }}
        >
          <LineChart accessibilityLayer data={history}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="time" hide />
            <YAxis
              yAxisId="memory"
              width={42}
              domain={[0, 'auto']}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <YAxis
              yAxisId="temperature"
              orientation="right"
              width={30}
              domain={[0, 100]}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Line
              yAxisId="memory"
              name="RAM MiB"
              dataKey="memory"
              stroke="var(--color-memory)"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              yAxisId="temperature"
              name="CPU °C"
              dataKey="temperature"
              stroke="var(--color-temperature)"
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
        <ChartContainer
          label="Audio recovery · xruns"
          config={{
            xruns: { label: 'Worker total', color: 'var(--destructive)' },
          }}
        >
          <LineChart accessibilityLayer data={history}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="time" hide />
            <YAxis
              width={38}
              domain={[0, 'auto']}
              allowDecimals={false}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Line
              name="Recovered xruns"
              type="stepAfter"
              dataKey="xruns"
              stroke="var(--color-xruns)"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </div>
      <dl className="health-list">
        <div>
          <dt className="text-muted-foreground">Process p50 / p95 / max</dt>
          <dd className="font-mono">
            {stale
              ? 'Unavailable'
              : `${number(state?.audio?.process_us_p50)} / ${number(state?.audio?.process_us_p95)} / ${number(state?.audio?.process_us_max)} µs`}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Sample rate / period</dt>
          <dd>
            {stream
              ? `${stream.input.sample_rate} Hz / ${stream.input.period_frames} frames`
              : 'Unavailable'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Capture / playback buffer</dt>
          <dd>
            {stream
              ? `${stream.input.period_frames * stream.input.periods} / ${stream.output.period_frames * stream.output.periods} frames`
              : 'Unavailable'}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">System CPU</dt>
          <dd>{number(state?.host.cpu_percent, '%')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">CPU temperature</dt>
          <dd>{number(state?.host.temperature_c, ' °C')}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Memory used</dt>
          <dd>
            {state?.host.memory_used_bytes != null
              ? `${Math.round(state.host.memory_used_bytes / 1048576)} / ${Math.round((state.host.memory_total_bytes ?? 0) / 1048576)} MiB`
              : 'Unavailable'}
          </dd>
        </div>
      </dl>
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      <MonitoringHistory />
      <ControlAudit />
      <details>
        <summary>Measurement details</summary>
        <p className="caption break-words">
          TONE3000 audio: {state?.audio_phase || 'reading'} · Effects audio:{' '}
          {state?.graph_phase || 'reading'} · Mixed rig:{' '}
          {state?.rig_phase || 'reading'}
          {stream && ` · ${stream.input.endpoint} → ${stream.output.endpoint}`}
        </p>

        <p className="caption">
          Levels measure the mapped DSP input/output, before physical output
          mixing. −120 dBFS is the display floor. Clip counts are full-scale
          samples; Reset view clears only this browser’s history and clip hold.
          The audio interface accepts these settings exactly or refuses to
          start. Processing statistics cover the latest 128 blocks and exclude
          device I/O. Buffer sizes are not a round-trip latency measurement.
          Recovered xruns are counted since audio last started. Throttling flags
          remain unavailable. Charts retain at most 120 samples in this browser;
          sampling slows on e-paper and pauses while the page is hidden.
        </p>
      </details>
    </section>
  );
}
