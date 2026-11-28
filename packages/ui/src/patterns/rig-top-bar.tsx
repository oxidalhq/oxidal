import {
  CaretDown,
  CaretLeft,
  CaretRight,
  ChartLine,
  DotsThree,
  Gear,
  Guitar,
  Lightning,
  LockSimple,
  MagnifyingGlass,
  MusicNote,
  SpeakerSlash,
  Stack,
  Stop,
  Trash,
  Waveform,
  Wrench,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Caption } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';
import { cn } from '../lib/cn';
import { HealthStatus } from '../widgets/health-status';
import type {
  ResourceReadings,
  ResourceState,
} from '../widgets/resource-strip';
import type { Destination } from './app-shell';
import type { BarLevels } from './display-bar';

/**
 * The top of the Rig, split by job. The dark top bar is navigation and
 * status only: the wordmark, the main menu as tabs, input and output peaks
 * and the health pill. Under it a slim light preset row holds the preset
 * (pick, previous, next) and the actions that belong to every screen:
 * search, Tuner, Mute (always in the same place), Perform and a menu for the
 * rarely used ones. On a phone the top bar goes, the bottom tabs carry the
 * main menu and the preset row keeps the preset, Mute, Perform and the menu.
 * @see docs/interface.md
 */

export type RigDestination = Destination | 'tools';

/** The main menu, in order. */
const RIG_DESTINATIONS: {
  id: RigDestination;
  label: string;
  icon: ReactNode;
}[] = [
  { id: 'rig', label: 'Rig', icon: <Waveform /> },
  { id: 'guitars', label: 'Guitars', icon: <Guitar /> },
  { id: 'library', label: 'Library', icon: <Stack /> },
  { id: 'levels', label: 'Levels', icon: <ChartLine /> },
  { id: 'settings', label: 'Settings', icon: <Gear /> },
  { id: 'tools', label: 'Tools', icon: <Wrench /> },
];

/** 0 to 1 along a bar that runs from −60 dB to full scale. */
const share = (db: number) => Math.min(1, Math.max(0, (db + 60) / 60));

