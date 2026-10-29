import { useEffect, useState } from 'react';
import {
  ArrowClockwise,
  DownloadSimple,
  ClockCounterClockwise,
} from '@phosphor-icons/react';
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { monitoringHistory, type MonitoringHistory as History } from './api';
import { Button } from './components/ui/button';
import { ChartContainer } from './components/ui/chart';

/** Appliance-owned samples, distinct from the live browser's Freeze/Reset view. */
export function MonitoringHistory() {
  const [open, setOpen] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [state, setState] = useState<History | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void monitoringHistory(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(String(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [open, generation]);
  const records = state?.records ?? [];
  const points = records.map((record, index) => {
    const sample = record.readings;
    const previous = records[index - 1];
    const boundary =
      previous &&
      (previous.recorder_session !== record.recorder_session ||
        previous.audio_session !== record.audio_session ||
        record.elapsed_ms - previous.elapsed_ms > 15000);
    const valid =
      sample.audio && sample.audio_age_ms != null && sample.audio_age_ms < 3000;
    return {
      time: new Date(record.recorded_at_ms).toLocaleTimeString(),
      cpu: boundary ? null : sample.host.cpu_percent,
      dsp:
        !boundary && valid && sample.audio!.deadline_us > 0
          ? (100 * sample.audio!.process_us_p95) / sample.audio!.deadline_us
          : null,
    };
  });
  return (
    <details
      className="control-help"
      onToggle={(event) => {
        const opened = event.currentTarget.open;
        setOpen(opened);
        if (opened) {
          setBusy(true);
          setError('');
        }
      }}
    >
      <summary>
        <ClockCounterClockwise aria-hidden="true" className="inline size-4" />{' '}
        Device history
      </summary>
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
                <DownloadSimple aria-hidden="true" /> Export history
              </a>
            </Button>
          </div>
          <p className="caption">
            Recorded on the device every 5 seconds, even with the browser
            closed. Up to 8 MiB retained across restarts. Export includes all
            retained samples; this view shows the latest 720.
          </p>
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
              <p className="caption">
                {new Date(records[0]!.recorded_at_ms).toLocaleString()} –{' '}
                {new Date(records.at(-1)!.recorded_at_ms).toLocaleString()} ·{' '}
                {records.length} samples
              </p>
              <ChartContainer
                label="Recorded DSP and CPU · %"
                config={{
                  dsp: { label: 'DSP p95', color: 'var(--control-accent)' },
                  cpu: {
                    label: 'Host CPU',
                    color: 'var(--chart-secondary)',
                    dashed: true,
                  },
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
                    type="linear"
                    dataKey="dsp"
                    name="DSP p95"
                    stroke="var(--control-accent)"
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="linear"
                    dataKey="cpu"
                    name="Host CPU"
                    stroke="var(--chart-secondary)"
                    strokeDasharray="6 4"
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
              <p className="caption">
                Gaps mark stopped/stale audio, a session change or missed
                recording. Device time may change when networking synchronises
                the clock; exports include recorder identity and elapsed time.
              </p>
            </>
          )}
        </div>
      )}
    </details>
  );
}
