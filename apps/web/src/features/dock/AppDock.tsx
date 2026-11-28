import {
  Faders,
  FileText,
  ListNumbers,
  MusicNote,
  SlidersHorizontal,
  Waveform,
} from '@phosphor-icons/react';
import {
  type ReactNode,
  useContext,
  useEffect,
  useEffectEvent,
  useState,
} from 'react';

import {
  type DockLayout,
  layoutOf,
  openTools,
  placeOf,
  showTool,
} from '@oxidal/design-system/lib/dock-layout';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';
import { ToolLauncherContext } from '@oxidal/design-system/patterns/dock-context';
import {
  DockSheet,
  type DockTool,
  DockZones,
} from '@oxidal/design-system/patterns/dock-zones';
import { MiniPlayer } from '@oxidal/design-system/widgets/mini-player';

import { BackingPanelBody } from '../../components/media/PlayerSheet';
import {
  stateWord,
  usePlayerPosition,
  useSessionMedia,
} from '../../components/media/sessionMedia';
import { LiveStemsPanel } from '../../components/media/StemMixer';
import { VenueEq } from '../../components/media/VenueEq';
import { TunerTool } from '../../GlobalTuner';
import { formatTime } from '../../lib/playerClock';
import { requestTuner } from '../../tunerNavigation';
import { LinkedSheet } from '../library/LinkedSheet';
import { setPresetSlot } from '../rig/PresetSlot';
import { DockPartsContext } from './dockParts';
import { OPEN_TOOL_EVENT, requestTool, type ToolId } from './toolNavigation';

/** The order tools are listed in, in the ☰ menu and a phone's sheet. */
const ORDER: ToolId[] = [
  'player',
  'stems',
  'sheet',
  'setlist',
  'tuner',
  'venue',
];

/** A phone's zones: none; its tools share one sheet. */
const EMPTY = layoutOf({});

/** Where the Rig's presets and set list draw themselves. */
function SetListSlot() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPresetSlot(element);
    return () => setPresetSlot(null);
  }, [element]);
  return <div ref={setElement} className="min-w-0" />;
}

/** Stems for the playing track; the Player chooses a track first. */
function StemsTool() {
  const { player, split } = useSessionMedia();
  return (
    <>
      {split?.phase === 'running' && (
        <p role="status" className="m-0 mb-3 text-sm">
          Splitting · {split.percent}%
        </p>
      )}
      {player?.stems ? (
        <LiveStemsPanel />
      ) : (
        <p className="m-0 text-sm text-muted-foreground">
          The playing track has no stems. Choose a split song in the Player.
        </p>
      )}
    </>
  );
}

/**
 * The tools kept beside every screen (C2): Player, Stems, Sheet, the Rig's
 * Set list, Tuner and Venue EQ in left, right and bottom zones, opened from
 * the capsule's ☰ menu; on a phone, one bottom sheet with a tab each. Moving,
 * folding or closing a tool sends nothing to the device: a playing track
 * and a running split carry on.
 * @see docs/interface.md
 */
