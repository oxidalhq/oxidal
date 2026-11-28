import { useEffect, useState } from 'react';

import type { GlyphKey } from '../lib/block-glyphs';

/**
 * Fixed example data for the rig layout samples.
 */

export type SampleBlock = {
  id: string;
  name: string;
  caption: string;
  glyph: GlyphKey;
  led: 'amp' | 'pedal' | 'time' | 'mod';
  /** Main control shown on the tile or strip. */
  main: string;
};

export type SampleItem =
  | { kind: 'block'; block: SampleBlock }
  | { kind: 'split'; lanes: (SampleBlock | null)[] };

const b = (
  id: string,
  name: string,
  caption: string,
  glyph: GlyphKey,
  led: SampleBlock['led'],
  main: string,
): SampleBlock => ({ id, name, caption, glyph, led, main });

export const BOOST = b('boost', 'Boost', 'Pedal', 'boost', 'pedal', 'Gain');
export const AMP = b(
  'amp',
  'Fender Super Reverb 1977',
  'TONE3000 · full rig (amp and cab) · NAM',
  'amp',
  'amp',
  'Input',
);
export const SWELL = b('swell', 'Oxidal Swell', 'Time', 'env', 'time', 'Rise');
export const MOTION = b(
  'motion',
  'Oxidal Motion',
  'Time',
  'trem',
  'time',
  'Rate',
);
export const BLOOM = b(
  'bloom',
  'Oxidal Bloom',
  'Time',
  'reverb',
  'time',
  'Mix',
);

export const CHAIN: SampleItem[] = [
  { kind: 'block', block: BOOST },
  { kind: 'block', block: AMP },
  { kind: 'split', lanes: [SWELL, null] },
  { kind: 'block', block: MOTION },
  { kind: 'block', block: BLOOM },
];

export const ALL_BLOCKS: SampleBlock[] = CHAIN.flatMap((i) =>
  i.kind === 'block' ? [i.block] : i.lanes.filter((l): l is SampleBlock => !!l),
);

export const SCENES = ['Clean', 'Tremolo', 'Lead', 'Deep', 'Chop', 'Vibrato'];

export const CONTROLS = [
  { id: 'input', label: 'Input', value: 0, unit: ' dB', min: -12, max: 12 },
  { id: 'bass', label: 'Bass', value: 2, unit: ' dB', min: -12, max: 12 },
  { id: 'mid', label: 'Mid', value: -1, unit: ' dB', min: -12, max: 12 },
  { id: 'treble', label: 'Treble', value: 3, unit: ' dB', min: -12, max: 12 },
  { id: 'output', label: 'Output', value: 0, unit: ' dB', min: -12, max: 12 },
];

/** Which controls this scene changes from the preset (shown with a dot). */
export const CHANGED: Record<number, string[]> = {
  0: [],
  1: ['treble', 'output'],
  2: ['input', 'mid'],
  3: ['bass'],
  4: ['mid', 'treble'],
  5: ['treble'],
};

export const PRESETS = [
  'Oxidal · Harmonic Tremolo',
  'Oxidal · Clean Sparkle',
  'Oxidal · Plexi Crunch',
  'Oxidal · Ambient Wash',
  'Fender Super Reverb 1977',
  'Marshall JCM 800 lead',
];

export const SONGS = [
  'Slow Burn',
  'Harbour Lights',
  'Iron Pulse',
  'Low Tide',
  'Afterglow',
];

/** Rig state shared by all samples: scene, selected block, per-scene on/off. */
export function useRigSample(initialSelected: string | null = 'amp') {
  const [scene, setScene] = useState(1);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [values, setValues] = useState<Record<string, number>>(
    Object.fromEntries(CONTROLS.map((c) => [c.id, c.value])),
  );
  const key = (id: string) => `${scene}:${id}`;
  return {
    scene,
    setScene,
    selected,
    setSelected,
    block: ALL_BLOCKS.find((x) => x.id === selected) ?? null,
    isOn: (id: string) => !off[key(id)],
    toggle: (id: string) => setOff((o) => ({ ...o, [key(id)]: !o[key(id)] })),
    values,
    setValue: (id: string, v: number) => setValues((o) => ({ ...o, [id]: v })),
  };
}
export type RigSample = ReturnType<typeof useRigSample>;

/** Levels that drift a little, so the meters feel alive. */
export function useLevels() {
  const [v, setV] = useState({ inL: 0.5, inR: 0.46, outL: 0.6, outR: 0.56 });
  useEffect(() => {
    const t = setInterval(() => {
      const wob = (x: number, lo: number, hi: number) =>
        Math.min(hi, Math.max(lo, x + (Math.random() - 0.5) * 0.3));
      setV((p) => ({
        inL: wob(p.inL, 0.25, 0.8),
        inR: wob(p.inR, 0.25, 0.8),
        outL: wob(p.outL, 0.3, 0.95),
        outR: wob(p.outR, 0.3, 0.95),
      }));
    }, 140);
    return () => clearInterval(t);
  }, []);
  return v;
}
