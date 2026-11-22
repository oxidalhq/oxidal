import { ArrowClockwise, DownloadSimple } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@oxidal/design-system/components/button';
import { ChartContainer } from '@oxidal/design-system/components/chart';
import { FormField } from '@oxidal/design-system/components/form-layout';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import { Caption } from '@oxidal/design-system/components/text';

import { type MonitoringHistory as History, monitoringHistory } from './api';
import { historyCsv, historyPoints, recordedCoreIds } from './historyData';
import { friendlyError } from './lib/friendlyError';

/** Appliance-owned samples, distinct from the live browser's Freeze/Reset view. */
export function MonitoringHistory() {
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<History | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [range, setRange] = useState('all');
  const [metric, setMetric] = useState('load');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void monitoringHistory(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(friendlyError(cause, 'read the level history'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [open, generation]);
  const all = state?.records ?? [];
  const latest = all.at(-1);
  const records =
    range === 'all'
      ? all
      : all.filter(
          (r) =>
            latest &&
            r.recorder_session === latest.recorder_session &&
            r.elapsed_ms >= latest.elapsed_ms - Number(range) * 60000,
        );
  const points = historyPoints(records);
  const cores = recordedCoreIds(records);
  const series = metric.startsWith('core_')
    ? { key: metric, label: `CPU ${metric.slice(5)}`, unit: '%' }
    : metric === 'audioCpu'
      ? { key: metric, label: 'Audio thread CPU', unit: 'core number' }
      : metric === 'memory'
        ? { key: 'memory', label: 'RAM', unit: '%' }
        : metric === 'temperature'
          ? { key: 'temperature', label: 'Temperature', unit: '°C' }
          : metric === 'xruns'
            ? { key: 'xruns', label: 'New xruns per sample', unit: 'count' }
            : { key: 'dsp', label: 'DSP p95', unit: '%' };
  function exportShown() {
    const url = URL.createObjectURL(
      new Blob([historyCsv(records)], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'oxidal-monitor-shown.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <details
      className="border-y border-border py-1 text-sm [&>p]:mb-3 [&>p]:text-muted-foreground [&>summary]:flex [&>summary]:min-h-touch [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:justify-between [&>summary]:gap-3 [&>summary]:font-medium [&>summary]:after:text-lg [&>summary]:after:text-muted-foreground [&>summary]:after:content-['›'] open:[&>summary]:after:content-['−']"
      onToggle={(event) => {
        const opened = event.currentTarget.open;
        setOpen(opened);
        if (opened) {
          setBusy(true);
          setError('');
        }
      }}
    >
      <summary>Device history</summary>
      {open && (
        <div
          className="grid min-w-0 gap-3 pt-3"
          aria-label="Recorded monitoring history"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                setGeneration((n) => n + 1);
              }}
            >
              <ArrowClockwise aria-hidden="true" />{' '}
              {busy ? 'Reading…' : 'Refresh history'}
            </Button>
            <Button variant="outline" asChild>
              <a href="/api/v1/monitor/history/export" download>
                <DownloadSimple aria-hidden="true" /> Export all JSON
              </a>
            </Button>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <FormField>
              History range
              <Select value={range} onValueChange={setRange}>
                <SelectTrigger aria-label="History range">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All loaded</SelectItem>
                  <SelectItem value="5">Last 5 min · this run</SelectItem>
                  <SelectItem value="15">Last 15 min · this run</SelectItem>
                  <SelectItem value="60">Last hour · this run</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              History metric
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger aria-label="History metric">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="load">DSP / CPU</SelectItem>
                  {cores.map((core) => (
                    <SelectItem key={core} value={`core_${core}`}>
                      CPU {core}
                    </SelectItem>
                  ))}
                  <SelectItem value="audioCpu">Audio thread CPU</SelectItem>
                  <SelectItem value="memory">RAM</SelectItem>
                  <SelectItem value="temperature">Temperature</SelectItem>
                  <SelectItem value="xruns">New xruns</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <Button
            variant="outline"
            disabled={!records.length}
            onClick={exportShown}
          >
            <DownloadSimple aria-hidden="true" />
            Export shown CSV
          </Button>
          <Caption>
            5-second samples · latest 720 loaded. JSON includes all retained
            data; CSV includes the selected range and all readings.
          </Caption>
          {error && <p role="alert">{error}</p>}
          {state &&
            (state.storage_error ||
              state.dropped_samples > 0 ||
              state.skipped_records > 0) && (
              <p role="status" className="text-sm text-destructive">
                {state.storage_error ? 'History storage failed. ' : ''}
                {state.dropped_samples} samples dropped this run ·{' '}
                {state.skipped_records} unreadable records skipped. Audio is
                unaffected.
              </p>
            )}
          {state && !records.length && (
            <p>No recorded samples yet. Refresh after a few seconds.</p>
          )}
          {records.length > 0 && (
            <>
              <Caption>
                {new Date(records[0]!.recorded_at_ms).toLocaleString()} –{' '}
                {new Date(records.at(-1)!.recorded_at_ms).toLocaleString()} ·{' '}
                {records.length} samples
              </Caption>
              <ChartContainer
                label={
                  metric === 'load'
                    ? 'Recorded DSP and CPU · %'
                    : `Recorded ${series.label} · ${series.unit}`
                }
                config={{
                  [series.key]: {
                    label: series.label,
                    color: 'var(--control-accent)',
                  },
                  ...(metric === 'load'
                    ? {
                        cpu: {
                          label: 'Host CPU',
                          color: 'var(--chart-secondary)',
                          dashed: true,
                        },
                      }
                    : {}),
                }}
              >
                <LineChart accessibilityLayer data={points}>
                  <CartesianGrid vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="time"
                    minTickGap={65}
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  />
                  <YAxis
                    width={36}
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--popover)',
                      color: 'var(--popover-foreground)',
                      border: '1px solid var(--border)',
                    }}
                  />
                  <Line
                    type={metric === 'audioCpu' ? 'stepAfter' : 'linear'}
                    dataKey={series.key}
                    name={series.label}
                    stroke="var(--control-accent)"
                    dot={false}
                    isAnimationActive={false}
                  />
                  {metric === 'load' && (
                    <Line
                      type="linear"
                      dataKey="cpu"
                      name="Host CPU"
                      stroke="var(--chart-secondary)"
                      strokeDasharray="6 4"
                      dot={false}
                      isAnimationActive={false}
                    />
                  )}
                </LineChart>
              </ChartContainer>
              {!cores.length && (
                <Caption>
                  Per-core CPU readings are unavailable for this range.
                </Caption>
              )}
              {metric === 'audioCpu' &&
                !points.some((p) => p.audioCpu != null) && (
                  <Caption>
                    Audio thread CPU is unavailable for this range.
                  </Caption>
                )}
              {metric === 'xruns' && (
                <Caption>
                  Recovered underruns/overruns between samples. Gaps mean stale
                  data, a counter reset or a new audio session; they do not mean
                  zero.
                </Caption>
              )}
              <details className="border-y border-border py-1 text-sm [&>p]:mb-3 [&>p]:text-muted-foreground [&>summary]:flex [&>summary]:min-h-touch [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:justify-between [&>summary]:gap-3 [&>summary]:font-medium [&>summary]:after:text-lg [&>summary]:after:text-muted-foreground [&>summary]:after:content-['›'] open:[&>summary]:after:content-['−']">
                <summary>Recording details</summary>
                <Caption>
                  Recorded even with the browser closed; up to 8 MiB survives
                  restarts. Gaps mark stale audio, session changes or missed
                  samples. Exports include recorder identity and elapsed time
                  for clock corrections.
                </Caption>
              </details>
            </>
          )}
        </div>
      )}
    </details>
  );
}
