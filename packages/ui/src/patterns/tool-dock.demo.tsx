import { Faders, MusicNotes, Notebook, Waveform } from '@phosphor-icons/react';
import * as React from 'react';

import { parseSong } from '../lib/song';
import { useRemembered } from '../lib/use-remembered';
import { SheetViewer } from '../widgets/sheet-viewer';
import type { StemRole } from '../widgets/stem-strip';
import type { TransportState } from '../widgets/transport';
import { TunerFace } from '../widgets/tuner-face';
import { VenueEq } from '../widgets/venue-eq';
import { VENUE_PROFILES } from '../widgets/venue-eq.data';
import { BackingPanel, type BackingStems } from './backing-panel';
import { type DockTool, ToolDock, type ToolPlaces } from './tool-dock';

const SONG = parseSong(
  `{title: Harbour Lights}
{key: G}
{tempo: 118}

{start_of_verse}
[G]Down by the [D]harbour the [Em]lights come [C]on
[G]Boats in a [D]row and the [C]day is gone
{end_of_verse}

{start_of_chorus}
[C]Hold on, [G]hold on, [D]carry me [Em]home
[C]Hold on, [G]hold on, [D]never a[G]lone
{end_of_chorus}`,
  'chordpro',
);

const ROLES: StemRole[] = [
  'vocals',
  'drums',
  'bass',
  'guitar',
  'piano',
  'other',
];
const full = (): BackingStems =>
  Object.fromEntries(
    ROLES.map((r) => [r, { level: 0, muted: false, solo: false }]),
  );

function Backing() {
  const [state, setState] = React.useState<TransportState>('paused');
  const [position, setPosition] = React.useState(64);
  const [stems, setStems] = React.useState<BackingStems>(full);
  const [mine, setMine] = React.useState<'guitar' | 'bass' | 'none'>('none');
  return (
    <BackingPanel
      track={{
        title: 'Iron Pulse',
        caption: '118 BPM · key of G · 6 stems',
        duration: 222,
      }}
      state={state}
      position={position}
      onPlay={() => setState('playing')}
      onPause={() => setState('paused')}
      onStop={() => {
        setState('cued');
        setPosition(0);
      }}
      onSeek={setPosition}
      stems={stems}
      onStem={(role, next) => setStems((s) => ({ ...s, [role]: next }))}
      myPart={mine}
      onMyPart={(part) => {
        setMine(part);
        setStems((s) =>
          Object.fromEntries(
            ROLES.map((r) => [r, { ...s[r]!, muted: r === part }]),
          ),
        );
      }}
      next="Glass Room"
      onNext={() => {}}
    />
  );
}

function Chords() {
  const [size, setSize] = React.useState(2);
  const [speed, setSpeed] = React.useState(4);
  return (
    <SheetViewer
      song={SONG}
      size={size}
      onSize={setSize}
      speed={speed}
      onSpeed={setSpeed}
    />
  );
}

/** The tools every screen offers to keep open, with stand-in data. */
function TunerTool() {
  const [muted, setMuted] = useRemembered('oxidal.tuner.muted', true);
  return (
    <TunerFace
      note={45}
      cents={-4}
      frequency={109.7}
      muted={muted}
      onMuted={setMuted}
    />
  );
}

const TOOLS: DockTool[] = [
  {
    id: 'backing',
    title: 'Backing track',
    icon: <MusicNotes />,
    render: () => <Backing />,
  },
  {
    id: 'chords',
    title: 'Chord sheet',
    icon: <Notebook />,
    render: () => <Chords />,
  },
  {
    id: 'venue',
    title: 'Venue EQ',
    icon: <Faders />,
    render: () => <VenueEq profiles={VENUE_PROFILES} />,
  },
  {
    id: 'tuner',
    title: 'Tuner',
    icon: <Waveform />,
    render: () => <TunerTool />,
  },
];

/** Wraps a page with the tool dock and keeps the places while the story lives. */
export function ToolDockDemo({
  initial = {},
  children,
}: {
  initial?: ToolPlaces;
  children: React.ReactNode;
}) {
  const [places, setPlaces] = React.useState<ToolPlaces>(initial);
  return (
    <ToolDock tools={TOOLS} places={places} onPlaces={setPlaces}>
      {children}
    </ToolDock>
  );
}
