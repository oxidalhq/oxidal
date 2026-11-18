import {
  ChartLine,
  Gear,
  Guitar,
  Stack,
  Waveform,
} from '@phosphor-icons/react';
import * as React from 'react';

import { Button } from '../components/ui/button';
import { NoticeTray } from '../components/ui/notice-tray';
import { Caption, Eyebrow, Title } from '../components/ui/text';
import { cn } from '../lib/cn';
import { HealthStatus } from '../widgets/health-status';
import {
  type ResourceReadings,
  type ResourceState,
  ResourceStrip,
} from '../widgets/resource-strip';
import { LauncherSlotContext } from './dock-context';

export type Destination = 'rig' | 'guitars' | 'library' | 'levels' | 'settings';

const DESTINATIONS: {
  id: Destination;
  label: string;
  icon: React.ReactNode;
}[] = [
  { id: 'rig', label: 'Rig', icon: <Waveform /> },
  { id: 'guitars', label: 'Guitars', icon: <Guitar /> },
  { id: 'library', label: 'Library', icon: <Stack /> },
  { id: 'levels', label: 'Levels', icon: <ChartLine /> },
  { id: 'settings', label: 'Settings', icon: <Gear /> },
];

/**
 * The frame every screen sits in (D-3): the ink masthead with the wordmark,
 * what is playing, and the five destinations as ghost buttons on `md+`;
 * below `md` the destinations move to a bottom bar with icon and label,
 * the masthead keeps the wordmark and the now-playing line. By default the
 * masthead shows the device health in one word (R-7); with `status="detailed"`
 * the full resource strip sits under the masthead instead. The notice tray
 * floats under it.
 */
export function AppShell({
  destination,
  onNavigate,
  nowPlaying,
  readings,
  resourceState = 'live',
  status = 'simple',
  children,
  className,
}: {
  destination: Destination;
  onNavigate: (destination: Destination) => void;
  nowPlaying?: React.ReactNode;
  readings: ResourceReadings;
  resourceState?: ResourceState;
  /** Simple shows one health word in the masthead; Detailed shows the full strip. */
  status?: 'simple' | 'detailed';
  children: React.ReactNode;
  className?: string;
}) {
  // The tool dock draws its buttons here, in the masthead.
  const [tools, setTools] = React.useState<HTMLElement | null>(null);
  return (
    <div
      data-slot="app-shell"
      data-destination={destination}
      className={cn(
        'grid min-h-dvh grid-rows-[auto_auto_minmax(0,1fr)] bg-background text-foreground',
        className,
      )}
    >
      <header className="flex items-center gap-3 bg-enclosure px-page pt-[var(--safe-top)] text-enclosure-foreground">
        <a
          href="#rig"
          aria-label="Oxidal home"
          className="flex h-12 shrink-0 items-center"
        >
          <img src="/brand/wordmark-white.svg" alt="" className="h-5 w-auto" />
        </a>
        <div className="min-w-0 flex-1 truncate text-sm text-enclosure-foreground/80">
          {nowPlaying}
        </div>
        <nav
          aria-label="Instrument navigation"
          className="hidden items-center gap-1 md:flex"
        >
          {DESTINATIONS.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              aria-current={destination === item.id ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
              // On a tablet the words stay and the icons make room.
              className="text-enclosure-foreground/70 hover:bg-enclosure-border hover:text-enclosure-foreground aria-[current=page]:bg-enclosure-border aria-[current=page]:text-enclosure-foreground max-lg:[&_svg]:hidden"
            >
              {item.icon}
              {item.label}
            </Button>
          ))}
        </nav>
        {/* What the device is doing and what you keep open sit together, last. */}
        <span
          aria-hidden="true"
          className="hidden h-6 w-px shrink-0 bg-enclosure-border md:block"
        />
        {status === 'simple' && (
          <HealthStatus
            readings={readings}
            state={resourceState}
            onDetails={() => onNavigate('levels')}
            className="shrink-0 border-enclosure-border bg-enclosure text-enclosure-foreground hover:bg-enclosure-border"
          />
        )}
        <div ref={setTools} data-slot="shell-tools" className="contents" />
      </header>
      <div className="sticky top-0 z-strip">
        {status === 'detailed' && (
          <ResourceStrip readings={readings} state={resourceState} />
        )}
        <NoticeTray />
      </div>
      <main className="pb-[calc(var(--safe-bottom)+4.5rem)] md:pb-page">
        <LauncherSlotContext.Provider value={tools}>
          {children}
        </LauncherSlotContext.Provider>
      </main>
      <nav
        aria-label="Instrument navigation"
        className="fixed inset-x-0 bottom-0 z-strip grid grid-cols-5 border-t border-border bg-raised pb-[var(--safe-bottom)] md:hidden"
      >
        {DESTINATIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={destination === item.id ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
            className="grid min-h-touch justify-items-center gap-0.5 py-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring aria-[current=page]:text-foreground [&_svg]:size-5"
          >
            {item.icon}
            <span className="small-caps text-xs font-medium">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Eyebrow, the name of the screen or thing, a caption, and the actions. */
export function PageHeading({
  eyebrow,
  title,
  caption,
  actions,
  size = 'md',
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  caption?: React.ReactNode;
  actions?: React.ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}) {
  return (
    <header
      data-slot="page-heading"
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-page pt-4 pb-2',
        className,
      )}
    >
      <div className="grid min-w-0 gap-0.5">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <Title size={size} className="truncate">
          {title}
        </Title>
        {caption && <Caption>{caption}</Caption>}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
