import {
  CaretDown,
  GearSix,
  LockSimple,
  LockSimpleOpen,
  MusicNote,
  Notebook,
  Playlist,
} from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogHeader } from '../components/ui/dialog';
import { List, ListRow } from '../components/ui/list-row';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
} from '../components/ui/sheet';
import { Switch } from '../components/ui/switch';
import { Caption, Eyebrow, Label } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';
import { cn } from '../lib/cn';
import { sceneColour } from '../lib/scene-colours';
import { parseSong } from '../lib/song';
import { tempoFromTaps } from '../lib/tempo';
import { useRemembered } from '../lib/use-remembered';
import { SCENES } from '../patterns/rig.fixtures';
import { CONTROLLERS, type SwitchAction } from '../widgets/controllers';
import { Footswitches, type StageState } from '../widgets/footswitches';
import { Meter } from '../widgets/meter';
import { MidiTarget } from '../widgets/midi';
import { SheetViewer } from '../widgets/sheet-viewer';
import { TapTempo } from '../widgets/tap-tempo';
import { Transport } from '../widgets/transport';
import { TunerFace } from '../widgets/tuner-face';
import { FRIDAY_SET } from './perform.data';
import { PlayerSheet } from './sheets';
import { SONGS } from './songs.data';

/**
 * The stage. Built for a screen a metre or two away — on the floor, on a
 * stand, a phone, a BOOX or a laptop — and for feet first:
 *
 * - **What is playing**, as large as the screen allows, with the version and
 *   the scene. Every change (a switch, a tap) lands with a short settle so
 *   you can confirm it from the floor without reading.
 * - **Next up** under it; the set list opens as a sheet to jump anywhere.
 * - **The foot controller on screen**: one tile per switch of whichever
 *   controller is connected, laid out as on the unit, with its light, its
 *   tap action and its hold action. Pressing the pedal lights the tile;
 *   tapping the tile does the same thing.
 * - **The song's sheet** in the middle when the set list entry has one.
 * - Tap tempo, Tuner, the player and the output level along the bottom.
 * - **Protect** locks editing; the stage never moves its layout while you play.
 */
