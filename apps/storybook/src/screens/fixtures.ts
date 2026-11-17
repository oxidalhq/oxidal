import type { LibraryItem } from '../patterns/library-list';
import type { ResourceReadings } from '../widgets/resource-strip';
import { SOURCES } from '../widgets/block-source.data';

/** Realistic data for the screen stories; names from the product's showcase recipes. */
export const READINGS: ResourceReadings = {
  dsp: { p95: 0.42, peak: 0.61 },
  cpu: 37,
  ram: { used: 2300, total: 8192 },
  xruns: 0,
  clips: 0,
  temperature: 58,
};

export const PRESETS: LibraryItem[] = [
  {
    id: 'p1',
    title: 'Rhythm section',
    caption: 'Plexi 50 · 6 blocks · 4 scenes',
    badge: { text: 'Playing', tone: 'live' },
  },
  { id: 'p2', title: 'Ambient swell', caption: 'AC30 · 7 blocks · 2 scenes' },
  {
    id: 'p3',
    title: 'Lead boost',
    caption: 'JCM 800 · 5 blocks',
    badge: { text: 'Unsaved', tone: 'warning' },
  },
  { id: 'p4', title: 'Brown Crunch', caption: 'Oxidal sound · 5 blocks' },
  { id: 'p5', title: 'Neon Clean', caption: 'Oxidal sound · 6 blocks' },
  { id: 'p6', title: 'Cold Cathedral', caption: 'Oxidal sound · 7 blocks' },
];

export const SOUNDS: LibraryItem[] = [
  'Brown Crunch',
  'Arena Chorus',
  'Power Stack',
  'Cold Steel',
  'Neon Clean',
  'Glass Pop',
  'Grunge Wall',
  'Groove Hammer',
  'Pocket Chime',
  'Britpop Shimmer',
  'Low Orbit',
  'Stadium Alt',
  'Fuzz Hook',
  'Tight Eight',
  'Black Gate',
  'Cold Cathedral',
].map((title, i) => ({
  id: `s${i}`,
  title,
  caption:
    ['Rock', 'Pop', 'Metal', 'Clean', 'Alt', 'Bass'][i % 6] +
    ' · ' +
    (4 + (i % 4)) +
    ' blocks',
}));

export const TONES: LibraryItem[] = [
  {
    id: 't1',
    title: 'Plexi 50',
    caption: 'Amp · NAM A2 · 48 kHz',
    kind: 'amp',
    artwork: SOURCES.plexi.image,
    origin: SOURCES.plexi,
  },
  {
    id: 't2',
    title: 'JCM 800 crunch',
    caption: 'Amp · NAM · 48 kHz',
    kind: 'amp',
    origin: {
      ...SOURCES.plexi,
      title: 'JCM 800 crunch',
      creator: { name: 'Studio Pack', username: 'studiopack' },
      image: undefined,
      format: 'NAM',
      licence: 'TONE3000 licence',
    },
  },
  {
    id: 't3',
    title: 'AC30 top boost',
    caption: 'Amp · NAM A2 · 48 kHz',
    kind: 'amp',
    origin: { ...SOURCES.twin, title: 'AC30 top boost', author: 'You' },
  },
  {
    id: 't4',
    title: '4×12 Greenback',
    caption: 'IR · SM57 · 2 cm',
    kind: 'cab',
    origin: SOURCES.greenback,
  },
  {
    id: 't5',
    title: '2×12 Blue',
    caption: 'IR · SM57 · edge',
    kind: 'cab',
    origin: { ...SOURCES.greenback, title: '2×12 Blue' },
  },
  {
    id: 't6',
    title: 'Rat',
    caption: 'Pedal · NAM · 48 kHz',
    kind: 'pedal',
    badge: { text: 'New', tone: 'neutral' },
    origin: { ...SOURCES.ts9, title: 'Rat' },
  },
];

