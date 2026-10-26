import { useEffect, useState } from 'react';
import { monitoring, type Monitoring } from './api';
import { Button } from './components/ui/button';

const percent = (n: number | null | undefined) =>
  n == null ? '—' : `${n.toFixed(0)}%`;

/** Persistent measured resources; diagnostics can freeze without freezing this strip. */
export function ResourceStrip({
  displayMode,
  onDetails,
}: {
  displayMode: string;
  onDetails: () => void;
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
      const abort = new AbortController();
      pending = abort;
      const deadline = setTimeout(() => abort.abort(), 4000);
      try {
        const next = await monitoring(abort.signal);
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
        if (active) setDisconnected(true);
      } finally {
        clearTimeout(deadline);
        if (active)
          timer = setTimeout(
            () => void refresh(),
            displayMode === 'epaper' ? 5000 : 1000,
          );
      }
    }
    void refresh();
    return () => {
      active = false;
      pending?.abort();
      clearTimeout(timer);
    };
  }, [displayMode]);
  const running =
    state?.audio_phase === 'running' || state?.graph_phase === 'running';
  const failed =
    state?.audio_phase === 'failed' || state?.graph_phase === 'failed';
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
      : failed
        ? 'Audio failed'
        : running
          ? fresh
            ? 'Audio running'
            : 'Audio stale'
          : 'Audio stopped';
  return (
    <aside className="resource-strip" aria-label="DSP and system resources">
      <div className="resource-strip-state">
        <span data-testid="resource-state">{status}</span>
        <Button
          variant="outline"
          onClick={onDetails}
          aria-label="Open resource details"
        >
          Details
        </Button>
      </div>
      <dl>
        <div
          data-warning={peak != null && peak >= 100}
          title="Measured processing p95 / audio-period deadline; excludes device I/O and scheduling"
        >
          <dt>DSP p95</dt>
          <dd>
            {percent(load)} <small>pk {percent(peak)}</small>
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
        <div title="Cumulative xruns; unavailable until the audio transport reports them">
          <dt>Xruns</dt>
          <dd>{fresh && state?.xruns != null ? state.xruns : 'N/A'}</dd>
        </div>
        <div
          data-warning={clips != null && clips > 0}
          title="Full-scale samples across input and output channels, cumulative for this worker"
        >
          <dt>Clips</dt>
          <dd>{clips ?? '—'}</dd>
        </div>
      </dl>
    </aside>
  );
}
