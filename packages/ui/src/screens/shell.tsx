import { type ReactNode, useState } from 'react';

import {
  AppShell,
  type Destination,
  PlayingPreset,
} from '../patterns/app-shell';
import { ToolDockDemo } from '../patterns/tool-dock.demo';
import { READINGS } from './fixtures';

/** The shell every screen story uses, with the fixture readings and the now-playing line. */
export function Screen({
  destination,
  children,
  playing = 'Rhythm section',
  status,
}: {
  status?: 'simple' | 'detailed';
  destination: Destination;
  children: ReactNode;
  playing?: string | null;
}) {
  const [where, setWhere] = useState<Destination>(destination);
  return (
    <AppShell
      destination={where}
      onNavigate={setWhere}
      readings={READINGS}
      status={status}
      nowPlaying={<PlayingPreset name={playing} />}
    >
      <ToolDockDemo>{children}</ToolDockDemo>
    </AppShell>
  );
}
