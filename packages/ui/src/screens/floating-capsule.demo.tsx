import { MusicNote } from '@phosphor-icons/react';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';

import { Button } from '../components/ui/button';
import { Switch } from '../components/ui/switch';
import { Caption } from '../components/ui/text';
import {
  type DockLayout,
  layoutOf,
  openTools,
  showTool,
  sideRoom,
  useDockLayout,
} from '../lib/dock-layout';
import { useMedia } from '../lib/use-media';
import { PageHeading } from '../patterns/app-shell';
import { type DockParts, DockSheet, DockZones } from '../patterns/dock-zones';
import { EdgeLanes } from '../patterns/edge-lanes';
import { FirstRun } from '../patterns/first-run';
import {
  type CapsulePhase,
  FloatingCapsule,
} from '../patterns/floating-capsule';
import { ChainBarRigSample } from '../patterns/rig-chain-bar.demo';
import { PRESETS } from '../patterns/rig-samples.data';
import {
  PerformButton,
  PresetRow,
  RigBottomTabs,
  type RigDestination,
} from '../patterns/rig-top-bar';
import { GuitarSelector } from '../widgets/guitar-selector';
import { MiniPlayer } from '../widgets/mini-player';
import { OutputLevelControl } from '../widgets/output-level-control';
import { StreamStatus } from '../widgets/stream-status';
import {
  CHAIN_STATUS_LINE,
  DURATION,
  SAMPLE_ENGINE,
  SAMPLE_GUITARS,
  SAMPLE_STREAM,
  time,
  useBacking,
  useMidiFlash,
  usePlayhead,
  useSampleLevels,
  useViewportWidth,
} from './floating-capsule.hooks';
import type { DockToolId, MediaTab } from './floating-capsule.media.demo';
import { C2PerformSample } from './floating-capsule.perform.demo';
import {
  sampleDockTools,
  sampleMenu,
  TOOL_ORDER,
} from './floating-capsule.tools';
import { Guitars } from './guitars';
import { Levels } from './levels';
import { Library } from './library';
import { Perform } from './perform';
import { Settings } from './settings';

/**
 * Header option C2, the floating capsule, on every page: working, opened,
 * squeezing into the bubble while audio plays, and with a problem. The Rig
 * adds faint readouts along the chain's edges. Design samples with fixed
 * example data; nothing is saved.
 */

export type C2Page =
  | 'rig'
  | 'perform'
  | 'guitars'
  | 'library'
  | 'levels'
  | 'settings-audio'
  | 'settings-midi'
  | 'settings-display'
  | 'tools'
  | 'welcome';

const PAGES: Record<
  Exclude<C2Page, 'rig' | 'welcome'>,
  {
    destination: RigDestination;
    eyebrow: string;
    title: string;
    caption: string;
    body: ReactNode;
  }
> = {
  perform: {
    destination: 'rig',
    eyebrow: 'Playing live',
    title: 'Perform',
    caption:
      'Scene pads, switches and the backing track, big enough for a stage.',
    body: <Perform />,
  },
  guitars: {
    destination: 'guitars',
    eyebrow: 'Your instruments',
    title: 'Guitars',
    caption: 'Guitars and pickups, so each preset plays at the right level.',
    body: <Guitars />,
  },
  library: {
    destination: 'library',
    eyebrow: 'On this unit',
    title: 'Library',
    caption: 'Your presets, Oxidal sounds, set lists, tones and stems.',
    body: <Library section="mine" />,
  },
  levels: {
    destination: 'levels',
    eyebrow: 'Loudness',
    title: 'Levels',
    caption: 'Sound check and readings for every preset.',
    body: <Levels />,
  },
  'settings-audio': {
    destination: 'settings',
    eyebrow: 'This unit',
    title: 'Settings',
    caption: 'Audio, MIDI, network, display and the device itself.',
    body: <Settings section="audio" />,
  },
  'settings-display': {
    destination: 'settings',
    eyebrow: 'This unit',
    title: 'Settings',
    caption: 'Audio, MIDI, network, display and the device itself.',
    body: <Settings section="display" />,
  },
  'settings-midi': {
    destination: 'settings',
    eyebrow: 'This unit',
    title: 'Settings',
    caption: 'Audio, MIDI, network, display and the device itself.',
    body: <Settings section="midi" />,
  },
  tools: {
    destination: 'library',
    eyebrow: 'On this unit',
    title: 'Library',
    caption: 'Tools open from the menu at the left of the capsule.',
    body: <Library section="mine" />,
  },
};

