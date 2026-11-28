import { useState } from 'react';

import type { GlyphKey } from '../lib/block-glyphs';

/**
 * Example song, sections and rig links for the song workspace samples.
 * Fixed data: nothing is saved.
 */

export type Seg = { c?: string; t: string };
export type Line = Seg[];
export type SongSection = { id: string; name: string; lines: Line[] };
/** A rig link: which preset plays in a section, and which of its scenes. */
export type RigRef = { preset: string; scene: number; linked: boolean };

const L = (...segs: [string | null, string][]): Line =>
  segs.map(([c, t]) => (c ? { c, t } : { t }));

export const SONG = {
  title: 'Slow Burn',
  artist: 'Example song',
  key: 'Am',
  bpm: 112,
  sections: [
    {
      id: 'intro',
      name: 'Intro',
      lines: [L(['Am', '    '], ['F', '    '], ['C', '    '], ['G', ''])],
    },
    {
      id: 'verse1',
      name: 'Verse 1',
      lines: [
        L(
          ['Am', 'Harbour lights are '],
          ['F', 'fading in the '],
          ['C', 'rain'],
        ),
        L(['G', 'Every word you '], ['Am', 'left is still the same']),
      ],
    },
    {
      id: 'chorus',
      name: 'Chorus',
      lines: [
        L(['F', 'Slow burn, '], ['C', 'slow burn']),
        L(['G', 'Carry me '], ['Am', 'home again']),
      ],
    },
    {
      id: 'bridge',
      name: 'Bridge',
      lines: [
        L(
          ['Dm', 'Hold on to the '],
          ['E7', 'quiet before the '],
          ['Am', 'dawn'],
        ),
      ],
    },
    {
      id: 'solo',
      name: 'Solo',
      lines: [L(['Am', '    '], ['F', '    '], ['C', '    '], ['G', '    '])],
    },
    {
      id: 'outro',
      name: 'Outro',
      lines: [L(['F', 'Slow '], ['C', 'burn '], ['Am', '…'])],
    },
  ] satisfies SongSection[],
};

export const INITIAL_RIGS: Record<string, RigRef> = {
  intro: { preset: 'Oxidal · Clean Sparkle', scene: 0, linked: true },
  verse1: { preset: 'Oxidal · Harmonic Tremolo', scene: 1, linked: true },
  chorus: { preset: 'Oxidal · Plexi Crunch', scene: 2, linked: true },
  bridge: { preset: 'Oxidal · Ambient Wash', scene: 0, linked: true },
  solo: { preset: 'Oxidal · Plexi Crunch', scene: 2, linked: true },
  outro: { preset: 'Oxidal · Clean Sparkle', scene: 0, linked: false },
};

/** Presets you can try, each with the blocks in its chain as glyphs. */
export const TRY_PRESETS: { name: string; glyphs: GlyphKey[]; note: string }[] =
  [
    {
      name: 'Oxidal · Clean Sparkle',
      glyphs: ['comp', 'amp', 'chorus', 'reverb'],
      note: 'Bright and open',
    },
    {
      name: 'Oxidal · Harmonic Tremolo',
      glyphs: ['boost', 'amp', 'env', 'trem', 'reverb'],
      note: 'Swell into tremolo',
    },
    {
      name: 'Oxidal · Plexi Crunch',
      glyphs: ['gate', 'od', 'amp', 'delay'],
      note: 'Mid-heavy rhythm and lead',
    },
    {
      name: 'Oxidal · Ambient Wash',
      glyphs: ['amp', 'delay', 'space', 'reverb'],
      note: 'Long tails, no attack',
    },
    {
      name: 'Fender Super Reverb 1977',
      glyphs: ['amp'],
      note: 'TONE3000 · full rig',
    },
    {
      name: 'Marshall JCM 800 lead',
      glyphs: ['gate', 'amp', 'delay'],
      note: 'TONE3000 · full rig',
    },
  ];

const SHARPS = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];
const FLATS: Record<string, string> = {
  Db: 'C#',
  Eb: 'D#',
  Gb: 'F#',
  Ab: 'G#',
  Bb: 'A#',
};

/** Move a chord name up or down by semitones, keeping its ending (m, 7, sus…). */
export function transposeChord(chord: string, steps: number) {
  const m = /^([A-G][#b]?)(.*)$/.exec(chord);
  if (!m || steps === 0) return chord;
  const root = FLATS[m[1] ?? ''] ?? m[1] ?? '';
  const i = SHARPS.indexOf(root);
  if (i < 0) return chord;
  return `${SHARPS[(((i + steps) % 12) + 12) % 12]}${m[2]}`;
}

/** Read the sheet text: "# Name" starts a section, [Am] puts a chord over the words that follow. */
export function parseSheet(text: string): { name: string; lines: Line[] }[] {
  const out: { name: string; lines: Line[] }[] = [];
  for (const raw of text.split('\n')) {
    if (raw.startsWith('#')) {
      out.push({
        name: raw.replace(/^#+\s*/, '').trim() || 'Section',
        lines: [],
      });
      continue;
    }
    if (!raw.trim()) continue;
    if (out.length === 0) out.push({ name: 'Song', lines: [] });
    const segs: Line = [];
    const lead = /^[^[]*/.exec(raw)?.[0] ?? '';
    if (lead) segs.push({ t: lead });
    for (const m of raw.matchAll(/\[([^\]]+)\]([^[]*)/g))
      segs.push({ c: m[1] ?? '', t: m[2] ?? '' });
    out[out.length - 1]?.lines.push(segs);
  }
  return out;
}

/** Song state: which section is playing, each section's rig, and a trial in progress. */
export function useSong(initialActive = 1, initialTrial: string | null = null) {
  const [active, setActive] = useState(initialActive);
  const [rigs, setRigs] = useState(INITIAL_RIGS);
  const [trial, setTrial] = useState<string | null>(initialTrial);
  const [shift, setShift] = useState(0);
  const section = SONG.sections[active] ?? SONG.sections[0];
  const id = section?.id ?? 'intro';
  const saved = rigs[id] ?? INITIAL_RIGS.intro!;
  const rig: RigRef = trial ? { ...saved, preset: trial } : saved;
  return {
    active,
    select: (i: number) => {
      setActive(i);
      setTrial(null);
    },
    section: section!,
    rigs,
    rig,
    saved,
    trial,
    tryPreset: (name: string | null) => setTrial(name),
    keep: (all: boolean) => {
      if (!trial) return;
      setRigs((r) =>
        Object.fromEntries(
          Object.entries(r).map(([k, v]) =>
            k === id || (all && v.preset === saved.preset)
              ? [k, { ...v, preset: trial }]
              : [k, v],
          ),
        ),
      );
      setTrial(null);
    },
    setScene: (scene: number) =>
      setRigs((r) => ({ ...r, [id]: { ...saved, scene } })),
    copyForSong: () =>
      setRigs((r) => ({ ...r, [id]: { ...saved, linked: false } })),
    shift,
    setShift,
  };
}
export type SongState = ReturnType<typeof useSong>;