export function AppDock({
  layout,
  onLayout,
  connected,
  stage,
  setList,
  placeBottom,
  children,
}: {
  layout: DockLayout;
  onLayout: (layout: DockLayout) => void;
  connected: boolean;
  stage: boolean;
  /** The Rig offers its presets and set list as a tool. */
  setList: boolean;
  /** The screen does not place the bottom zone itself: put it under the page. */
  placeBottom: boolean;
  children: ReactNode;
}) {
  const phone = useVerticalRig();
  const media = useSessionMedia();
  const { player, shown, split } = media;
  const track = player?.track;
  const playing = shown === 'playing' || shown === 'stalled';
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tab, setTab] = useState<ToolId>('player');

  const all: (DockTool & { id: ToolId })[] = [
    {
      id: 'player',
      title: 'Player',
      icon: <MusicNote />,
      content: <BackingPanelBody stems={false} />,
      running: track && playing ? `${track.title} is playing` : undefined,
    },
    {
      id: 'stems',
      title: 'Stems',
      icon: <Faders />,
      content: <StemsTool />,
      running:
        split?.phase === 'running'
          ? `Splitting · ${split.percent}%`
          : undefined,
    },
    {
      id: 'sheet',
      title: 'Sheet',
      icon: <FileText />,
      content: <LinkedSheet />,
    },
    ...(setList
      ? [
          {
            id: 'setlist' as const,
            title: 'Set list',
            icon: <ListNumbers />,
            content: <SetListSlot />,
          },
        ]
      : []),
    {
      id: 'tuner',
      title: 'Tuner',
      icon: <Waveform />,
      content: <TunerTool stage={stage} onStart={requestTuner} />,
    },
    {
      id: 'venue',
      title: 'Venue EQ',
      icon: <SlidersHorizontal />,
      content: <VenueEq connected={connected} />,
    },
  ];
  const offered = (id: ToolId) => all.some((t) => t.id === id);

  const open = (id: ToolId) => {
    if (!offered(id)) return;
    setTab(id);
    // A phone shows it in the sheet; the layout keeps it for a wider screen.
    onLayout(showTool(layout, id));
    if (phone) setSheetOpen(true);
  };
  const toggle = (id: ToolId) => {
    if (phone) {
      if (sheetOpen && tab === id) setSheetOpen(false);
      else open(id);
    } else if (placeOf(layout, id) === 'closed') open(id);
    else
      onLayout({
        ...layout,
        zones: Object.fromEntries(
          Object.entries(layout.zones).map(([z, zone]) => {
            const tools = zone.tools.filter((t) => t !== id);
            return [
              z,
              {
                ...zone,
                tools,
                active: zone.active === id ? (tools[0] ?? null) : zone.active,
              },
            ];
          }),
        ) as DockLayout['zones'],
        floating: layout.floating.filter((f) => f.id !== id),
      });
  };

  // A phone shows one sheet at a time: the full player or a track's
  // details replace the dock's sheet.
  const [seenSheet, setSeenSheet] = useState(media.sheet);
  if (media.sheet !== seenSheet) {
    setSeenSheet(media.sheet);
    if (media.sheet && phone && sheetOpen) setSheetOpen(false);
  }

  // The capsule's ☰ menu lists every tool, ticked while it is open.
  const setEntries = useContext(ToolLauncherContext);
  const shownOn = (id: ToolId) =>
    phone ? sheetOpen && tab === id : placeOf(layout, id) !== 'closed';
  const entries = all.map((t) => ({
    id: t.id,
    title: t.title,
    icon: t.icon,
    open: shownOn(t.id),
    toggle: () => toggle(t.id),
  }));
  const signature = JSON.stringify(entries.map((e) => [e.id, e.open]));
  const publish = useEffectEvent(() => setEntries?.(entries));
  useEffect(() => {
    publish();
  }, [signature]);
  useEffect(() => () => setEntries?.(null), [setEntries]);

  // Other screens open a tool by event (the capsule's now-playing part).
  const onOpenTool = useEffectEvent((id: ToolId) => open(id));
  useEffect(() => {
    const on = (event: Event) =>
      onOpenTool((event as CustomEvent<ToolId>).detail);
    window.addEventListener(OPEN_TOOL_EVENT, on);
    return () => window.removeEventListener(OPEN_TOOL_EVENT, on);
  }, []);

  const inSheet = openTools(layout, ORDER).filter((id) =>
    offered(id as ToolId),
  );
  const tabs = all.filter(
    (t) =>
      t.id === tab ||
      inSheet.includes(t.id) ||
      // With a track, the player, its stems and the sheet go together.
      (track && ['player', 'stems', 'sheet'].includes(t.id)),
  );
  const current = all.find((t) => t.id === tab) ?? all[0]!;
  // One tree at every width, so turning a phone or tablet keeps the page
  // (its drafts and open dialogs) as it is: a phone just shows no zones.
  return (
    <>
      <DockZones
        tools={all}
        layout={phone ? EMPTY : layout}
        onLayout={(next) => {
          if (!phone) onLayout(next);
        }}
      >
        {(parts) => (
          <DockPartsContext.Provider value={parts}>
            <div className="flex min-w-0 flex-1 flex-col">
              {children}
              {placeBottom && parts.bottom}
            </div>
          </DockPartsContext.Provider>
        )}
      </DockZones>
      {phone && (
        <DockSheet
          title={tab === 'player' && track ? track.title : current.title}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          active={tab}
          onActive={(id) => setTab(id as ToolId)}
          tools={tabs}
        />
      )}
    </>
  );
}

/**
 * A phone's now-playing strip above the bottom tabs while a track is cued:
 * tap to open the Player in the dock sheet. Wider screens open the Player
 * from the capsule's now-playing part instead.
 * @see docs/interface.md
 */
export function PhoneMiniPlayer() {
  const phone = useVerticalRig();
  const media = useSessionMedia();
  const { at, length } = usePlayerPosition();
  const { player, shown, split, send, muted, notice, slow } = media;
  const track = player?.track;
  if (!phone || !media.ready || !track || shown === 'empty') return null;
  const playing = shown === 'playing' || shown === 'stalled';
  // Said in words whenever it is not simply playing (always on E-paper),
  // with why a running track is silent and why one cannot play.
  const note = [
    !playing || slow ? stateWord[shown] : null,
    shown === 'unavailable' ? player.reason : null,
    muted ? 'Output muted' : null,
    notice || null,
    split?.phase === 'running' ? `Splitting ${split.percent}%` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // A cued track waits at its start; an ended one at its end.
  const place = shown === 'ready' ? 0 : shown === 'ended' ? length : at;
  return (
    <MiniPlayer
      title={track.title}
      position={formatTime(place)}
      duration={formatTime(length)}
      progress={length > 0 ? place / length : 0}
      playing={playing}
      onPlay={() => void send({ kind: 'play' })}
      onPause={() => void send({ kind: 'pause' })}
      onOpen={() => requestTool('player')}
      note={note || undefined}
    />
  );
}

/** The playing track's place, keeping its own time so the page around it does not redraw. */
export function PlayerTime() {
  const { at } = usePlayerPosition();
  return <>{formatTime(at)}</>;
}
