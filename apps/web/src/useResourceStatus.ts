import { useState } from 'react';

import { useNotice } from '@oxidal/design-system/notices';
import type {
  ResourceReadings,
  ResourceState,
} from '@oxidal/design-system/widgets/resource-strip';

import { useMonitorFeed } from './monitorFeed';
import { processingHeadroom } from './processingHeadroom';

/** Confirmed monitor readings shared by the shell and device pages.
 * @see docs/monitoring.md
 */
export function useResourceStatus(
  displayMode: string,
  connected: boolean,
  onAudioSetup?: () => void,
) {
  const feed = useMonitorFeed(displayMode === 'epaper' ? 5000 : 1000);
  const [connectedOnce, setConnectedOnce] = useState(connected);
  if (connected && !connectedOnce) setConnectedOnce(true);
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
  const { p95: load, peak } = processingHeadroom(audio);
  const clips = audio
    ? [...audio.input, ...audio.output].reduce(
        (sum, channel) => sum + channel.clips,
        0,
      )
    : null;
  const host = disconnected ? null : state?.host;
  const used = host?.memory_used_bytes;
  const total = host?.memory_total_bytes;
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
  // Stopped, starting or waiting for meters is already shown by the dashes;
  // only a problem posts a notice.
  useNotice(
    'connection',
    (!connected && connectedOnce) || disconnected
      ? { tone: 'warning', text: 'Connection lost · reconnecting' }
      : null,
  );
  useNotice(
    'audio',
    connected && !disconnected && failed
      ? {
          tone: 'error',
          text: 'Audio stopped unexpectedly',
          action: onAudioSetup
            ? { label: 'Audio setup', run: onAudioSetup }
            : undefined,
        }
      : connected && !disconnected && status === 'Audio stale'
        ? { tone: 'warning', text: 'Audio meters are stale' }
        : null,
  );
  return {
    connected: connected && !disconnected,
    label: status,
    state: (!connected || disconnected
      ? 'disconnected'
      : !running
        ? 'stopped'
        : !fresh
          ? 'stale'
          : 'live') as ResourceState,
    readings: {
      dsp:
        load != null && peak != null
          ? { p95: load / 100, peak: peak / 100 }
          : null,
      cpu: host?.cpu_percent,
      ram:
        used != null && total != null && total > 0
          ? { used: used / 1048576, total: total / 1048576 }
          : null,
      temperature: host?.temperature_c,
      xruns: fresh ? state?.xruns : null,
      clips,
    } satisfies ResourceReadings,
  };
}
