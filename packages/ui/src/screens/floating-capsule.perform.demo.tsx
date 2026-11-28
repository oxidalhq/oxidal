import { MusicNote, Notebook } from '@phosphor-icons/react';
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { Led } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Toggle } from '../components/ui/toggle';
import { glyphForBlock } from '../lib/block-glyphs';
import { cn } from '../lib/cn';
import { layoutOf, placeOf, showTool } from '../lib/dock-layout';
import { blocksOf, isSplit } from '../lib/route';
import { parseSong } from '../lib/song';
import { useMedia } from '../lib/use-media';
import { DockZones } from '../patterns/dock-zones';
import { EdgeLanes } from '../patterns/edge-lanes';
import {
  type CapsulePhase,
  FloatingCapsule,
} from '../patterns/floating-capsule';
import {
  PresetRow,
  RigBottomTabs,
  type RigDestination,
} from '../patterns/rig-top-bar';
import type { BlockModel } from '../widgets/block-editor';
import { BlockGlyph } from '../widgets/block-glyph';
import type { Footswitch } from '../widgets/controllers';
import { FootswitchPad } from '../widgets/footswitches';
import { Meter } from '../widgets/meter';
import { FOUR_JOBS, FOUR_SCENES } from '../widgets/scene-editor.fixtures';
import { SheetViewer } from '../widgets/sheet-viewer';
import { Transport, type TransportState } from '../widgets/transport';
import { useBacking, usePlayhead } from './floating-capsule.hooks';
import { sampleDockTools, sampleMenu } from './floating-capsule.tools';
import { FRIDAY_SET } from './perform.data';
import { SONGS } from './songs.data';

/**
 * Perform with the floating capsule: the preset and the set list in the
 * capsule, the tall IN and OUT meters at the edges, the footswitch cards
 * filling the screen, and one compact row along the bottom (tempo, Tuner,
 * the player and the level). Each card says what its switch does, the MIDI
 * it answers to (the default map) and, for a scene or a stomp, the pedals it
 * turns on and off. Design sample with fixed example data.
 */

const BLOCKS = blocksOf(FOUR_JOBS);
const JOBS = FOUR_JOBS.find(isSplit)!;
const SILENT = -60;

/** The four switches of an M-Vave Chocolate, as the owner sets them up. */
const FOUR: Footswitch[] = [
  {
    id: 'A',
    name: 'A',
    tap: { kind: 'scene', scene: 'verse' },
    hold: { kind: 'boost' },
  },
  {
    id: 'B',
    name: 'B',
    tap: { kind: 'scene', scene: 'chorus' },
    hold: { kind: 'block', block: 'wet-echo' },
  },
  {
    id: 'C',
    name: 'C',
    tap: { kind: 'scene', scene: 'lead' },
    hold: { kind: 'tuner' },
  },
  {
    id: 'D',
    name: 'D',
    tap: { kind: 'block', block: 'ts9' },
    hold: { kind: 'tap' },
  },
];

/** The ten switches of a MIDI Captain STD 10. */
const TEN: Footswitch[] = [
  { id: '1', name: '1', tap: { kind: 'scene', scene: 'verse' } },
  { id: '2', name: '2', tap: { kind: 'scene', scene: 'chorus' } },
  { id: '3', name: '3', tap: { kind: 'scene', scene: 'lead' } },
  { id: '4', name: '4', tap: { kind: 'scene', scene: 'swells' } },
  { id: 'up', name: '▲', tap: { kind: 'tap' }, hold: { kind: 'tuner' } },
  { id: 'A', name: 'A', tap: { kind: 'block', block: 'ts9' } },
  { id: 'B', name: 'B', tap: { kind: 'block', block: 'wet-echo' } },
  { id: 'C', name: 'C', tap: { kind: 'boost' } },
  { id: 'D', name: 'D', tap: { kind: 'play' }, hold: { kind: 'loop' } },
  { id: 'down', name: '▼', tap: { kind: 'next' }, hold: { kind: 'previous' } },
];

