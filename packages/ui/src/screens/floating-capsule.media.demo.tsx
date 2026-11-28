import {
  ListNumbers,
  MusicNotes,
  Notebook,
  Notepad,
  Waveform,
} from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';

import { Button } from '../components/ui/button';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Progress } from '../components/ui/states';
import { Caption, Title } from '../components/ui/text';
import { cn } from '../lib/cn';
import { TempoSource } from '../patterns/tempo-source';
import { Meter } from '../widgets/meter';
import { SheetViewer } from '../widgets/sheet-viewer';
import { StemMixer } from '../widgets/stem-strip';
import { PositionBar, Transport } from '../widgets/transport';
import { type Backing, DURATION } from './floating-capsule.hooks';
import { FRIDAY_SET } from './perform.data';

/**
 * The tools C2 keeps beside the chain: the backing track's player, its
 * stems (and a split that is running), the chord sheet (to read or write),
 * notes for the song and preset, and the set list. The same tools fill the
 * docked zones on a laptop or tablet and a phone's bottom sheet, where a
 * mini player sits above the bottom tabs while a track is cued or playing.
 * Example data; nothing plays.
 */

/** Back-compatible names for the single-tab dock stories. */
export type MediaTab = 'player' | 'stems' | 'sheet';

/** The tools C2 offers to dock. */
export type DockToolId = 'player' | 'stems' | 'sheet' | 'notes' | 'setlist';

const ICONS: Record<DockToolId, ReactNode> = {
  player: <MusicNotes />,
  stems: <Waveform />,
  sheet: <Notebook />,
  notes: <Notepad />,
  setlist: <ListNumbers />,
};

/** A tool's icon, the same in tabs, strips and menus. */
export function ToolIcon({ tool }: { tool: DockToolId }) {
  return <>{ICONS[tool]}</>;
}

/** A split into stems that runs while other things play. */
export function SplitStatus({ media }: { media: Backing }) {
  if (!media.split) return null;
  return (
    <div role="status" className="grid gap-1.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate">
          Splitting {media.split.song}…{' '}
          <span className="font-mono tabular-nums">
            {media.split.progress}%
          </span>
        </span>
        <Button variant="ghost" size="xs" onClick={media.cancelSplit}>
          Cancel
        </Button>
      </div>
      <Progress value={media.split.progress} label="Split progress" />
    </div>
  );
}

/**
 * Docked beside the chain with a mouse, the player's buttons take the
 * panel's compact height (36 px), play included; touch keeps 44 px.
 */
const COMPACT =
  '[@media(pointer:fine)]:[&_[role=group]_button]:h-control [@media(pointer:fine)]:[&_[role=group]_button]:min-h-control [@media(pointer:fine)]:[&_[role=group]_button]:px-3 [@media(pointer:fine)]:[&_[data-slot=transport]_button]:w-control [@media(pointer:fine)]:[&_[data-slot=transport]_button]:px-0';

function PlayerTool({ media, wide }: { media: Backing; wide: boolean }) {
  const transport = (
    <Transport
      state={media.state}
      onPlay={() => media.setState('playing')}
      onPause={() => media.setState('paused')}
      onStop={() => {
        media.setState('cued');
        media.setPosition(0);
      }}
      loop={media.loop}
      onLoop={() => media.setLoop(!media.loop)}
    />
  );
  const out = (
    <Meter
      label="Out"
      value={media.playing ? -10 : null}
      state={media.playing ? 'live' : 'stopped'}
      size="sm"
    />
  );
  if (wide)
    // At the bottom the player reads across: name, controls and place on
    // one line; the tempo and what comes next below.
    return (
      <div className={cn('grid gap-3', COMPACT)}>
        <div className="flex items-center gap-4">
          <div className="grid w-40 min-w-0 shrink-0 gap-0.5">
            <Title size="sm" className="truncate">
              {media.title}
            </Title>
            <Caption className="truncate text-xs">{media.caption}</Caption>
          </div>
          {transport}
          <PositionBar
            position={media.position}
            duration={DURATION}
            onSeek={media.setPosition}
            className="min-w-0 flex-1"
          />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <TempoSource state={media.tempo} onSelect={media.setTempo} />
          {media.next && (
            <Caption className="text-xs">
              Set list 1 of {FRIDAY_SET.length} · Next: {media.next}
            </Caption>
          )}
        </div>
      </div>
    );
  return (
    <div className={cn('grid gap-4', COMPACT)}>
      <div className="grid gap-0.5">
        <Title size="sm">{media.title}</Title>
        <Caption>{media.caption}</Caption>
      </div>
      {transport}
      <PositionBar
        position={media.position}
        duration={DURATION}
        onSeek={media.setPosition}
      />
      <TempoSource state={media.tempo} onSelect={media.setTempo} />
      {media.next && (
        <Caption>
          Set list 1 of {FRIDAY_SET.length} · Next: {media.next}
        </Caption>
      )}
      {out}
    </div>
  );
}

