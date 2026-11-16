import type { LibraryItem } from '@/patterns/library-list';
import type { ResourceReadings } from '@/widgets/resource-strip';

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
    caption: 'Amp · NAM A2 · 48 kHz · Jane Capture',
    kind: 'amp',
  },
  {
    id: 't2',
    title: 'JCM 800 crunch',
    caption: 'Amp · NAM · 48 kHz · Studio Pack',
    kind: 'amp',
  },
  {
    id: 't3',
    title: 'AC30 top boost',
    caption: 'Amp · NAM A2 · 48 kHz',
    kind: 'amp',
  },
  {
    id: 't4',
    title: '4×12 Greenback',
    caption: 'IR · SM57 · 2 cm',
    kind: 'cab',
  },
  { id: 't5', title: '2×12 Blue', caption: 'IR · SM57 · edge', kind: 'cab' },
  {
    id: 't6',
    title: 'Rat',
    caption: 'Pedal · NAM · 48 kHz',
    kind: 'pedal',
    badge: { text: 'New', tone: 'neutral' },
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