/** The pointer or a drag is moving: the edge readouts fade further. */
function useMoving() {
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      setMoving(true);
      clearTimeout(t);
      t = setTimeout(() => setMoving(false), 800);
    };
    window.addEventListener('pointermove', on);
    window.addEventListener('wheel', on);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointermove', on);
      window.removeEventListener('wheel', on);
    };
  }, []);
  return moving;
}

/**
 * A level that moves like a real meter: it rises fast, falls slower, and its
 * peak holds for a moment before it decays. Example numbers, not measured.
 */
function useLiveLevel(running: boolean, base: number) {
  const [v, setV] = useState({ level: base, peak: base });
  useEffect(() => {
    if (!running) return;
    let level = base;
    let peak = base;
    let hold = 0;
    const id = setInterval(() => {
      const target =
        base + (Math.random() - 0.5) * 8 + (Math.random() < 0.06 ? 7 : 0);
      level += (target - level) * (target > level ? 0.6 : 0.12);
      if (level >= peak) {
        peak = level;
        hold = 15;
      } else if (hold > 0) hold -= 1;
      else peak = Math.max(level, peak - 0.6);
      setV({
        level: Math.round(level * 10) / 10,
        peak: Math.round(peak * 10) / 10,
      });
    }, 100);
    return () => clearInterval(id);
  }, [running, base]);
  return v;
}

