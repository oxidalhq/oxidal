import { useState, type ReactNode } from 'react';
import { AppShell, type Destination } from '../patterns/app-shell';
import { Badge } from '../components/ui/badge';
import { ToolDockDemo } from '../patterns/tool-dock.demo';
import { READINGS } from './fixtures';

/** The shell every screen story uses, with the fixture readings and the now-playing line. */
export function Screen({
  destination,
  children,
  playing = 'Rhythm section · Scene 2',
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
      nowPlaying={
        playing && (
          <span className="inline-flex items-center gap-2">
            <Badge tone="live" size="sm">
              Live
            </Badge>
            <span className="truncate">{playing}</span>
          </span>
        )
      }
    >
      <ToolDockDemo>{children}</ToolDockDemo>
    </AppShell>
  );
}
