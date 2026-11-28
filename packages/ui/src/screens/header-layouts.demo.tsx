import {
  CaretDown,
  ChartLine,
  Gear,
  Guitar,
  MagnifyingGlass,
  Stack,
  Waveform,
  Wrench,
} from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';

import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Caption, Eyebrow, Title } from '../components/ui/text';
import { Tooltip, TooltipProvider } from '../components/ui/tooltip';
import { cn } from '../lib/cn';
import { useMedia } from '../lib/use-media';
import { PageHeading } from '../patterns/app-shell';
import type { BarLevels } from '../patterns/display-bar';
import { ChainBarRigSample } from '../patterns/rig-chain-bar.demo';
import { PRESETS } from '../patterns/rig-samples.data';
import {
  MuteToggle,
  PeakMeter,
  PerformButton,
  PresetRow,
  RigBottomTabs,
  type RigDestination,
} from '../patterns/rig-top-bar';
import { HealthStatus } from '../widgets/health-status';
import type { ResourceReadings } from '../widgets/resource-strip';
import { Library } from './library';
import { OpenPageSample, OpenRigSample } from './open-header.demo';
import { Settings } from './settings';

/**
 * Header layouts B to G, side by side with A (the open header). Each draws
 * the Rig (chain map, chain bar, panel), Settings › Audio and Library › Mine
 * with the same parts, so only the header differs. Design samples with fixed
 * example data; nothing is saved.
 */

export type HeaderView = 'rig' | 'settings' | 'library';

const LEVELS: BarLevels = { input: [-14, -16], output: [-9, -10] };
const READINGS: ResourceReadings = {
  dsp: { p95: 0.21, peak: 0.34 },
  cpu: 18,
  ram: { used: 820, total: 8064 },
  xruns: 0,
  clips: 0,
  temperature: 52,
};

const MENU: { id: RigDestination; label: string; icon: ReactNode }[] = [
  { id: 'rig', label: 'Rig', icon: <Waveform /> },
  { id: 'guitars', label: 'Guitars', icon: <Guitar /> },
  { id: 'library', label: 'Library', icon: <Stack /> },
  { id: 'levels', label: 'Levels', icon: <ChartLine /> },
  { id: 'settings', label: 'Settings', icon: <Gear /> },
  { id: 'tools', label: 'Tools', icon: <Wrench /> },
];

const PAGES: Record<
  Exclude<HeaderView, 'rig'>,
  {
    eyebrow: string;
    title: string;
    section: string;
    caption: string;
    body: ReactNode;
  }
> = {
  settings: {
    eyebrow: 'This unit',
    title: 'Settings',
    section: 'Audio',
    caption: 'Audio, MIDI, network, display and the device itself.',
    body: <Settings section="audio" />,
  },
  library: {
    eyebrow: 'On this unit',
    title: 'Library',
    section: 'Mine',
    caption: 'Your presets, Oxidal sounds, set lists, tones and stems.',
    body: <Library section="mine" />,
  },
};

const usePhone = () => useMedia('(max-width: 47.99rem)');

/** The playing preset and the safety state every option shares. */
function usePlaying() {
  const [preset, setPreset] = useState(0);
  const [muted, setMuted] = useState(false);
  const [locked, setLocked] = useState(false);
  const name = PRESETS[preset]!;
  const row = {
    name,
    shortName: name.replace(/^Oxidal · /, ''),
    presets: PRESETS,
    onPick: (p: string) => setPreset(PRESETS.indexOf(p)),
    previousName: PRESETS[preset - 1],
    nextName: PRESETS[preset + 1],
    onPrevious: preset > 0 ? () => setPreset(preset - 1) : undefined,
    onNext:
      preset < PRESETS.length - 1 ? () => setPreset(preset + 1) : undefined,
    muted,
    onMute: setMuted,
    onSearch: () => undefined,
    onTuner: () => undefined,
    onPerform: () => undefined,
    protectedPreset: locked,
    onProtect: setLocked,
    onStopAudio: () => undefined,
  };
  return { row, muted, setMuted };
}

