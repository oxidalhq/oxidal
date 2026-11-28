import {
  ChartLine,
  Gear,
  Guitar,
  List,
  MagnifyingGlass,
  Metronome,
  Stack,
  Waveform,
} from '@phosphor-icons/react';
import * as React from 'react';

import { Button } from '../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { cn } from '../lib/cn';
import { HealthStatus } from '../widgets/health-status';
import type {
  ResourceReadings,
  ResourceState,
} from '../widgets/resource-strip';
import type { Destination } from './app-shell';

/**
 * The top bar of every screen on a wide display: the main menu behind one
 * button, what is playing, and what a player watches (tempo, input and
 * output peaks, processing load, health). The screen's own buttons (the Rig's
 * Perform, Save, Tuner, More) are drawn into the two empty slots, so the bar
 * does not know about them. Below tablet width the shell keeps the phone
 * masthead and bottom bar instead.
 * @see docs/interface.md
 */

/** Peak level of each channel in dB below full scale (0 is the loudest), or null with no reading. */
export type BarLevels = {
  input: [number | null, number | null];
  output: [number | null, number | null];
};
export type BarTempo = { bpm: number; source?: string } | null;

const DESTINATIONS: {
  id: Destination;
  label: string;
  hint: string;
  icon: React.ReactNode;
}[] = [
  { id: 'rig', label: 'Rig', hint: 'Shape the sound', icon: <Waveform /> },
  {
    id: 'guitars',
    label: 'Guitars',
    hint: 'Your guitars and pickups',
    icon: <Guitar />,
  },
  {
    id: 'library',
    label: 'Library',
    hint: 'Presets, set lists, stems',
    icon: <Stack />,
  },
  {
    id: 'levels',
    label: 'Levels',
    hint: 'Sound check and readings',
    icon: <ChartLine />,
  },
  {
    id: 'settings',
    label: 'Settings',
    hint: 'Audio, MIDI, network',
    icon: <Gear />,
  },
];

/** 0 to 1 along a bar that runs from −60 dB to full scale. */
const share = (db: number) => Math.min(1, Math.max(0, (db + 60) / 60));
const HOT = -3;

function PeakMeter({
  label,
  values,
}: {
  label: string;
  values: [number | null, number | null];
}) {
  const said = values
    .map(
      (v, i) =>
        `${i === 0 ? 'left' : 'right'} ${v === null ? 'no reading' : `${v.toFixed(0)} dB`}`,
    )
    .join(', ');
  return (
    <span
      role="img"
      aria-label={`${label} peak: ${said}`}
      className="flex items-center gap-2"
    >
      <span
        aria-hidden="true"
        className="small-caps text-xs text-muted-foreground"
      >
        {label}
      </span>
      <span aria-hidden="true" className="grid gap-1">
        {values.map((v, i) => (
          <span
            key={i}
            className="block h-1.5 w-14 overflow-hidden rounded-full bg-border"
          >
            {v !== null && (
              <span
                className={cn(
                  'block h-full rounded-full',
                  v > HOT ? 'bg-brand' : 'bg-foreground',
                )}
                style={{ width: `${share(v) * 100}%` }}
              />
            )}
          </span>
        ))}
      </span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="grid gap-0.5 leading-none">
      <span className="small-caps text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </span>
  );
}