/** What the default MIDI map (Settings › MIDI) sends for an action. */
function midiOf(action: Footswitch['tap']): string {
  switch (action.kind) {
    case 'scene':
      return `CC ${16 + FOUR_SCENES.findIndex((s) => s.id === action.scene)} · 127`;
    case 'previous':
      return 'CC 24 · 127';
    case 'next':
      return 'CC 25 · 127';
    case 'tuner':
      return 'CC 26 · 127';
    case 'tap':
      return 'CC 27 · 127';
    case 'boost':
      return 'CC 28 · 127';
    case 'block':
      return `CC ${48 + BLOCKS.findIndex((b) => b.id === action.block)} · 127`;
    case 'play':
      return 'PC 3';
    default:
      return '';
  }
}

/** The pedals a scene plays: the branches it hears, each block on or off. */
function pedalsOf(action: Footswitch['tap']) {
  if (action.kind === 'block') {
    const b = BLOCKS.find((x) => x.id === action.block);
    return b ? [{ block: b, on: true }] : [];
  }
  if (action.kind !== 'scene') return [];
  const scene = FOUR_SCENES.find((s) => s.id === action.scene);
  if (!scene) return [];
  const levels = scene.levels?.jobs ?? JOBS.levels ?? [];
  const heard: BlockModel[] = [
    BLOCKS[0]!,
    ...JOBS.branches.flatMap((branch, i) =>
      (levels[i] ?? 0) > SILENT ? blocksOf(branch) : [],
    ),
  ];
  return heard.map((block) => ({
    block,
    on: scene.on?.[block.id] ?? block.on,
  }));
}

/** The pedals as a short strip of chips: off ones faded. */
function Pedals({
  pedals,
  dark,
}: {
  pedals: { block: BlockModel; on: boolean }[];
  dark: boolean;
}) {
  const shown = pedals.slice(0, 6);
  // One row, so the chips never cover the card's words above them.
  return (
    <span className="flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
      {shown.map(({ block, on }) => (
        <span
          key={block.id}
          className={cn(
            'rounded inline-flex shrink-0 items-center gap-1 border px-1 py-0.5',
            dark
              ? 'border-background/40 bg-foreground'
              : 'border-border bg-background',
            !on && 'opacity-40',
          )}
        >
          <Led kind={block.kind} on={on} className="size-1.5" />
          <BlockGlyph glyph={glyphForBlock(block)} className="size-3.5" />
        </span>
      ))}
      {pedals.length > shown.length && (
        <span className="shrink-0 font-mono text-xs">
          +{pedals.length - shown.length}
        </span>
      )}
    </span>
  );
}

type StageNow = {
  scene: string;
  boost: boolean;
  tuner: boolean;
  playing: boolean;
  loop: boolean;
  on: Record<string, boolean>;
};

function describe(action: Footswitch['tap'], now: StageNow) {
  switch (action.kind) {
    case 'scene':
      return {
        label: FOUR_SCENES.find((s) => s.id === action.scene)?.name ?? '',
        on: now.scene === action.scene,
      };
    case 'block': {
      const b = BLOCKS.find((x) => x.id === action.block);
      return { label: b?.label ?? 'Block', on: now.on[action.block] ?? false };
    }
    case 'boost':
      return { label: 'Boost', on: now.boost };
    case 'tuner':
      return { label: 'Tuner', on: now.tuner };
    case 'tap':
      return { label: 'Tap 96', on: false };
    case 'previous':
      return { label: 'Previous', on: false };
    case 'next':
      return { label: 'Next', on: false };
    case 'play':
      return { label: now.playing ? 'Pause' : 'Play', on: now.playing };
    case 'loop':
      return { label: 'Loop', on: now.loop };
    default:
      return { label: '—', on: false };
  }
}

