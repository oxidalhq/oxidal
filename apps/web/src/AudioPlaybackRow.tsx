import type { ReactNode } from 'react';

import {
  SettingGroup,
  SettingRow,
} from '@oxidal/design-system/patterns/settings-page';

import { phaseWord } from './audioSettingsShared';
import { useMonitorFeed } from './monitorFeed';

/**
 * Settings › Audio › Playback (C2): one Audio row saying what the audio is
 * doing (and the recovered xruns the monitor counted since it started), with
 * Restart and Stop or Resume at the right. Notes and errors follow the row.
 * @see docs/audio.md
 */
export function AudioPlaybackRow({
  phase,
  status,
  buttons,
  children,
}: {
  phase: string | undefined;
  /** What follows the phase word: the interface, rate and buffer. */
  status?: string;
  buttons: ReactNode;
  children?: ReactNode;
}) {
  const feed = useMonitorFeed(5000);
  const xruns =
    phase === 'running' && !feed.disconnected ? feed.snapshot?.xruns : null;
  const text = [
    phaseWord(phase),
    status,
    xruns != null
      ? `${xruns} ${xruns === 1 ? 'xrun' : 'xruns'} since audio started`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <SettingGroup title="Playback">
      <SettingRow
        label="Audio"
        caption={
          <span
            role="status"
            className="playback-state"
            data-phase={phase ?? 'checking'}
          >
            {text}
          </span>
        }
      >
        {buttons}
      </SettingRow>
      {children && <div className="grid min-w-0 gap-3 pt-3">{children}</div>}
    </SettingGroup>
  );
}