export function DisplayBar({
  destination,
  onNavigate,
  nowPlaying,
  tempo,
  levels,
  readings,
  state = 'live',
  resourceLabel,
  onSearch,
  setIdentity,
  setActions,
  setTools,
  className,
}: {
  destination: Destination;
  onNavigate: (destination: Destination) => void;
  /** The Live badge and preset name. */
  nowPlaying?: React.ReactNode;
  tempo?: BarTempo;
  levels?: BarLevels | null;
  readings: ResourceReadings;
  state?: ResourceState;
  resourceLabel?: string;
  /** Opens the one search; the bar shows a ⌘K button for it. */
  onSearch?: () => void;
  /** Receive the empty elements the screen draws its own buttons into. */
  setIdentity: (el: HTMLElement | null) => void;
  setActions: (el: HTMLElement | null) => void;
  setTools: (el: HTMLElement | null) => void;
  className?: string;
}) {
  const [menu, setMenu] = React.useState(false);
  const live = state === 'live';
  const dsp = readings.dsp?.p95;
  const cpu = readings.cpu;
  return (
    <header
      data-slot="display-bar"
      className={cn(
        'on-enclosure sticky top-0 z-strip flex min-h-14 items-center gap-3 border-b border-border bg-enclosure px-page pt-[var(--safe-top)] has-[[data-slot=bar-identity]:not(:empty)]:[&_[data-slot=bar-now]]:hidden',
        className,
      )}
    >
      <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Menu"
            aria-expanded={menu}
            className="shrink-0 text-foreground"
          >
            <List />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="w-72 gap-0.5 p-1.5"
        >
          <nav aria-label="Instrument navigation" className="grid gap-0.5">
            {DESTINATIONS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={destination === item.id ? 'page' : undefined}
                onClick={() => {
                  setMenu(false);
                  onNavigate(item.id);
                }}
                className="flex min-h-touch items-center gap-3 rounded-lg px-3 py-2 text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-[current=page]:bg-accent [&_svg]:size-5 [&_svg]:shrink-0"
              >
                {item.icon}
                <span className="grid">
                  <span className="text-sm font-semibold">{item.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.hint}
                  </span>
                </span>
              </button>
            ))}
          </nav>
        </PopoverContent>
      </Popover>
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
      <div
        data-slot="bar-now"
        className="min-w-0 truncate text-sm text-muted-foreground"
      >
        {nowPlaying}
      </div>
      <div
        ref={setIdentity}
        data-slot="bar-identity"
        className="flex min-w-0 shrink items-center gap-1 empty:hidden"
      />
      <span className="ml-auto flex shrink-0 items-center gap-4">
        {live && tempo && (
          <span
            className="hidden items-center gap-1.5 text-sm lg:flex"
            title={tempo.source ? `Tempo from ${tempo.source}` : undefined}
          >
            <Metronome
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="font-mono tabular-nums">
              {Math.round(tempo.bpm)} BPM
            </span>
          </span>
        )}
        {live && levels && (
          <span className="hidden items-center gap-3 xl:flex">
            <PeakMeter label="IN" values={levels.input} />
            <PeakMeter label="OUT" values={levels.output} />
          </span>
        )}
        {live && (dsp != null || cpu != null) && (
          <span className="hidden items-center gap-3 lg:flex">
            {dsp != null && (
              <Stat label="DSP" value={`${Math.round(dsp * 100)}%`} />
            )}
            {cpu != null && <Stat label="CPU" value={`${Math.round(cpu)}%`} />}
          </span>
        )}
        {onSearch && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Search ⌘K"
            onClick={onSearch}
            className="gap-2"
          >
            <MagnifyingGlass />
            <kbd className="font-mono text-xs text-muted-foreground">⌘K</kbd>
          </Button>
        )}
        <aside
          aria-label="DSP and system resources"
          data-connected={state !== 'disconnected'}
        >
          {resourceLabel && (
            <span className="sr-only" data-testid="resource-state">
              {resourceLabel}
            </span>
          )}
          <HealthStatus
            readings={readings}
            state={state}
            onDetails={() => onNavigate('levels')}
            className="shrink-0 border-enclosure-border bg-enclosure text-enclosure-foreground hover:bg-enclosure-border"
          />
        </aside>
        <div
          ref={setActions}
          data-slot="bar-actions"
          className="flex items-center gap-1 empty:hidden"
        />
        <div ref={setTools} data-slot="shell-tools" className="contents" />
      </span>
    </header>
  );
}