/** The pedals as a short list with names: what the switch turns on, and what it leaves off. */
function PedalList({
  pedals,
  dark,
}: {
  pedals: { block: BlockModel; on: boolean }[];
  dark: boolean;
}) {
  return (
    <ul className="m-0 grid list-none content-start gap-1.5 p-0">
      {pedals.slice(0, 7).map(({ block, on }) => (
        <li
          key={block.id}
          className={cn(
            'flex min-w-0 items-center gap-2 text-sm',
            on ? 'font-medium' : 'font-normal',
          )}
        >
          <Led kind={block.kind} on={on} className="size-2" />
          <BlockGlyph
            glyph={glyphForBlock(block)}
            className={cn('size-4 shrink-0', !on && 'opacity-40')}
          />
          <span className="truncate">{block.label}</span>
          {!on && (
            <span
              className={cn(
                'shrink-0 small-caps text-xs',
                dark ? 'text-background/70' : 'text-muted-foreground',
              )}
            >
              Off
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One footswitch card: the pad, with its pedals and its MIDI along the bottom. */
function Card({
  sw,
  now,
  onPress,
  size,
}: {
  sw: Footswitch;
  now: StageNow;
  onPress: (action: Footswitch['tap']) => void;
  size: 'md' | 'lg';
}) {
  const tap = describe(sw.tap, now);
  const hold = sw.hold ? describe(sw.hold, now) : null;
  const scene = sw.tap.kind === 'scene';
  const dark = scene && tap.on;
  const midi = midiOf(sw.tap);
  const pedals = pedalsOf(sw.tap);
  return (
    <div
      data-slot="perform-card"
      className={cn(
        'relative grid min-h-0 [&>[data-slot=footswitch]]:h-full [&>[data-slot=footswitch]]:content-start [&>[data-slot=footswitch]]:pb-12',
        // A large card: the action in large type, as on the Stage screen.
        size === 'lg' &&
          '[&>[data-slot=footswitch]_.line-clamp-2]:text-2xl md:[&>[data-slot=footswitch]_.line-clamp-2]:text-3xl',
      )}
    >
      <FootswitchPad
        name={sw.name}
        label={tap.label}
        holdLabel={hold?.label}
        accessibleName={[
          sw.name,
          tap.label,
          hold && `Hold · ${hold.label}`,
          midi && `MIDI ${midi}`,
        ]
          .filter(Boolean)
          .join(' ')}
        pressed={
          ['previous', 'next', 'tap'].includes(sw.tap.kind) ? undefined : tap.on
        }
        scene={scene}
        size={size}
        onTap={() => onPress(sw.tap)}
        onHold={sw.hold ? () => onPress(sw.hold!) : undefined}
      />
      {size === 'lg' && pedals.length > 0 && (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-x-3 top-28 bottom-12 overflow-hidden md:top-32',
            dark ? 'text-background' : 'text-foreground',
          )}
        >
          <PedalList pedals={pedals} dark={dark} />
        </div>
      )}
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-2',
          dark ? 'text-background' : 'text-muted-foreground',
        )}
      >
        {size === 'md' ? <Pedals pedals={pedals} dark={dark} /> : <span />}
        {midi && (
          <span className="shrink-0 font-mono text-xs tabular-nums">
            {midi}
          </span>
        )}
      </span>
    </div>
  );
}

function useLevel(running: boolean, base: number) {
  const [v, setV] = useState({ level: base, peak: base });
  useEffect(() => {
    if (!running) return;
    let level = base;
    let peak = base;
    let hold = 0;
    const id = setInterval(() => {
      const target = base + (Math.random() - 0.5) * 8;
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

export function C2PerformSample({
  controller = 'four',
  phase,
  playing = true,
  idleSeconds = 3,
  slowMotion = false,
  sheet: startSheet = false,
  playerDock = false,
}: {
  controller?: 'four' | 'ten';
  /** The chord sheet in the middle; the switch cards shrink to a row. */
  sheet?: boolean;
  /** The backing track's player docked at the bottom, above the bottom row. */
  playerDock?: boolean;
  phase?: CapsulePhase;
  playing?: boolean;
  idleSeconds?: number;
  slowMotion?: boolean;
}) {
  const [where, setWhere] = useState<RigDestination>('rig');
  const [muted, setMuted] = useState(false);
  const [locked, setLocked] = useState(true);
  const [sheetOn, setSheetOn] = useState(startSheet);
  const song = useMemo(() => {
    const found = SONGS.find((x) => x.id === 'harbour');
    return found ? parseSong(found.source, found.format) : null;
  }, []);
  const [at, setAt] = useState(0);
  const [transport, setTransport] = useState<TransportState>('playing');
  const [now, setNow] = useState<StageNow>({
    scene: 'verse',
    boost: false,
    tuner: false,
    playing: true,
    loop: false,
    on: { ts9: false, 'wet-echo': true },
  });
  const phone = useMedia('(max-width: 47.99rem)');
  const media = useBacking('playing');
  usePlayhead(media);
  const [dock, setDock] = useState(() =>
    layoutOf(playerDock ? { bottom: ['player'] } : {}),
  );
  // With the player docked, the bottom row leaves the transport to it.
  const playerShown = !phone && placeOf(dock, 'player') !== 'closed';
  const input = useLevel(playing, -16);
  const output = useLevel(playing, -10);
  const entry = FRIDAY_SET[at]!;
  const next = FRIDAY_SET[at + 1];
  const switches = controller === 'four' ? FOUR : TEN;
  const press = (a: Footswitch['tap']) =>
    setNow((n) => {
      if (a.kind === 'scene') return { ...n, scene: a.scene };
      if (a.kind === 'block')
        return { ...n, on: { ...n.on, [a.block]: !n.on[a.block] } };
      if (a.kind === 'boost') return { ...n, boost: !n.boost };
      if (a.kind === 'tuner') return { ...n, tuner: !n.tuner };
      if (a.kind === 'play') return { ...n, playing: !n.playing };
      if (a.kind === 'loop') return { ...n, loop: !n.loop };
      return n;
    });
  const step = (by: number) =>
    setAt((i) => Math.min(FRIDAY_SET.length - 1, Math.max(0, i + by)));

  return (
    <div
      style={{ '--c2-speed': slowMotion ? 4 : 1 } as CSSProperties}
      className="relative flex h-dvh flex-col bg-background text-foreground"
    >
      <FloatingCapsule
        className="absolute inset-x-0 top-2"
        destination={where}
        onNavigate={setWhere}
        status={{ word: 'All good' }}
        muted={muted}
        onMute={setMuted}
        onSearch={() => undefined}
        menu={sampleMenu((tool) => setDock(showTool(dock, tool)))}
        media={
          playerShown
            ? {
                title: media.title,
                playing: media.playing,
                position: media.shown,
                work: media.split
                  ? `Splitting ${media.split.progress}%`
                  : undefined,
                onOpen: () => setDock(showTool(dock, 'player')),
              }
            : undefined
        }
        playing={playing}
        inputLevel={playing ? input.level : null}
        idleMs={idleSeconds * 1000}
        phase={phase}
        preset={{
          name: entry.preset,
          picker: (
            <PresetRow
              variant="bare"
              name={entry.preset}
              presets={FRIDAY_SET.map((e) => e.preset)}
              onPick={(p) => setAt(FRIDAY_SET.findIndex((e) => e.preset === p))}
              previousName={FRIDAY_SET[at - 1]?.preset}
              nextName={next?.preset}
              onPrevious={at > 0 ? () => step(-1) : undefined}
              onNext={next ? () => step(1) : undefined}
              muted={muted}
              onMute={setMuted}
              without={['tuner', 'mute', 'perform', 'more']}
              controlSize="xs"
              onSearch={() => undefined}
              onTuner={() => undefined}
              onPerform={() => undefined}
              onProtect={() => undefined}
              onStopAudio={() => undefined}
              className="[&>span:last-child]:hidden"
            />
          ),
        }}
        openExtras={
          <>
            <span className="px-2 text-sm whitespace-nowrap text-muted-foreground">
              {at + 1} of {FRIDAY_SET.length}
              {next && ` · Next: ${next.preset}`}
            </span>
            <Toggle
              size="xs"
              pressed={sheetOn}
              onPressedChange={setSheetOn}
              className="border-transparent"
            >
              <Notebook /> Sheet
            </Toggle>
            <Toggle size="xs" pressed={locked} onPressedChange={setLocked}>
              {locked ? 'Protected' : 'Protect'}
            </Toggle>
          </>
        }
      />

      {((body: (parts: { bottom: ReactNode }) => ReactNode) =>
        phone ? (
          body({ bottom: null })
        ) : (
          <DockZones
            className="min-h-0 flex-1"
            tools={sampleDockTools(media)}
            layout={dock}
            onLayout={setDock}
          >
            {body}
          </DockZones>
        ))(({ bottom }) => (
        <>
          <main
            aria-label="Footswitches"
            className="relative min-h-0 flex-1 pt-16 pb-2"
          >
            {!phone && (
              <>
                <EdgeLanes
                  className="top-14"
                  playing={playing}
                  input={{
                    level: playing ? input.level : null,
                    peak: playing ? input.peak : null,
                  }}
                  output={{
                    level: playing ? output.level : null,
                    peak: playing ? output.peak : null,
                  }}
                />
              </>
            )}
            <div
              className={cn(
                'grid h-full gap-2 px-page md:gap-3 md:px-16',
                sheetOn && song
                  ? 'grid-rows-[minmax(0,1fr)_auto]'
                  : 'grid-rows-[minmax(0,1fr)]',
              )}
            >
              {sheetOn && song && (
                <SheetViewer
                  song={song}
                  stage
                  linked={['Set list · Friday gig']}
                  className="min-h-0"
                />
              )}
              <div
                role="group"
                aria-label={`Footswitches · ${controller === 'four' ? 'M-Vave Chocolate' : 'MIDI Captain STD 10'}`}
                className={cn(
                  'grid min-h-0 auto-rows-fr gap-2 md:gap-3',
                  sheetOn && song
                    ? 'grid-cols-4 [&_[data-slot=perform-card]]:h-auto [&_[data-slot=perform-card]]:min-h-32'
                    : controller === 'four'
                      ? 'grid-cols-2 md:grid-cols-4'
                      : 'grid-cols-2 sm:grid-cols-5',
                )}
              >
                {(sheetOn && song ? switches.slice(0, 4) : switches).map(
                  (sw) => (
                    <Card
                      key={sw.id}
                      sw={sw}
                      now={now}
                      onPress={press}
                      size={
                        controller === 'four' && !(sheetOn && song)
                          ? 'lg'
                          : 'md'
                      }
                    />
                  ),
                )}
              </div>
            </div>
          </main>
          {bottom}
        </>
      ))}

      <div
        role="group"
        aria-label="Tempo, tuner, player and level"
        className="flex shrink-0 items-center gap-2 border-t border-border px-page py-2"
      >
        {/* Stage controls: the touch height everywhere, like the player's buttons. */}
        <Button variant="outline" size="md" className="font-mono tabular-nums">
          Tap · {entry.bpm ?? 96}
        </Button>
        <Button variant="outline" size="md" className="max-sm:px-2">
          <MusicNote />
          <span className="max-sm:sr-only">Tuner</span>
        </Button>
        {!playerShown && (
          <>
            <Transport
              compact
              state={transport}
              onPlay={() => setTransport('playing')}
              onPause={() => setTransport('paused')}
            />
            <span className="min-w-0 truncate text-sm font-medium max-sm:hidden">
              {entry.song ? 'Harbour lights' : 'No backing track'}
            </span>
          </>
        )}
        <Meter
          label="Out"
          value={playing ? output.level : null}
          state={playing ? 'live' : 'stopped'}
          size="sm"
          className="ml-auto w-40 max-sm:w-24"
        />
      </div>
      <RigBottomTabs destination={where} onNavigate={setWhere} />
    </div>
  );
}