/** Two thin bars, left over right. Oxide when near full scale. */
export function PeakMeter({
  label,
  values,
  tone = 'dark',
}: {
  label: string;
  values: [number | null, number | null];
  /** `dark` on the dark top bar, `page` on the page background. */
  tone?: 'dark' | 'page';
}) {
  const page = tone === 'page';
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
        className={cn(
          'small-caps text-xs',
          page ? 'text-muted-foreground' : 'text-enclosure-foreground/70',
        )}
      >
        {label}
      </span>
      <span aria-hidden="true" className="grid gap-1">
        {values.map((v, i) => (
          <span
            key={i}
            className={cn(
              'block h-1.5 w-14 overflow-hidden rounded-full',
              page ? 'bg-border' : 'bg-enclosure-border',
            )}
          >
            {v !== null && (
              <span
                className={cn(
                  'block h-full rounded-full',
                  v > -3
                    ? 'bg-brand'
                    : page
                      ? 'bg-foreground'
                      : 'bg-enclosure-foreground',
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

/** Dark bar along the top on a tablet or wider: menu tabs, peaks and health. */
export function RigTopBar({
  destination,
  onNavigate,
  levels,
  readings,
  state = 'live',
  onDetails,
  className,
}: {
  destination: RigDestination;
  onNavigate: (destination: RigDestination) => void;
  levels?: BarLevels | null;
  readings: ResourceReadings;
  state?: ResourceState;
  /** Opens the device details behind the health pill. */
  onDetails?: () => void;
  className?: string;
}) {
  return (
    <header
      data-slot="rig-top-bar"
      className={cn(
        'flex h-12 shrink-0 items-center gap-3 bg-enclosure px-page text-enclosure-foreground max-md:hidden',
        className,
      )}
    >
      <a
        href="#rig"
        aria-label="Oxidal home"
        onClick={(event) => {
          event.preventDefault();
          onNavigate('rig');
        }}
        className="flex h-12 shrink-0 items-center"
      >
        <img src="/brand/wordmark-white.svg" alt="" className="h-5 w-auto" />
      </a>
      <nav
        aria-label="Instrument navigation"
        className="flex min-w-0 items-center gap-0.5"
      >
        {RIG_DESTINATIONS.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            aria-current={destination === item.id ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
            // Below a wide laptop the words stay and the icons make room.
            className="px-2.5 text-enclosure-foreground/70 hover:text-enclosure-foreground aria-[current=page]:bg-enclosure-border aria-[current=page]:text-enclosure-foreground max-xl:[&_svg]:hidden"
          >
            {item.icon}
            {item.label}
          </Button>
        ))}
      </nav>
      <span className="flex-1" />
      {levels && (
        <span className="flex items-center gap-4 max-lg:hidden">
          <PeakMeter label="In" values={levels.input} />
          <PeakMeter label="Out" values={levels.output} />
        </span>
      )}
      <HealthStatus
        readings={readings}
        state={state}
        onDetails={onDetails}
        className="min-h-9 shrink-0 border-enclosure-border bg-enclosure text-enclosure-foreground hover:bg-enclosure-border"
      />
    </header>
  );
}

/** The main menu along the bottom of a phone. */
export function RigBottomTabs({
  destination,
  onNavigate,
  className,
}: {
  destination: RigDestination;
  onNavigate: (destination: RigDestination) => void;
  className?: string;
}) {
  return (
    <nav
      aria-label="Instrument navigation"
      className={cn(
        'grid shrink-0 grid-cols-6 border-t border-border bg-raised pb-[var(--safe-bottom)] md:hidden',
        className,
      )}
    >
      {RIG_DESTINATIONS.map((item) => (
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
  );
}

/** Mute: the output silenced, nothing else changed. Kept in one place on every screen. */
export function MuteToggle({
  muted,
  onMute,
  compact = false,
  size = 'sm',
  disabled = false,
  className,
}: {
  muted: boolean;
  onMute: (muted: boolean) => void;
  /** While the device has not said whether it is muted, or a change is on its way. */
  disabled?: boolean;
  /** `xs` in the capsule or a slim bar. */
  size?: 'sm' | 'xs';
  /** The word only for screen readers, such as in a narrow rail. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <Toggle
      size={size}
      pressed={muted}
      onPressedChange={onMute}
      disabled={disabled}
      aria-label={compact ? (muted ? 'Muted' : 'Mute') : undefined}
      title={
        muted ? 'Unmute output' : 'Silence the output; nothing else changes'
      }
      className={cn(
        '[@media(pointer:coarse)]:min-w-0',
        compact && 'px-2',
        className,
      )}
    >
      <SpeakerSlash />
      {!compact && (muted ? 'Muted' : 'Mute')}
    </Toggle>
  );
}

/** Perform: scene pads and effect switches for playing live. */
export function PerformButton({
  onPerform,
  compact = false,
  size = 'sm',
  label = 'Perform',
  disabled,
  className,
}: {
  onPerform: () => void;
  compact?: boolean;
  /** `xs` in a slim bar. */
  size?: 'sm' | 'xs';
  /** What a screen reader hears. */
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Button
      size={size}
      aria-label={label}
      disabled={disabled}
      title="Scene pads and effect switches for playing live"
      className={cn(
        '[@media(pointer:coarse)]:min-w-0',
        compact && 'px-2',
        className,
      )}
      onClick={onPerform}
    >
      <Lightning />
      <span className={cn(compact && 'sr-only')}>Perform</span>
    </Button>
  );
}

/** The slim preset row under the top bar. */
export function PresetRow({
  name,
  shortName,
  presets,
  onPick,
  onPrevious,
  onNext,
  previousName,
  nextName,
  muted,
  onMute,
  onSearch,
  onTuner,
  onPerform,
  protectedPreset = false,
  onProtect,
  onStopAudio,
  onDiscard,
  variant = 'row',
  size,
  controlSize = 'sm',
  without = [],
  subtitle,
  className,
}: {
  name: string;
  /** A shorter name for a phone, such as without the maker. */
  shortName?: string;
  /** The presets to choose from, by name. */
  presets: string[];
  onPick: (name: string) => void;
  onPrevious?: () => void;
  onNext?: () => void;
  /** Names of the neighbours, said with the previous and next buttons. */
  previousName?: string;
  nextName?: string;
  muted: boolean;
  onMute: (muted: boolean) => void;
  onSearch: () => void;
  onTuner: () => void;
  onPerform: () => void;
  protectedPreset?: boolean;
  onProtect: (on: boolean) => void;
  onStopAudio: () => void;
  /** Throw away edits that are not saved; leave out when there are none. */
  onDiscard?: () => void;
  /**
   * `row`: a slim bar with a rule under it. `float`: over the top of the
   * chain map, the name large in the display face with `subtitle` under it;
   * search is left to the header.
   */
  variant?: 'row' | 'float' | 'bare';
  /** How large the name is; by default slim in a row, large when floating. */
  size?: 'row' | 'title' | 'stage';
  /** `xs`: the arrows and the name at the slim bar's control height. */
  controlSize?: 'sm' | 'xs';
  /** Actions drawn elsewhere on this screen, such as Mute in a side rail. */
  without?: ('tuner' | 'mute' | 'perform' | 'more')[];
  /** Under the name, such as the scene and the version. */
  subtitle?: ReactNode;
  className?: string;
}) {
  const float = variant === 'float';
  const bare = variant === 'bare';
  const nameSize = size ?? (float ? 'title' : 'row');
  const has = (part: 'tuner' | 'mute' | 'perform' | 'more') =>
    !without.includes(part);
  // A touch screen keeps the 44 px height; these stay narrow so the name fits.
  const slim = '[@media(pointer:coarse)]:min-w-0';
  const previous = (
    <Button
      variant="ghost"
      size={controlSize === 'xs' ? 'icon-xs' : 'icon-sm'}
      aria-label={
        previousName ? `Previous preset: ${previousName}` : 'Previous preset'
      }
      className={slim}
      disabled={!onPrevious}
      onClick={onPrevious}
    >
      <CaretLeft />
    </Button>
  );
  const nameMenu = (
    <DropdownMenu>
      <h2 className="m-0 flex min-w-0 text-[length:inherit]">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="Choose another preset"
            className={cn(
              'flex min-w-0 items-center gap-1 rounded-md px-1.5 font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-touch',
              controlSize === 'xs' ? 'min-h-control-xs' : 'min-h-control',
              {
                row: 'font-serif text-lg max-md:text-base',
                title: 'font-display text-3xl tracking-tight max-md:text-xl',
                stage:
                  'font-display text-display leading-none tracking-tight max-lg:text-3xl max-md:text-xl',
              }[nameSize],
            )}
          >
            <span className="truncate max-md:hidden">{name}</span>
            <span className="truncate md:hidden">{shortName ?? name}</span>
            <CaretDown className="size-4 shrink-0" aria-hidden />
          </button>
        </DropdownMenuTrigger>
      </h2>
      <DropdownMenuContent align="start" className="w-72">
        {presets.map((p) => (
          <DropdownMenuItem
            key={p}
            onSelect={() => onPick(p)}
            className={cn(p === name && 'font-semibold')}
          >
            {p}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const next = (
    <Button
      variant="ghost"
      size={controlSize === 'xs' ? 'icon-xs' : 'icon-sm'}
      aria-label={nextName ? `Next preset: ${nextName}` : 'Next preset'}
      className={slim}
      disabled={!onNext}
      onClick={onNext}
    >
      <CaretRight />
    </Button>
  );
  const actions = (
    <>
      {has('tuner') && (
        <Button
          variant="ghost"
          size="sm"
          className="max-md:hidden"
          onClick={onTuner}
        >
          <MusicNote /> Tuner
        </Button>
      )}
      {has('mute') && (
        <MuteToggle muted={muted} onMute={onMute} className="max-md:px-2" />
      )}
      {has('perform') && (
        <Button
          size="sm"
          aria-label="Perform"
          title="Scene pads and effect switches for playing live"
          className={cn('max-md:px-2', slim)}
          onClick={onPerform}
        >
          <Lightning />
          <span className="max-md:sr-only">Perform</span>
        </Button>
      )}
      {has('more') && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="More preset actions"
              className={slim}
            >
              <DotsThree weight="bold" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-64">
            <DropdownMenuItem className="md:hidden" onSelect={onSearch}>
              <MagnifyingGlass /> Search
            </DropdownMenuItem>
            <DropdownMenuItem className="md:hidden" onSelect={onTuner}>
              <MusicNote /> Tuner
            </DropdownMenuItem>
            <DropdownMenuSeparator className="md:hidden" />
            <DropdownMenuItem onSelect={() => onProtect(!protectedPreset)}>
              <LockSimple /> {protectedPreset ? 'Unprotect' : 'Protect'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onStopAudio}>
              <Stop /> Stop audio
            </DropdownMenuItem>
            <DropdownMenuItem
              destructive
              disabled={!onDiscard}
              onSelect={onDiscard}
            >
              <Trash /> Discard live edits…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </>
  );
  return (
    <div
      role="group"
      aria-label="Preset"
      data-slot="preset-row"
      className={cn(
        float
          ? 'pointer-events-none flex shrink-0 items-start gap-1 px-2 md:px-page [&>*]:pointer-events-auto'
          : bare
            ? 'flex min-w-0 items-center gap-1'
            : 'flex h-12 shrink-0 items-center gap-1 border-b border-border bg-background px-2 md:px-page',
        className,
      )}
    >
      {float || subtitle ? (
        <div className="grid min-w-0 gap-0.5">
          <div className="flex min-w-0 items-center gap-0.5">
            {nameMenu}
            {previous}
            {next}
          </div>
          {subtitle && (
            <Caption as="span" className="truncate px-1.5 text-sm">
              {subtitle}
            </Caption>
          )}
        </div>
      ) : (
        <>
          {previous}
          {nameMenu}
          {next}
        </>
      )}

      <span className="min-w-1 flex-1" />

      {!float && !bare && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Search"
          title="Search presets, blocks and settings"
          className="max-md:hidden"
          onClick={onSearch}
        >
          <MagnifyingGlass />
        </Button>
      )}
      {actions}
    </div>
  );
}
