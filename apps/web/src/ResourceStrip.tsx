import { useEffect, useState } from 'react';
import { monitoring, type Monitoring } from './api';
import { ChartLine, Waveform, WarningCircle } from '@phosphor-icons/react';
import { Button } from './components/ui/button';

const percent = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toFixed(0)}%`;

/** Persistent measured resources; diagnostics can freeze without freezing this strip. */
export function ResourceStrip({
  displayMode,
  connected,
  onDetails,
  onTuner,
}: {
  displayMode: string;
  connected: boolean;
  onDetails: () => void;
  onTuner?: () => void;
}) {
  const [state, setState] = useState<Monitoring | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let pending: AbortController | null = null;
    let sequence: number | undefined;
    let advanced = performance.now();
    async function refresh() {
      if (!active) return;
      clearTimeout(timer);
      pending?.abort();
      const abort = new AbortController();
      pending = abort;
      const deadline = setTimeout(() => abort.abort(), 4000);
      try {
        const next = await monitoring(abort.signal);
        if (!active || pending !== abort) return;
        if (sequence !== next.sequence) {
          sequence = next.sequence;
          advanced = performance.now();
        }
        if (performance.now() - advanced >= 3000)
          throw new Error('Monitoring sampler is stale');
        if (active) {
          setState(next);
          setDisconnected(false);
        }
      } catch {
        if (active && pending === abort) setDisconnected(true);
      } finally {
        clearTimeout(deadline);
        if (active && pending === abort)
          timer = setTimeout(
            () => void refresh(),
            displayMode === 'epaper' ? 5000 : 1000,
          );
      }
    }
    // Poll remains the fallback. Lifecycle SSE only invalidates the snapshot;
    // it never guesses state from a button click or increases meter refresh rates.
    const events = new EventSource('/api/v1/monitor/events');
    events.addEventListener('lifecycle', () => {
      sequence = undefined;
      advanced = performance.now();
      void refresh();
    });
    void refresh();
    return () => {
      events.close();
      active = false;
      pending?.abort();
      clearTimeout(timer);
    };
  }, [displayMode]);
  const running =
    state?.audio_phase === 'running' ||
    state?.graph_phase === 'running' ||
    state?.rig_phase === 'running';
  const starting = [
    state?.audio_phase,
    state?.graph_phase,
    state?.rig_phase,
  ].includes('starting');
  const stopping = [
    state?.audio_phase,
    state?.graph_phase,
    state?.rig_phase,
  ].includes('stopping');
  const failed =
    !running &&
    !starting &&
    !stopping &&
    (state?.audio_phase === 'failed' ||
      state?.graph_phase === 'failed' ||
      state?.rig_phase === 'failed');
  const fresh =
    !disconnected &&
    running &&
    state?.audio &&
    state.audio_age_ms != null &&
    state.audio_age_ms < 3000;
  const audio = fresh ? state.audio : null;
  const load =
    audio && audio.deadline_us > 0
      ? (100 * audio.process_us_p95) / audio.deadline_us
      : null;
  const peak =
    audio && audio.deadline_us > 0
      ? (100 * audio.process_us_max) / audio.deadline_us
      : null;
  const clips = audio
    ? [...audio.input, ...audio.output].reduce(
        (sum, channel) => sum + channel.clips,
        0,
      )
    : null;
  const host = disconnected ? null : state?.host;
  const used = host?.memory_used_bytes;
  const total = host?.memory_total_bytes;
  const memory =
    used != null && total != null && total > 0
      ? `${(used / 1073741824).toFixed(1)}/${(total / 1073741824).toFixed(1)} GiB`
      : '—';
  const status = disconnected
    ? 'Disconnected'
    : !state
      ? 'Connecting'
      : running
        ? fresh
          ? 'Audio running'
          : state.audio
            ? 'Audio stale'
            : 'Awaiting meters'
        : starting
          ? 'Audio starting'
          : stopping
            ? 'Audio stopping'
            : failed
              ? 'Audio failed'
              : 'Audio stopped';
  return (
    <aside
      className="resource-strip"
      aria-label="DSP and system resources"
      data-connected={connected && !disconnected}
    >
      <div className="resource-strip-state">
        {onTuner && (
          <Button
            variant="ghost"
            onClick={onTuner}
            aria-label="Open tuner"
            title="Tuner"
          >
            <span className="tuner-access">Tuner</span>
          </Button>
        )}
        <span className="sr-only" data-testid="resource-state">
          {status}
        </span>
        <Button
          variant="ghost"
          onClick={onDetails}
          aria-label="Open resource details"
          title={status}
          data-warning={failed || disconnected || !connected}
        >
          {failed || disconnected || !connected ? (
            <WarningCircle aria-hidden="true" />
          ) : running ? (
            <Waveform aria-hidden="true" />
          ) : (
            <ChartLine aria-hidden="true" />
          )}
        </Button>
      </div>
      <dl>
        <div
          data-warning={load != null && load >= 100}
          title="Measured processing p95 / audio-period deadline; excludes device I/O and scheduling"
        >
          <dt>DSP p95</dt>
          <dd>
            {percent(load)}{' '}
            <small data-warning={peak != null && peak >= 100}>
              pk {percent(peak)}
            </small>
          </dd>
        </div>
        <div title="Total host CPU, not the audio processing percentage">
          <dt>CPU</dt>
          <dd>{percent(host?.cpu_percent)}</dd>
        </div>
        <div title="Host memory used / total">
          <dt>RAM</dt>
          <dd>{memory}</dd>
        </div>
        <div
          data-warning={fresh && (state?.xruns ?? 0) > 0}
          title="Recovered audio overruns/underruns since this worker started"
        >
          <dt>Xruns</dt>
          <dd>{fresh && state?.xruns != null ? state.xruns : '—'}</dd>
        </div>
        <div
          data-warning={clips != null && clips > 0}
          title="Full-scale samples across input and output channels, cumulative for this worker"
        >
          <dt>Clips</dt>
          <dd>{clips ?? '—'}</dd>
        </div>
      </dl>
      {(!connected || disconnected || failed || (state && !fresh)) && (
        <p
          className="resource-alert"
          data-warning={
            !connected || disconnected || failed || status === 'Audio stale'
          }
          role="status"
        >
          {!connected || disconnected
            ? 'Connection lost · reconnecting'
            : failed
              ? 'Audio stopped unexpectedly · open diagnostics'
              : status}
        </p>
      )}
    </aside>
  );
}