export function Perform({
  controller: initialController = 'four',
  sheet: initialSheet = false,
  player: initialPlayer = false,
}: {
  controller?: string;
  sheet?: boolean;
  /** Start with the full player open. */
  player?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [scene, setScene] = useState<string | null>('a');
  const [blocks, setBlocks] = useState<StageState['blocks']>({
    ts9: { label: 'TS9', on: true },
    echo: { label: 'Echo', on: false },
  });
  const [boost, setBoost] = useState(false);
  const [tuner, setTuner] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(false);
  const [bpm, setBpm] = useState(FRIDAY_SET[0]!.bpm ?? 120);
  const [protect, setProtect] = useState(true);
  const [controller, setController] = useState(initialController);
  const [showSheet, setShowSheet] = useState(initialSheet);
  const [list, setList] = useState(false);
  const [player, setPlayer] = useState(initialPlayer);
  const [tunerMuted, setTunerMuted] = useRemembered('oxidal.tuner.muted', true);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const [speed, setSpeed] = useState(4);
  const taps = useRef<number[]>([]);

  const entry = FRIDAY_SET[index]!;
  const next = FRIDAY_SET[index + 1];
  const profile =
    CONTROLLERS.find((c) => c.id === controller) ?? CONTROLLERS[0]!;
  const sceneName = SCENES.find((s) => s.id === scene)?.name;
  const song = useMemo(() => {
    const found = entry.song
      ? SONGS.find((s) => s.id === entry.song)
      : undefined;
    return found
      ? { entry: found, song: parseSong(found.source, found.format) }
      : null;
  }, [entry]);
  const sheetOn = showSheet && !!song;

  const go = (to: number) => {
    const at = Math.max(0, Math.min(FRIDAY_SET.length - 1, to));
    setIndex(at);
    setScene('a');
    setBpm(FRIDAY_SET[at]!.bpm ?? bpm);
  };

  const act = (action: SwitchAction) => {
    switch (action.kind) {
      case 'scene':
        return setScene(action.scene);
      case 'previous':
        return go(index - 1);
      case 'next':
        return go(index + 1);
      case 'block':
        return setBlocks((all) => ({
          ...all,
          [action.block]: { ...all[action.block]!, on: !all[action.block]?.on },
        }));
      case 'tuner':
        return setTuner((on) => !on);
      case 'boost':
        return setBoost((on) => !on);
      case 'play':
        return setPlaying((on) => !on);
      case 'loop':
        return setLoop((on) => !on);
      case 'tap': {
        const now = performance.now();
        const last = taps.current[taps.current.length - 1];
        taps.current =
          last && now - last > 2000 ? [now] : [...taps.current.slice(-7), now];
        const t = tempoFromTaps(taps.current);
        if (t && t >= 30 && t <= 300) setBpm(t);
        return;
      }
      case 'none':
        return;
    }
  };

  const state: StageState = {
    scene,
    scenes: SCENES,
    blocks,
    boost,
    tuner,
    playing,
    loop,
    bpm,
  };

  return (
    <div
      data-slot="perform"
      className="grid h-[calc(100dvh-7rem)] min-h-[34rem] grid-rows-[auto_auto_minmax(0,1fr)_auto_auto] gap-3 px-page py-3 md:h-[calc(100dvh-6rem)]"
    >
      {/* Top: where you are, and the stage settings. */}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => setList(true)}>
          <span className="sr-only">Set list: </span>
          <span className="small-caps max-[379px]:sr-only">Friday set</span>
          <span className="font-mono tabular-nums">
            {index + 1}/{FRIDAY_SET.length}
          </span>
          <CaretDown />
        </Button>
        <div className="flex items-center gap-2">
          {song && (
            <Toggle
              size="sm"
              pressed={showSheet}
              onPressedChange={setShowSheet}
            >
              <Notebook /> <span className="max-sm:sr-only">Sheet</span>
            </Toggle>
          )}
          <MidiTarget
            id="stage:protect"
            label="Protect"
            kind="switch"
            group="Stage"
            onMidi={(m) =>
              (m.kind === 'pc' || m.value > 0) && setProtect((on) => !on)
            }
          >
            <Toggle size="sm" pressed={protect} onPressedChange={setProtect}>
              {protect ? <LockSimple weight="fill" /> : <LockSimpleOpen />}
              <span className="max-sm:sr-only">
                {protect ? 'Protected' : 'Editable'}
              </span>
            </Toggle>
          </MidiTarget>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Stage settings"
              >
                <GearSix />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="grid w-80 gap-3">
              <div className="grid gap-1">
                <Label htmlFor="controller">Foot controller</Label>
                <Select value={controller} onValueChange={setController}>
                  <SelectTrigger id="controller" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTROLLERS.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Caption className="text-xs">
                  Edit what each switch does, and learn its MIDI, in Settings ›
                  MIDI.
                </Caption>
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="sheet-auto">Open the song's sheet</Label>
                <Switch
                  id="sheet-auto"
                  checked={showSheet}
                  onCheckedChange={setShowSheet}
                />
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* What is playing. */}
      <div className="grid justify-items-center gap-0.5 text-center">
        <Eyebrow
          key={`scene-${scene}`}
          className="inline-flex items-center gap-1.5 motion-safe:animate-arrive"
        >
          {sceneName && (
            <span
              aria-hidden="true"
              className="size-2 rounded-full"
              style={{
                backgroundColor: sceneColour(
                  SCENES.findIndex((s) => s.id === scene),
                ),
              }}
            />
          )}
          {sceneName ? `Scene · ${sceneName}` : 'No scene'}
          {boost ? ' · Boost' : ''}
        </Eyebrow>
        <h1
          key={`name-${index}`}
          aria-live="polite"
          className={cn(
            'm-0 w-full truncate font-display font-semibold tracking-tight motion-safe:animate-arrive',
            sheetOn ? 'text-3xl' : 'text-display',
          )}
        >
          {entry.preset}
        </h1>
        <Caption className="flex flex-wrap items-center justify-center gap-x-2 text-sm">
          <span>
            {entry.version === 'Default'
              ? 'Default version'
              : `${entry.version} version`}
          </span>
          {next && (
            <>
              <span aria-hidden="true">·</span>
              <span>
                Next up:{' '}
                <strong className="font-semibold text-foreground">
                  {next.preset}
                </strong>
              </span>
            </>
          )}
        </Caption>
      </div>

      {/* The song's sheet, or room for the switches. */}
      <div className="min-h-0">
        {sheetOn && song ? (
          <SheetViewer
            key={song.entry.id}
            stage
            song={song.song}
            size={sizes[song.entry.id] ?? 3}
            onSize={(size) =>
              setSizes((all) => ({ ...all, [song.entry.id]: size }))
            }
            speed={speed}
            onSpeed={setSpeed}
            className="h-full rounded-lg border border-border"
          />
        ) : (
          <div className="grid h-full">
            <Footswitches
              profile={profile}
              state={state}
              onAction={act}
              size="lg"
              className="h-full max-h-[32rem] self-center"
            />
          </div>
        )}
      </div>

      {sheetOn ? (
        <Footswitches
          profile={profile}
          state={state}
          onAction={act}
          size="md"
        />
      ) : (
        <span />
      )}

      {/* Tempo, tuner, player and output. */}
      <div className="grid gap-2 rounded-lg border border-border bg-card p-2 sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-center sm:gap-4">
        <MidiTarget
          id="stage:tap"
          label="Tap tempo"
          kind="trigger"
          group="Stage"
          className="w-fit"
          onMidi={(m) =>
            (m.kind === 'pc' || m.value > 0) && act({ kind: 'tap' })
          }
        >
          <TapTempo bpm={bpm} onBpm={setBpm} trackBpm={entry.bpm} />
        </MidiTarget>
        <MidiTarget
          id="stage:tuner"
          label="Tuner"
          kind="switch"
          group="Stage"
          onMidi={(m) =>
            (m.kind === 'pc' || m.value > 0) && setTuner((on) => !on)
          }
        >
          <Button variant="outline" onClick={() => setTuner(true)}>
            <MusicNote /> Tuner
          </Button>
        </MidiTarget>
        <div className="flex min-w-0 items-center gap-3">
          <Transport
            compact
            state={playing ? 'playing' : 'paused'}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          <div className="grid min-w-0 flex-1 gap-1">
            <span className="truncate text-sm font-medium">
              {song ? song.song.title : 'No backing track'}
            </span>
            <Meter
              label="Out"
              value={playing ? -12 : null}
              state={playing ? 'live' : 'stopped'}
              size="sm"
            />
          </div>
          {loop && <Badge tone="live">Loop</Badge>}
          <Button
            variant="outline"
            className="shrink-0"
            onClick={() => setPlayer(true)}
          >
            <Playlist /> <span className="max-sm:sr-only">Player</span>
          </Button>
        </div>
      </div>

      <PlayerSheet open={player} onOpenChange={setPlayer} />

      <Sheet open={list} onOpenChange={setList}>
        <SheetContent onOpenChange={setList}>
          <SheetHeader
            title="Friday set"
            description={`${FRIDAY_SET.length} songs · tap one to play it`}
          />
          <SheetBody>
            <List>
              {FRIDAY_SET.map((item, i) => (
                <ListRow
                  key={item.preset}
                  title={`${i + 1} · ${item.preset}`}
                  caption={[
                    item.version !== 'Default' && `${item.version} version`,
                    item.song &&
                      SONGS.find((s) => s.id === item.song) &&
                      parseSong(
                        SONGS.find((s) => s.id === item.song)!.source,
                        SONGS.find((s) => s.id === item.song)!.format,
                      ).title,
                    item.bpm && `${item.bpm} BPM`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  selected={i === index}
                  onClick={() => {
                    go(i);
                    setList(false);
                  }}
                  trailing={
                    i === index ? (
                      <Badge tone="live" className="border-background">
                        Playing
                      </Badge>
                    ) : i === index + 1 ? (
                      <Badge>Next</Badge>
                    ) : undefined
                  }
                />
              ))}
            </List>
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Dialog open={tuner} onOpenChange={setTuner}>
        <DialogContent size="lg" className="bg-[var(--tuner-surface)]">
          <DialogHeader
            title="Tuner"
            description="Press the switch again or tap Close to go back to playing."
            className="border-enclosure-border text-enclosure-foreground [&_p]:text-enclosure-foreground/70"
          />
          <TunerFace
            note={64}
            cents={-6}
            frequency={329.2}
            size="lg"
            muted={tunerMuted}
            onMuted={setTunerMuted}
            className="rounded-none"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