function Wordmark({ className }: { className?: string }) {
  return (
    <img
      src="/brand/wordmark.svg"
      alt="Oxidal"
      className={cn('h-5 w-auto shrink-0', className)}
    />
  );
}

function Health({ className }: { className?: string }) {
  return (
    <HealthStatus
      readings={READINGS}
      className={cn('min-h-9 shrink-0', className)}
    />
  );
}

function Meters({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-4', className)}>
      <PeakMeter tone="page" label="In" values={LEVELS.input} />
      <PeakMeter tone="page" label="Out" values={LEVELS.output} />
    </span>
  );
}

function SearchButton({ className }: { className?: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Search"
      title="Search presets, blocks and settings"
      className={className}
    >
      <MagnifyingGlass />
    </Button>
  );
}

/** The Rig sample with this option's header parts drawn over or above the chain. */
function Rig({
  header,
  footer,
  insetTop = 0,
}: {
  header: (discard: (() => void) | undefined, scene: string) => ReactNode;
  footer?: ReactNode;
  insetTop?: number;
}) {
  return (
    <ChainBarRigSample
      edits="edited"
      insetTop={insetTop}
      header={({ changed, discard, scene }) =>
        header(changed ? discard : undefined, scene)
      }
      footer={footer}
    />
  );
}

/** A fade from the page colour under parts that float over the chain. */
function Fade({ className }: { className: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-10 bg-linear-to-b from-background via-background/80 to-transparent [[data-display=epaper]_&]:hidden',
        className,
      )}
    />
  );
}

/** A page's content, with its own small heading giving way to the option's title. */
function PageBody({ view }: { view: Exclude<HeaderView, 'rig'> }) {
  return (
    <div className="[&_[data-slot=page-heading]]:hidden">
      {PAGES[view].body}
    </div>
  );
}

function BigTitle({
  view,
  size = 'lg',
  className,
}: {
  view: Exclude<HeaderView, 'rig'>;
  size?: 'lg' | 'display';
  className?: string;
}) {
  const p = PAGES[view];
  return size === 'lg' ? (
    <PageHeading
      size="lg"
      eyebrow={p.eyebrow}
      title={p.title}
      caption={p.caption}
      className={cn('pt-6 pb-4', className)}
    />
  ) : (
    <header className={cn('grid gap-1 px-page pt-2 pb-4', className)}>
      <Eyebrow>{p.eyebrow}</Eyebrow>
      <Title
        size="display"
        className="leading-none max-lg:text-3xl max-md:text-2xl"
      >
        {p.title}
      </Title>
      <Caption>{p.caption}</Caption>
    </header>
  );
}

/* ------------------------------------------------------------------ A */

export function OptionA({ view }: { view: HeaderView }) {
  return view === 'rig' ? <OpenRigSample /> : <OpenPageSample page={view} />;
}

/* ------------------------------------------------------------------ B */

/** A slim rail of icons down the left; names show on hover and focus. */
function SideRail({
  current,
  muted,
  onMute,
}: {
  current: RigDestination;
  muted: boolean;
  onMute: (muted: boolean) => void;
}) {
  return (
    <aside
      aria-label="Menu and status"
      className="flex w-[6.75rem] shrink-0 flex-col items-center gap-1 border-r border-border bg-background py-3 max-md:hidden"
    >
      <img src="/brand/mark.svg" alt="Oxidal" className="mb-3 h-7 w-auto" />
      <TooltipProvider>
        <nav aria-label="Instrument navigation" className="grid gap-1">
          {MENU.map((item) => (
            <Tooltip key={item.id} content={item.label} side="right">
              <button
                type="button"
                aria-label={item.label}
                aria-current={current === item.id ? 'page' : undefined}
                className="relative grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:bg-accent aria-[current=page]:text-foreground [&_svg]:size-5"
              >
                {item.icon}
                {current === item.id && (
                  <span
                    aria-hidden="true"
                    className="absolute top-2.5 -left-3 h-6 w-0.5 rounded-full bg-brand"
                  />
                )}
              </button>
            </Tooltip>
          ))}
        </nav>
      </TooltipProvider>
      <span className="flex-1" />
      <div className="grid justify-items-center gap-3">
        <SearchButton />
        <MuteToggle compact muted={muted} onMute={onMute} />
        <span className="grid gap-2">
          <PeakMeter tone="page" label="In" values={LEVELS.input} />
          <PeakMeter tone="page" label="Out" values={LEVELS.output} />
        </span>
        <Health className="px-2 text-xs" />
      </div>
    </aside>
  );
}

