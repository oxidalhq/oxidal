import type { SongFormat } from '../lib/song';
import {
  GLASS_ROOM_MARKDOWN,
  HARBOUR_LIGHTS_CHORDPRO,
  LYRICS_ONLY_TEXT,
  NIGHT_DRIVE_TEXT,
} from './songs.fixtures';

export type LinkKind = 'preset' | 'rig' | 'setlist';
export type SongLink = { kind: LinkKind; id: string; label: string };
export type SongEntry = {
  id: string;
  source: string;
  format: SongFormat;
  links: SongLink[];
  size: number;
  speed: number;
};

export const KIND_LABEL: Record<LinkKind, string> = {
  preset: 'Preset',
  rig: 'Rig',
  setlist: 'Set list',
};

export const TARGETS: Record<
  LinkKind,
  { value: string; label: string; caption?: string }[]
> = {
  preset: [
    { value: 'p1', label: 'Rhythm section', caption: 'Mine' },
    { value: 'p2', label: 'Ambient swell', caption: 'Mine' },
    { value: 'p4', label: 'Brown Crunch', caption: 'Oxidal sound' },
  ],
  rig: [
    { value: 'r1', label: 'Friday rig', caption: 'Serial · 6 blocks' },
    { value: 'r2', label: 'Wet/dry rig', caption: 'Parallel · 2 lanes' },
  ],
  setlist: [
    { value: 'l1', label: '1 · Rhythm section', caption: 'Friday set' },
    { value: 'l2', label: '2 · Ambient swell', caption: 'Friday set' },
    { value: 'l3', label: '3 · Lead boost', caption: 'Friday set' },
  ],
};

export const SONGS: SongEntry[] = [
  {
    id: 'harbour',
    source: HARBOUR_LIGHTS_CHORDPRO,
    format: 'chordpro',
    links: [
      { kind: 'setlist', id: 'l1', label: '1 · Rhythm section' },
      { kind: 'preset', id: 'p1', label: 'Rhythm section' },
    ],
    size: 3,
    speed: 4,
  },
  {
    id: 'night',
    source: NIGHT_DRIVE_TEXT,
    format: 'text',
    links: [{ kind: 'setlist', id: 'l2', label: '2 · Ambient swell' }],
    size: 3,
    speed: 3,
  },
  {
    id: 'glass',
    source: GLASS_ROOM_MARKDOWN,
    format: 'markdown',
    links: [{ kind: 'rig', id: 'r1', label: 'Friday rig' }],
    size: 3,
    speed: 5,
  },
  {
    id: 'chime',
    source: LYRICS_ONLY_TEXT,
    format: 'text',
    links: [],
    size: 4,
    speed: 3,
  },
];
