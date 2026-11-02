import { useMonitorFeed } from './monitorFeed';
import { processingHeadroom } from './processingHeadroom';

const percent = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toFixed(0)}%`;

/** Persistent measured resources; diagnostics can freeze without freezing this strip. */
export function ResourceStrip({
  displayMode,
  connected,
}: {
  displayMode: string;
  connected: boolean;
}) {
  const feed = useMonitorFeed(displayMode === 'epaper' ? 5000 : 1000);
  const state = feed.snapshot;
  const disconnected = feed.disconnected;
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
  const { p95: load, peak, tight } = processingHeadroom(audio);
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
              : [state.audio_phase, state.graph_phase, state.rig_phase].every(
                    (phase) => phase === 'unavailable',
                  )
                ? 'Audio unavailable'
                : 'Audio stopped';
  return (
    <aside
      className="resource-strip"
      aria-label="DSP and system resources"
      data-connected={connected && !disconnected}
    >
      <div className="resource-strip-state">
        <span className="sr-only" data-testid="resource-state">
          {status}
        </span>
      </div>
      <dl>
        <div
          data-warning={tight}
          title="Processing p95 and session peak / audio-period deadline; excludes device I/O"
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
          title="Recovered audio overruns/underruns since audio last started"
        >
          <dt>Xruns</dt>
          <dd>{fresh && state?.xruns != null ? state.xruns : '—'}</dd>
        </div>
        <div
          data-warning={clips != null && clips > 0}
          title="Full-scale samples across input and output channels, counted since audio last started"
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