export function OptionB({ view }: { view: HeaderView }) {
  const { row, muted, setMuted } = usePlaying();
  const phone = usePhone();
  const [where, setWhere] = useState<RigDestination>(view);
  const tabs = <RigBottomTabs destination={where} onNavigate={setWhere} />;
  return (
    <div className="flex h-dvh bg-background text-foreground">
      <SideRail current={where} muted={muted} onMute={setMuted} />
      <div className="flex min-w-0 flex-1 flex-col">
        {view === 'rig' ? (
          <Rig
            insetTop={96}
            footer={tabs}
            header={(discard, scene) => (
              <>
                <Fade className="h-28" />
                <PresetRow
                  {...row}
                  onDiscard={discard}
                  variant="float"
                  subtitle={`${scene} · Default`}
                  // On a laptop Mute lives at the foot of the rail.
                  without={phone ? [] : ['mute']}
                  className="absolute inset-x-0 top-3 z-10"
                />
              </>
            )}
          />
        ) : (
          <>
            <main className="min-h-0 flex-1 overflow-y-auto">
              <div className="flex items-start justify-between gap-2 pr-page md:hidden">
                <BigTitle view={view} />
                <MuteToggle muted={muted} onMute={setMuted} className="mt-6" />
              </div>
              <BigTitle view={view} className="max-md:hidden" />
              <PageBody view={view} />
            </main>
            {tabs}
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ C */

/** The menu as a pill floating at the top centre, like a dock. */
function MenuCapsule({ current }: { current: RigDestination }) {
  return (
    <nav
      aria-label="Instrument navigation"
      className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-[calc(var(--radius-lg)+0.25rem)] border border-border bg-card p-1 shadow-raised max-lg:hidden"
    >
      {MENU.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={current === item.id ? 'page' : undefined}
          className="min-h-control rounded-lg px-3 small-caps text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:bg-accent aria-[current=page]:text-foreground"
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}

/** Search, Mute and health in a small pill at the top right. */
function StatusCapsule({
  muted,
  onMute,
}: {
  muted: boolean;
  onMute: (muted: boolean) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Search, mute and status"
      className="absolute top-3 right-3 z-20 flex items-center gap-1 rounded-[calc(var(--radius-lg)+0.25rem)] border border-border bg-card p-1 shadow-raised"
    >
      <SearchButton />
      <MuteToggle muted={muted} onMute={onMute} />
      <Health className="rounded-lg border-0" />
    </div>
  );
}

export function OptionC({ view }: { view: HeaderView }) {
  const { row, muted, setMuted } = usePlaying();
  const [where, setWhere] = useState<RigDestination>(view);
  const tabs = <RigBottomTabs destination={where} onNavigate={setWhere} />;
  const top = (
    <>
      <Wordmark className="absolute top-5 left-page z-20 max-sm:hidden" />
      <MenuCapsule current={where} />
      <StatusCapsule muted={muted} onMute={setMuted} />
    </>
  );
  if (view === 'rig')
    return (
      <Rig
        insetTop={136}
        footer={tabs}
        header={(discard, scene) => (
          <>
            <Fade className="h-36" />
            {top}
            <PresetRow
              {...row}
              onDiscard={discard}
              variant="float"
              subtitle={`${scene} · Default`}
              without={['mute']}
              className="absolute inset-x-0 top-16 z-10"
            />
          </>
        )}
      />
    );
  return (
    <div className="relative flex h-dvh flex-col bg-background text-foreground">
      {top}
      <main className="min-h-0 flex-1 overflow-y-auto pt-16">
        <BigTitle view={view} />
        <PageBody view={view} />
      </main>
      {tabs}
    </div>
  );
}

/* ------------------------------------------------------------------ D */

/** Where you are, as a menu that opens every destination. */
function Breadcrumb({ view }: { view: HeaderView }) {
  const here =
    view === 'rig' ? ['Rig'] : [PAGES[view].title, PAGES[view].section];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${here.join(', ')}. Go somewhere else`}
          className="flex min-h-9 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {here.map((part, i) => (
            <span
              key={part}
              className={cn(i > 0 && 'font-normal text-muted-foreground')}
            >
              {i > 0 && '› '}
              {part}
            </span>
          ))}
          <CaretDown className="size-3.5" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {MENU.map((item) => (
          <DropdownMenuItem key={item.id}>
            {item.icon} {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CrumbRow({
  view,
  muted,
  onMute,
}: {
  view: HeaderView;
  muted: boolean;
  onMute: (muted: boolean) => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-page">
      <Wordmark className="max-sm:hidden" />
      <Breadcrumb view={view} />
      <button
        type="button"
        title="Search"
        className="mx-auto flex min-h-9 w-full max-w-xl min-w-0 items-center gap-2 rounded-lg border border-input bg-card px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring max-md:hidden"
      >
        <MagnifyingGlass className="size-4 shrink-0" aria-hidden />
        <span className="truncate">Find a preset, setting or sound…</span>
        <kbd className="ml-auto shrink-0 font-mono text-xs">⌘K</kbd>
      </button>
      <span className="flex-1 md:hidden" />
      <SearchButton className="md:hidden" />
      <MuteToggle muted={muted} onMute={onMute} />
      <Meters className="max-xl:hidden" />
      <Health className="max-sm:hidden" />
    </header>
  );
}

export function OptionD({ view }: { view: HeaderView }) {
  const { row, muted, setMuted } = usePlaying();
  const crumbs = <CrumbRow view={view} muted={muted} onMute={setMuted} />;
  if (view === 'rig')
    return (
      <Rig
        header={(discard) => (
          <>
            {crumbs}
            <div className="flex h-12 shrink-0 items-center border-b border-border px-2 md:px-page">
              <PresetRow
                {...row}
                onDiscard={discard}
                variant="bare"
                without={['mute']}
                className="flex-1"
              />
            </div>
          </>
        )}
      />
    );
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {crumbs}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <BigTitle view={view} />
        <PageBody view={view} />
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ E */

function OneRow({
  current,
  row,
  discard,
}: {
  current: RigDestination;
  row: ReturnType<typeof usePlaying>['row'];
  discard?: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-2 md:px-page">
      <Wordmark className="h-4 max-md:hidden" />
      <nav
        aria-label="Instrument navigation"
        className="flex items-center gap-0.5 max-md:hidden"
      >
        {MENU.map((item) => (
          <Button
            key={item.id}
            variant="ghost"
            size="sm"
            aria-current={current === item.id ? 'page' : undefined}
            className="px-2 aria-[current=page]:bg-accent"
          >
            {item.label}
          </Button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 justify-center">
        <PresetRow
          {...row}
          onDiscard={discard}
          variant="bare"
          without={['tuner', 'mute', 'perform']}
        />
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="max-lg:hidden"
        onClick={row.onTuner}
      >
        Tuner
      </Button>
      <MuteToggle muted={row.muted} onMute={row.onMute} />
      <PerformButton onPerform={row.onPerform} compact className="lg:hidden" />
      <PerformButton onPerform={row.onPerform} className="max-lg:hidden" />
      <Health className="max-md:hidden" />
    </header>
  );
}

export function OptionE({ view }: { view: HeaderView }) {
  const { row } = usePlaying();
  const [where, setWhere] = useState<RigDestination>(view);
  const tabs = <RigBottomTabs destination={where} onNavigate={setWhere} />;
  if (view === 'rig')
    return (
      <Rig
        footer={tabs}
        header={(discard) => (
          <OneRow current={where} row={row} discard={discard} />
        )}
      />
    );
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <OneRow current={where} row={row} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <BigTitle view={view} />
        <PageBody view={view} />
      </main>
      {tabs}
    </div>
  );
}

/* ------------------------------------------------------------------ F */

/** The menu as one small line above the title, with Mute and health on its right. */
function MenuLine({
  current,
  muted,
  onMute,
}: {
  current: RigDestination;
  muted: boolean;
  onMute: (muted: boolean) => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-4 px-page">
      <Wordmark className="h-4" />
      <nav
        aria-label="Instrument navigation"
        className="flex items-center gap-1 max-md:hidden"
      >
        {MENU.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={current === item.id ? 'page' : undefined}
            className="min-h-9 rounded-md px-2 small-caps text-xs font-medium text-muted-foreground underline-offset-[6px] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:text-foreground aria-[current=page]:underline aria-[current=page]:decoration-brand aria-[current=page]:decoration-2"
          >
            {item.label}
          </button>
        ))}
      </nav>
      <span className="flex-1" />
      <SearchButton />
      <MuteToggle muted={muted} onMute={onMute} />
      <Health className="max-sm:hidden" />
    </div>
  );
}

export function OptionF({ view }: { view: HeaderView }) {
  const { row, muted, setMuted } = usePlaying();
  const [where, setWhere] = useState<RigDestination>(view);
  const tabs = <RigBottomTabs destination={where} onNavigate={setWhere} />;
  const line = <MenuLine current={where} muted={muted} onMute={setMuted} />;
  if (view === 'rig')
    return (
      <Rig
        footer={tabs}
        header={(discard, scene) => (
          <>
            {line}
            <PresetRow
              {...row}
              onDiscard={discard}
              variant="bare"
              size="stage"
              subtitle={`${scene} · Default`}
              without={['mute']}
              className="shrink-0 items-end px-page pb-3"
            />
          </>
        )}
      />
    );
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {line}
      <main className="min-h-0 flex-1 overflow-y-auto">
        <BigTitle view={view} size="display" />
        <PageBody view={view} />
      </main>
      {tabs}
    </div>
  );
}

/* ------------------------------------------------------------------ G */

/** The menu in a slim dock along the bottom, on every screen size. */
function BottomDock({
  current,
  muted,
  onMute,
}: {
  current: RigDestination;
  muted: boolean;
  onMute: (muted: boolean) => void;
}) {
  return (
    <div className="shrink-0 border-t border-border bg-background">
      <div className="flex h-14 items-center gap-3 px-page max-md:hidden">
        <Wordmark className="h-4" />
        <nav
          aria-label="Instrument navigation"
          className="mx-auto flex items-center gap-1"
        >
          {MENU.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={current === item.id ? 'page' : undefined}
              className="flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-[current=page]:bg-accent aria-[current=page]:text-foreground [&_svg]:size-4"
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <MuteToggle muted={muted} onMute={onMute} />
        <Meters className="max-xl:hidden" />
        <Health />
      </div>
      <RigBottomTabs
        destination={current}
        onNavigate={() => undefined}
        className="border-t-0"
      />
    </div>
  );
}

export function OptionG({ view }: { view: HeaderView }) {
  const { row, muted, setMuted } = usePlaying();
  const phone = usePhone();
  const dock = <BottomDock current={view} muted={muted} onMute={setMuted} />;
  if (view === 'rig')
    return (
      <Rig
        insetTop={96}
        footer={dock}
        header={(discard, scene) => (
          <>
            <Fade className="h-28" />
            <PresetRow
              {...row}
              onDiscard={discard}
              variant="float"
              subtitle={`${scene} · Default`}
              // On a laptop Mute lives in the dock.
              without={phone ? [] : ['mute']}
              className="absolute inset-x-0 top-3 z-10"
            />
          </>
        )}
      />
    );
  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex items-start justify-between gap-2 pr-page md:hidden">
          <BigTitle view={view} />
          <MuteToggle muted={muted} onMute={setMuted} className="mt-6" />
        </div>
        <BigTitle view={view} className="max-md:hidden" />
        <PageBody view={view} />
      </main>
      {dock}
    </div>
  );
}
