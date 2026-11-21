import {
  ChartLine,
  Gear,
  Guitar,
  Stack,
  Waveform,
} from '@phosphor-icons/react';
import * as React from 'react';

import { Badge } from '../components/ui/badge';
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

export function PlayingPreset({ name }: { name?: string | null }) {
  return name ? (
    <span className="inline-flex max-w-full min-w-0 items-center gap-2 align-middle">
      <Badge tone="live" size="sm">
        Live
      </Badge>
      <span className="truncate">{name}</span>
    </span>
  ) : (
    <span>No preset playing</span>
  );
}

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
 * full resource strip sits below the masthead. The Simple display preference
 * puts a compact health indicator in the masthead. The notice tray
 * floats under it.
 */
export function AppShell({
  destination,
  onNavigate,
  nowPlaying,
  bottomBar,
  readings,
  resourceState = 'live',
  resourceConnected = resourceState !== 'disconnected',
  resourceLabel,
  status = 'detailed',
  children,
  className,
}: {
  destination: Destination;
  onNavigate: (destination: Destination) => void;
  nowPlaying?: React.ReactNode;
  /** Persistent tools above the phone navigation, using the same reserved area. */
  bottomBar?: React.ReactNode;
  readings: ResourceReadings;
  resourceState?: ResourceState;
  resourceConnected?: boolean;
  resourceLabel?: string;
  /** Simple shows one health word in the masthead; Detailed shows the full strip. */
  status?: 'simple' | 'detailed';
  children: React.ReactNode;
  className?: string;
}) {
  // The tool dock draws its buttons here, in the masthead.
  const [tools, setTools] = React.useState<HTMLElement | null>(null);
  const frame = React.useRef<HTMLDivElement>(null);
  const bottom = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const container = bottom.current;
    const shell = frame.current;
    if (!container || !shell) return;
    const measure = () =>
      shell.style.setProperty(
        '--app-bottom-height',
        `${container.getBoundingClientRect().height}px`,
      );
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={frame}
      data-slot="app-shell"
      data-destination={destination}
      className={cn(
        'grid min-h-dvh grid-cols-1 grid-rows-[auto_auto_minmax(0,1fr)] bg-background text-foreground',
        className,
      )}
    >
      <header className="sticky top-0 z-strip flex items-center gap-3 bg-enclosure px-page pt-[var(--safe-top)] text-enclosure-foreground">
        <a
          href="#rig"
          aria-label="Oxidal home"
          onClick={(event) => {
            if (
              event.button ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onNavigate('rig');
          }}
          className="flex h-12 shrink-0 items-center"
        >
          <img src="/brand/wordmark-white.svg" alt="" className="h-5 w-auto" />
        </a>
        <div className="min-w-0 flex-1 truncate text-sm text-enclosure-foreground/80">
          {nowPlaying}
        </div>
        <nav
          aria-label="Instrument navigation"
          className="hidden items-center gap-1 md:flex [@media(pointer:coarse)]:gap-2"
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
          <aside
            aria-label="DSP and system resources"
            data-connected={resourceConnected}
          >
            {resourceLabel && (
              <span className="sr-only" data-testid="resource-state">
                {resourceLabel}
              </span>
            )}
            <HealthStatus
              readings={readings}
              state={resourceState}
              onDetails={() => onNavigate('levels')}
              className="shrink-0 border-enclosure-border bg-enclosure text-enclosure-foreground hover:bg-enclosure-border"
            />
          </aside>
        )}
        <div ref={setTools} data-slot="shell-tools" className="contents" />
      </header>
      <div className="sticky top-[calc(3rem+var(--safe-top))] z-strip">
        {status === 'detailed' && (
          <aside
            aria-label="DSP and system resources"
            data-connected={resourceConnected}
          >
            {resourceLabel && (
              <span className="sr-only" data-testid="resource-state">
                {resourceLabel}
              </span>
            )}
            <ResourceStrip readings={readings} state={resourceState} />
          </aside>
        )}
        <NoticeTray />
      </div>
      <main
        data-slot="app-content"
        className="m-0 w-full max-w-none min-w-0 p-0 pb-[calc(var(--app-bottom-height,4.5rem)+var(--spacing-page))]"
      >
        <LauncherSlotContext.Provider value={tools}>
          {children}
        </LauncherSlotContext.Provider>
      </main>
      <div
        ref={bottom}
        data-slot="app-bottom"
        className="fixed inset-x-0 bottom-0 z-strip bg-raised pb-[var(--safe-bottom)]"
      >
        {bottomBar}
        <nav
          aria-label="Instrument navigation"
          className="grid grid-cols-5 border-t border-border bg-raised md:hidden"
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
              <span className="small-caps text-xs font-medium">
                {item.label}
              </span>
            </button>
          ))}
        </nav>
      </div>
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
