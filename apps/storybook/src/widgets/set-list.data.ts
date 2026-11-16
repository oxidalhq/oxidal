import type { Choice, PresetChoice, SetListEntry } from './set-list-editor';

export const SET_PRESETS: PresetChoice[] = [
  {
    id: 'rhythm',
    name: 'Rhythm section',
    versions: ['Default', 'Friday gig', 'Small room'],
    scenes: ['Clean', 'Crunch', 'Lead', 'Ambient'],
  },
  {
    id: 'ambient',
    name: 'Ambient swell',
    versions: ['Default'],
    scenes: ['Pad', 'Swell'],
  },
  {
    id: 'lead',
    name: 'Lead boost',
    versions: ['Default', 'Rehearsal room'],
    scenes: ['Rhythm', 'Lead'],
  },
  {
    id: 'brown',
    name: 'Brown Crunch',
    versions: ['Default'],
    scenes: ['Crunch', 'Lead'],
  },
  {
    id: 'neon',
    name: 'Neon Clean',
    versions: ['Default'],
    scenes: ['Clean', 'Chorus'],
  },
  {
    id: 'cathedral',
    name: 'Cold Cathedral',
    versions: ['Default'],
    scenes: ['Verse', 'Big'],
  },
];

export const SET_TRACKS: Choice[] = [
  { id: 'iron', label: 'Iron Pulse · 118 BPM' },
  { id: 'slow', label: 'Slow Burn · rehearsal mix' },
  { id: 'glass', label: 'Glass Room · 124 BPM' },
];

export const SET_SHEETS: Choice[] = [
  { id: 'harbour', label: 'Harbour Lights' },
  { id: 'night', label: 'Night Drive' },
  { id: 'glass', label: 'Glass Room' },
];

export const FRIDAY_ENTRIES: SetListEntry[] = [
  {
    key: 'a',
    preset: 'rhythm',
    version: 'Friday gig',
    scene: 'Clean',
    track: 'iron',
    sheet: 'harbour',
  },
  {
    key: 'b',
    preset: 'ambient',
    version: 'Default',
    scene: 'Pad',
    track: 'slow',
    sheet: 'night',
  },
  { key: 'c', preset: 'lead', version: 'Default', scene: 'Rhythm' },
  {
    key: 'd',
    preset: 'brown',
    version: 'Default',
    scene: 'Crunch',
    track: 'glass',
    sheet: 'glass',
  },
];