export const TRACKS: LibraryItem[] = [
  {
    id: 'b1',
    title: 'Iron Pulse',
    caption: '3:42 · 118 BPM · 6 stems',
    playable: true,
    badge: { text: 'Playing', tone: 'live' },
  },
  {
    id: 'b2',
    title: 'Slow Burn',
    caption: '4:10 · 92 BPM · 4 stems',
    playable: true,
    badge: { text: 'Cued', tone: 'neutral' },
  },
  { id: 'b3', title: 'Glass Room', caption: '2:58 · 124 BPM', playable: true },
  {
    id: 'b4',
    title: 'Northern Lights',
    caption: '5:21 · 76 BPM · stems splitting 42%',
    playable: false,
    badge: { text: 'Splitting', tone: 'warning' },
  },
];

export const SETLIST: LibraryItem[] = [
  {
    id: 'l1',
    title: '1 · Rhythm section',
    caption: 'Iron Pulse · 118 BPM',
    badge: { text: 'Playing', tone: 'live' },
  },
  {
    id: 'l2',
    title: '2 · Ambient swell',
    caption: 'Slow Burn · rehearsal mix',
  },
  { id: 'l3', title: '3 · Lead boost', caption: 'no track' },
  { id: 'l4', title: '4 · Brown Crunch', caption: 'Glass Room · 124 BPM' },
];

export const STEM_SONGS: LibraryItem[] = [
  {
    id: 'ss1',
    title: 'Iron Pulse',
    caption: '6 stems · 2 mixes · guitar off, vocals off',
    playable: true,
  },
  {
    id: 'ss2',
    title: 'Slow Burn',
    caption: '4 stems · 1 mix · rehearsal mix',
    playable: true,
  },
];

export const DI: LibraryItem[] = [
  {
    id: 'd1',
    title: 'Verse take 3',
    caption: 'DI · 0:48 · reamped through Rhythm section',
    playable: true,
  },
  { id: 'd2', title: 'Riff idea', caption: 'DI · 0:21', playable: true },
];

export const GUITARS = [
  {
    id: 'g1',
    name: 'Telecaster',
    caption: 'Single coils · bridge hot · −6 dB trim',
    active: true,
  },
  { id: 'g2', name: 'Les Paul', caption: 'Humbuckers · −10 dB trim' },
  { id: 'g3', name: 'P-Bass', caption: 'Bass · −8 dB trim' },
];

/** Usage for sorting and favourites, by item id. */
const USAGE: Record<string, Partial<LibraryItem>> = {
  p1: { lastUsed: 9, plays: 41, added: 3, favourite: true },
  p2: { lastUsed: 7, plays: 12, added: 5 },
  p3: { lastUsed: 8, plays: 25, added: 6, favourite: true },
  p4: { lastUsed: 2, plays: 3, added: 1 },
  p5: { lastUsed: 5, plays: 7, added: 2 },
  p6: { lastUsed: 1, plays: 1, added: 4 },
  t1: { lastUsed: 9, plays: 30, added: 2, favourite: true },
  t2: { lastUsed: 4, plays: 8, added: 1 },
  t3: { lastUsed: 6, plays: 11, added: 3 },
  t4: { lastUsed: 8, plays: 28, added: 2, favourite: true },
  t5: { lastUsed: 3, plays: 2, added: 4 },
  t6: { lastUsed: 0, plays: 0, added: 9 },
  b1: { lastUsed: 9, plays: 19, added: 2, favourite: true },
  b2: { lastUsed: 6, plays: 9, added: 3 },
  b3: { lastUsed: 2, plays: 4, added: 1 },
  b4: { lastUsed: 1, plays: 0, added: 5 },
};

export function withUsage(
  items: LibraryItem[],
  favourites?: Set<string>,
): LibraryItem[] {
  return items.map((item) => ({
    ...item,
    ...USAGE[item.id],
    ...(favourites ? { favourite: favourites.has(item.id) } : {}),
  }));
}

export const STARTING_FAVOURITES = new Set(
  Object.entries(USAGE)
    .filter(([, u]) => u.favourite)
    .map(([id]) => id),
);