function SheetTool({ media }: { media: Backing }) {
  const [mode, setMode] = useState<'read' | 'write'>('read');
  return (
    <div className="grid min-h-0 gap-3">
      <SegmentedControl
        value={mode}
        onValueChange={(v) => setMode(v as 'read' | 'write')}
        aria-label="Read or write the sheet"
        size="xs"
        className="w-fit"
      >
        <Segment value="read">Read</Segment>
        <Segment value="write">Write</Segment>
      </SegmentedControl>
      {mode === 'write' ? (
        <label className="grid gap-1">
          <span className="text-xs text-muted-foreground">
            Chords in brackets, as in [G]Down by the [D]harbour
          </span>
          <textarea
            value={media.source}
            onChange={(e) => media.setSource(e.target.value)}
            spellCheck={false}
            rows={12}
            className="min-h-40 rounded-lg border border-input bg-background p-3 font-mono text-sm leading-relaxed outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </label>
      ) : media.song ? (
        <SheetViewer
          song={media.song}
          size={media.size}
          onSize={media.setSize}
          speed={media.speed}
          onSpeed={media.setSpeed}
          linked={['Preset · Rhythm section']}
          className="min-h-0"
        />
      ) : (
        <Caption>This set-list entry has no chord sheet.</Caption>
      )}
    </div>
  );
}

function NotesTool({ media }: { media: Backing }) {
  const [about, setAbout] = useState<'song' | 'preset'>('song');
  return (
    <div className="grid gap-2">
      <SegmentedControl
        value={about}
        onValueChange={(v) => setAbout(v as 'song' | 'preset')}
        aria-label="Notes for"
        size="xs"
        className="w-fit"
      >
        <Segment value="song">This song</Segment>
        <Segment value="preset">This preset</Segment>
      </SegmentedControl>
      <textarea
        aria-label={
          about === 'song' ? 'Notes for this song' : 'Notes for this preset'
        }
        value={media.notes[about]}
        onChange={(e) =>
          media.setNotes({ ...media.notes, [about]: e.target.value })
        }
        rows={5}
        className="min-h-24 rounded-lg border border-input bg-background p-3 text-sm leading-relaxed outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      />
      <Caption className="text-xs">
        {about === 'song'
          ? 'Kept with Slow Burn in the set list.'
          : 'Kept with Rhythm section, in every set.'}
      </Caption>
    </div>
  );
}

function SetListTool() {
  const [current, setCurrent] = useState(0);
  return (
    <ol aria-label="Friday gig" className="m-0 grid list-none p-0">
      {FRIDAY_SET.map((entry, i) => (
        <li key={i}>
          <button
            type="button"
            aria-current={i === current ? 'true' : undefined}
            onClick={() => setCurrent(i)}
            className="flex min-h-control w-full items-center gap-3 rounded-lg px-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-[current=true]:bg-accent [@media(pointer:coarse)]:min-h-touch"
          >
            <span className="w-4 font-mono text-xs text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 truncate">{entry.preset}</span>
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {entry.bpm}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** One tool's contents, wherever it is docked. */
export function ToolBody({
  tool,
  media,
  wide = false,
}: {
  tool: DockToolId;
  media: Backing;
  /** In the bottom zone: laid out across rather than down. */
  wide?: boolean;
}) {
  if (tool === 'stems')
    return (
      <div className="grid gap-3">
        <SplitStatus media={media} />
        <StemMixer
          stems={media.stems}
          onChange={(role, next) =>
            media.setStems((all) => ({ ...all, [role]: next }))
          }
          // The channels share the zone's width instead of running off it.
          className={cn(
            'gap-1 px-0 [&>[data-slot=stem-strip]]:w-auto [&>[data-slot=stem-strip]]:min-w-10 [&>[data-slot=stem-strip]]:flex-1 [&>[data-slot=stem-strip]_button]:w-full [&>[data-slot=stem-strip]>div:last-child]:w-full [&>[data-slot=stem-strip]>div:last-child]:justify-self-stretch',
            wide ? 'h-40' : 'h-64',
          )}
        />
      </div>
    );
  if (tool === 'sheet') return <SheetTool media={media} />;
  if (tool === 'notes') return <NotesTool media={media} />;
  if (tool === 'setlist') return <SetListTool />;
  return <PlayerTool media={media} wide={wide} />;
}
