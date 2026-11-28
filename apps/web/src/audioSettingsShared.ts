import { createContext } from 'react';

import type { AudioProbe } from './api';
import { bufferMs } from './bufferTiming';

/**
 * Pieces Settings › Audio shares between its device, session and playback
 * parts (C2). @see docs/audio.md
 *
 * Where Interface routing goes: Settings › Audio puts it under Device (C2),
 * while its draft still belongs to this session's Apply. Without a place it
 * stays inside the session card.
 */
export const InterfaceRoutingSlot = createContext<HTMLElement | null>(null);

/** Rate, buffer and queued time in a few words, for the status line. */
export function shortConfiguration(configuration: AudioProbe) {
  return `${(configuration.sample_rate / 1000).toFixed(1)} kHz · ${configuration.period_frames} × ${configuration.periods} · ≈ ${bufferMs(configuration).toFixed(1)} ms`;
}

/** An audio phase as the Playback row says it. */
export function phaseWord(phase: string | undefined) {
  switch (phase) {
    case undefined:
      return 'Checking…';
    case 'running':
      return 'Running';
    case 'stopped':
      return 'Stopped';
    case 'starting':
      return 'Preparing…';
    case 'stopping':
      return 'Stopping…';
    case 'unavailable':
      return 'Unavailable';
    default:
      return phase.charAt(0).toUpperCase() + phase.slice(1);
  }
}