export function C2Sample({
  page,
  variant = 'p1',
  playing = true,
  idleSeconds = 3,
  phase,
  problem = false,
  stopped = false,
  slowMotion = false,
  silent = false,
  keepMenuOpen = false,
  track = false,
  dock: startDock = 'closed',
  dockTab: startTab = 'player',
  layout: startLayout,
  menuOpenFor,
  remember = false,
  phoneSheet = false,
}: {
  page: C2Page;
  /** Where the Rig's preset lives: in the capsule (p1) or in the chain bar (p2). */
  variant?: 'p1' | 'p2';
  /** Audio is running (the capsule may squeeze). */
  playing?: boolean;
  /** Quiet time before the capsule squeezes. */
  idleSeconds?: number;
  /** Hold one state for a picture of it. */
  phase?: CapsulePhase;
  /** DSP runs hot: the status, the bubble's edge and the DSP figure light up. */
  problem?: boolean;
  stopped?: boolean;
  /** Every C2 movement four times slower, to inspect it. */
  slowMotion?: boolean;
  /** Audio runs but no guitar is coming in: the capsule stays open. */
  silent?: boolean;
  /** Settings › Display › Keep the menu open while playing. */
  keepMenuOpen?: boolean;
  /** A backing track is cued and playing. */
  track?: boolean;
  /** The player, stems and sheet together at the right: over the chain or pinned beside it. */
  dock?: 'closed' | 'overlay' | 'pinned';
  dockTab?: MediaTab | DockToolId;
  /** Any docked layout, in place of `dock`. */
  layout?: DockLayout;
  /** Hold one docked tool's menu open, for a picture of it. */
  menuOpenFor?: DockToolId;
  /** Keep the dock layout in this browser, per screen. */
  remember?: boolean;
  /** On a phone, the media bottom sheet is open. */
  phoneSheet?: boolean;
}) {
  const [keepOpen, setKeepOpen] = useState(keepMenuOpen);
  const [where, setWhere] = useState<RigDestination>(
    page === 'rig' || page === 'welcome' ? 'rig' : PAGES[page].destination,
  );
  const [muted, setMuted] = useState(false);
  const [preset, setPreset] = useState(0);
  const moving = useMoving();
  const phone = useMedia('(max-width: 47.99rem)');
  const running = playing && !stopped;
  const input = useLiveLevel(running, -16);
  const output = useLiveLevel(running, -10);
  const name = PRESETS[preset]!;
  const short = name.replace(/^Oxidal · /, '');
  const picker = (slim = false) => (
    <PresetRow
      variant="bare"
      name={name}
      shortName={short}
      presets={PRESETS}
      onPick={(p) => setPreset(PRESETS.indexOf(p))}
      previousName={PRESETS[preset - 1]}
      nextName={PRESETS[preset + 1]}
      onPrevious={preset > 0 ? () => setPreset(preset - 1) : undefined}
      onNext={
        preset < PRESETS.length - 1 ? () => setPreset(preset + 1) : undefined
      }
      muted={muted}
      onMute={setMuted}
      without={['tuner', 'mute', 'perform', 'more']}
      // In the slim bar the arrows and the name share its control height.
      // The capsule and the slim bar share the compact control height.
      controlSize="xs"
      size={slim ? 'row' : undefined}
      onSearch={() => undefined}
      onTuner={() => undefined}
      onPerform={() => undefined}
      onProtect={() => undefined}
      onStopAudio={() => undefined}
      className="[&>span:last-child]:hidden"
    />
  );
  const tuner = (
    <Button variant="ghost" size="xs">
      <MusicNote /> Tuner
    </Button>
  );
  const p1 = page === 'rig' && variant === 'p1';
  const speed = { '--c2-speed': slowMotion ? 4 : 1 } as CSSProperties;

  const media = useBacking('playing');
  const midiFlash = useMidiFlash();
  const calibrated = !problem;
  usePlayhead(media);
  const levels = useSampleLevels();
  const tools = sampleDockTools(media);
  const [layout, setLayout] = useDockLayout(
    remember ? `oxidal.dock.${page}` : null,
    startLayout ??
      (startDock === 'closed'
        ? layoutOf({})
        : layoutOf(
            { right: ['player', 'stems', 'sheet'] },
            { right: { active: startTab, glass: startDock === 'overlay' } },
          )),
  );
  const [tab, setTab] = useState<DockToolId>(startTab);
  const [sheetOpen, setSheetOpen] = useState(phoneSheet);
  const openMedia = (t: DockToolId = 'player') => {
    setTab(t);
    if (phone) setSheetOpen(true);
    else setLayout(showTool(layout, t));
  };
  const sheetTools = openTools(layout, TOOL_ORDER);
  // The chain's own width decides whether the edge figures fit beside it
  // (the lanes measure it themselves; the chain keeps the same room clear).
  const viewport = useViewportWidth();
  const narrow =
    viewport - (phone ? 0 : sideRoom(layout, viewport >= 1200)) < 1200;
  const guitarSelector = (
    <GuitarSelector
      guitars={SAMPLE_GUITARS}
      active={levels.guitar}
      onSelect={levels.setGuitar}
      onManage={() => setWhere('guitars')}
    />
  );
  const footer = (
    <>
      {phone && track && (
        <MiniPlayer
          title={media.title}
          position={media.shown}
          duration={time(DURATION)}
          progress={media.position / DURATION}
          playing={media.playing}
          onPlay={() => media.setState('playing')}
          onPause={() => media.setState('paused')}
          onOpen={() => openMedia('player')}
          note={media.split ? `Splitting ${media.split.progress}%` : undefined}
        />
      )}
      <RigBottomTabs destination={where} onNavigate={setWhere} />
      {phone && track && (
        <DockSheet
          title={media.title}
          description={media.caption}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          active={tab}
          onActive={(id) => setTab(id as DockToolId)}
          tools={tools.filter((t) =>
            (sheetTools.length
              ? [...sheetTools, tab]
              : ['player', 'stems', 'sheet']
            ).includes(t.id),
          )}
        />
      )}
    </>
  );
  /** The docked tools around a page's middle; a phone keeps them in its sheet. */
  const docked = (
    body: (parts: DockParts) => ReactNode,
    className?: string,
    inside = false,
  ) =>
    phone ? (
      body({ bottom: null, glass: null, strips: { left: null, right: null } })
    ) : (
      <DockZones
        className={className}
        inside={inside}
        tools={tools}
        layout={layout}
        onLayout={setLayout}
        menuOpenFor={menuOpenFor}
      >
        {body}
      </DockZones>
    );

  const capsule = (
    <FloatingCapsule
      className="absolute inset-x-0 top-2"
      destination={where}
      onNavigate={setWhere}
      // The wordmark goes home to the Rig, as in the app.
      onHome={() => setWhere('rig')}
      status={
        stopped
          ? { word: 'Audio stopped', problem: true }
          : problem
            ? { word: 'DSP 86%', problem: true }
            : { word: 'All good' }
      }
      muted={muted}
      onMute={setMuted}
      onSearch={() => undefined}
      menu={sampleMenu(openMedia)}
      midi={{ name: 'Chocolate', connected: true }}
      menuNote={CHAIN_STATUS_LINE}
      media={
        track
          ? {
              title: media.title,
              playing: media.playing,
              position: media.shown,
              work: media.split
                ? `Splitting ${media.split.progress}%`
                : undefined,
              onOpen: () => openMedia('player'),
            }
          : undefined
      }
      playing={running}
      inputLevel={running ? (silent ? -72 : input.level) : null}
      keepOpen={keepOpen}
      idleMs={idleSeconds * 1000}
      phase={phase}
      defaultMenuOpen={page === 'tools'}
      preset={p1 ? { name, picker: picker() } : undefined}
      actions={
        p1 ? (
          <PerformButton
            onPerform={() => undefined}
            compact={phone}
            size="xs"
          />
        ) : undefined
      }
      openExtras={p1 ? tuner : undefined}
    />
  );

  if (page === 'perform')
    return (
      <C2PerformSample
        phase={phase}
        playing={running}
        idleSeconds={idleSeconds}
        slowMotion={slowMotion}
      />
    );

  if (page === 'rig') {
    return (
      <div style={speed} className="h-dvh">
        {docked(
          ({ bottom, glass, strips }) => (
            <ChainBarRigSample
              aboveBar={bottom}
              edits="edited"
              insetTop={72}
              insetSide={phone ? 0 : narrow ? 56 : 148}
              barLead={variant === 'p2' ? picker(true) : undefined}
              barTrail={
                variant === 'p2' ? (
                  <>
                    {!phone && (
                      <Button variant="ghost" size="xs">
                        <MusicNote /> Tuner
                      </Button>
                    )}
                    <PerformButton
                      onPerform={() => undefined}
                      compact={phone}
                      size="xs"
                    />
                  </>
                ) : undefined
              }
              chainOverlay={
                !phone && (
                  <>
                    <EdgeLanes
                      className="top-14"
                      stopped={!running}
                      playing={running}
                      moving={moving}
                      input={{
                        level: running ? input.level : null,
                        peak: running ? input.peak : null,
                        control: (
                          <span className="flex items-center gap-4">
                            {guitarSelector}
                            {strips.left}
                          </span>
                        ),
                        figures: [
                          {
                            label: 'Input',
                            value: `${Math.round(input.peak)} dBFS`.replace(
                              '-',
                              '−',
                            ),
                            attention: input.peak > -3,
                          },
                          calibrated
                            ? { label: 'Calibrated', value: '−12 dBu' }
                            : {
                                label: 'Calibration',
                                value: 'Not set',
                                attention: true,
                              },
                          {
                            label: 'MIDI',
                            value: midiFlash ?? 'Chocolate',
                            light: 'on',
                            title: 'Chocolate connected. Open Settings › MIDI',
                            onOpen: () => setWhere('settings'),
                          },
                        ],
                      }}
                      output={{
                        level: running ? output.level : null,
                        peak: running ? output.peak : null,
                        control: (
                          <span className="flex items-center gap-4">
                            {strips.right}
                            <OutputLevelControl
                              levelDb={levels.levelDb}
                              onLevel={levels.setLevelDb}
                              mono={levels.mono}
                              onMono={levels.setMono}
                              boost={
                                <Button size="sm" variant="outline">
                                  Boost{' '}
                                  <span className="font-mono tabular-nums">
                                    +0.0 dB
                                  </span>
                                </Button>
                              }
                            />
                          </span>
                        ),
                        figures: [
                          {
                            label: 'DSP',
                            value: problem ? '86%' : '31%',
                            attention: problem,
                          },
                          { label: 'CPU', value: '18%' },
                          { label: 'Xruns', value: '0' },
                          { label: 'Clips', value: '0' },
                          // Shown only when they need attention.
                          ...(problem
                            ? [
                                {
                                  label: 'Temp',
                                  value: '81 °C',
                                  attention: true,
                                },
                              ]
                            : []),
                        ],
                      }}
                    />
                    {glass}
                  </>
                )
              }
              header={() => (
                <>
                  {/* A short fade keeps the capsule readable over the chain. */}
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 top-0 z-10 h-20 bg-linear-to-b from-background via-background/80 to-transparent [[data-display=epaper]_&]:hidden"
                  />
                  {capsule}
                </>
              )}
              footer={footer}
              barCentre={
                <StreamStatus
                  stream={SAMPLE_STREAM}
                  engine={SAMPLE_ENGINE}
                  onRestartAudio={() => undefined}
                  onAudioSettings={() => setWhere('settings')}
                  onEngineSettings={() => setWhere('settings')}
                />
              }
              // Level, Mono and Boost live at OUT on a laptop or tablet; a
              // phone keeps them in the panel, with the guitar beside them.
              levelRow={phone}
              levelExtra={phone ? guitarSelector : undefined}
            />
          ),
          undefined,
          true,
        )}
      </div>
    );
  }

  if (page === 'welcome')
    return (
      <div
        style={speed}
        className="relative flex h-dvh flex-col bg-background text-foreground"
      >
        {capsule}
        <main className="min-h-0 flex-1 overflow-y-auto pt-16">
          <FirstRun
            wordmark={false}
            done={['settings/connections']}
            onStep={() => undefined}
            onDone={() => setWhere('rig')}
          />
        </main>
        {footer}
      </div>
    );

  const p = PAGES[page];
  return (
    <div
      style={speed}
      className="relative flex h-dvh flex-col bg-background text-foreground"
    >
      {capsule}
      {docked(
        ({ bottom }) => (
          <>
            <main className="min-h-0 flex-1 overflow-y-auto pt-16">
              {/* The page name once: on a phone the section picker and its
            description follow, so the eyebrow and caption step aside. */}
              <PageHeading
                size="lg"
                eyebrow={phone ? undefined : p.eyebrow}
                title={p.title}
                caption={phone ? undefined : p.caption}
                className="pt-6 pb-4 max-md:pt-4 max-md:pb-3"
              />
              {page === 'settings-display' && (
                <div className="px-page pb-3">
                  <div className="flex max-w-3xl items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3">
                    <div className="grid gap-0.5">
                      <label
                        htmlFor="keep-menu-open"
                        className="text-sm font-medium"
                      >
                        Keep the menu open while playing
                      </label>
                      <Caption>
                        Off: the menu folds into a small bubble a few seconds
                        after you start playing, and comes back when you reach
                        for it.
                      </Caption>
                    </div>
                    <Switch
                      id="keep-menu-open"
                      checked={keepOpen}
                      onCheckedChange={setKeepOpen}
                    />
                  </div>
                </div>
              )}
              <div className="[&_[data-slot=page-heading]]:hidden max-md:[&_[data-slot=workspace]>section>h2]:sr-only">
                {p.body}
              </div>
            </main>
            {bottom}
          </>
        ),
        'min-h-0 flex-1',
      )}
      {footer}
    </div>
  );
}
