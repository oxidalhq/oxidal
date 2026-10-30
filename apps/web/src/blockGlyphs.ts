/**
 * Oxidal block glyphs (task 3.20): objects for captured gear, signal shapes for
 * processing. 24px grid, 1.5px square-capped stroke, no fills; colour lives on the LED.
 * @see docs/interface.md
 */
import type { BlockKind } from './rigChain';

export type GlyphKey =
  | 'amp'
  | 'combo'
  | 'rig'
  | 'cab'
  | 'ir'
  | 'pedal'
  | 'rack'
  | 'boost'
  | 'od'
  | 'dist'
  | 'fuzz'
  | 'lofi'
  | 'comp'
  | 'limit'
  | 'gate'
  | 'vol'
  | 'geq'
  | 'peq'
  | 'lpf'
  | 'wah'
  | 'env'
  | 'chorus'
  | 'flanger'
  | 'phaser'
  | 'trem'
  | 'vib'
  | 'rotary'
  | 'delay'
  | 'reverb'
  | 'space'
  | 'pitch'
  | 'octave'
  | 'harm'
  | 'synth'
  | 'tuner'
  | 'looper'
  | 'split'
  | 'plugin';

/** SVG inner markup per glyph, drawn on a 24×24 viewBox. */
export const glyphs: Record<
  GlyphKey,
  { label: string; kind: BlockKind; svg: string }
> = {
  amp: {
    label: 'NAM amp head',
    kind: 'amp',
    svg: '<path d="M9 7V4.5h6V7"/><rect x="3" y="7" width="18" height="12"/><path d="M3 11.5h18"/><circle cx="7" cy="15.25" r="1"/><circle cx="10.5" cy="15.25" r="1"/><circle cx="14" cy="15.25" r="1"/><path d="M17.5 15.25h1"/>',
  },
  combo: {
    label: 'NAM combo amp',
    kind: 'amp',
    svg: '<rect x="3" y="3.5" width="18" height="17"/><path d="M3 8h18"/><circle cx="7" cy="5.75" r=".75"/><circle cx="10" cy="5.75" r=".75"/><circle cx="13" cy="5.75" r=".75"/><circle cx="12" cy="14.25" r="4"/>',
  },
  rig: {
    label: 'NAM full rig',
    kind: 'amp',
    svg: '<rect x="5" y="3" width="14" height="6"/><circle cx="8.5" cy="6" r=".75"/><circle cx="12" cy="6" r=".75"/><rect x="3" y="11" width="18" height="10"/><circle cx="12" cy="16" r="3"/><circle cx="12" cy="16" r=".75"/>',
  },
  cab: {
    label: 'Cab capture',
    kind: 'cab',
    svg: '<rect x="4" y="3" width="16" height="18"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  },
  ir: {
    label: 'Impulse response',
    kind: 'cab',
    svg: '<path d="M5 5h4M5 19h4M7 5v14"/><path d="M12 19V5h4.5a3.5 3.5 0 0 1 0 7H12M16 12l3.5 7"/>',
  },
  pedal: {
    label: 'Pedal capture',
    kind: 'pedal',
    svg: '<rect x="6" y="2.5" width="12" height="19"/><circle cx="9.5" cy="6.5" r="1.25"/><circle cx="14.5" cy="6.5" r="1.25"/><path d="M6 10.5h12"/><circle cx="12" cy="16" r="2"/>',
  },
  rack: {
    label: 'Outboard / rack',
    kind: 'amp',
    svg: '<rect x="2" y="8" width="20" height="8"/><circle cx="4.25" cy="12" r=".6"/><circle cx="9" cy="12" r="1.75"/><circle cx="14" cy="12" r="1.75"/><rect x="17.25" y="10.5" width="2.5" height="3"/>',
  },
  boost: {
    label: 'Boost',
    kind: 'pedal',
    svg: '<path d="M2 12c1-2.7 2-2.7 3 0s2 2.7 3 0c1.6-9.3 4.9-9.3 6.5 0s4.9 9.3 6.5 0"/>',
  },
  od: {
    label: 'Overdrive',
    kind: 'pedal',
    svg: '<path d="M2 12C3 8 3.5 6 5 6h2c1.5 0 2 2 3 6s1.5 6 3 6h2c1.5 0 2-2 3-6s1.5-6 3-6h1"/>',
  },
  dist: {
    label: 'Distortion',
    kind: 'pedal',
    svg: '<path d="M2 12l2-6h4l4 12h4l4-12h2"/>',
  },
  fuzz: {
    label: 'Fuzz',
    kind: 'pedal',
    svg: '<path d="M2 18V6h5v12h5V6h5v12h5"/>',
  },
  lofi: {
    label: 'Bitcrusher / lo-fi',
    kind: 'pedal',
    svg: '<path d="M2 12h2V9h2V6h2v3h2v3h2v3h2v3h2v-3h2v-3h2v-3"/>',
  },
  comp: {
    label: 'Compressor',
    kind: 'lv2',
    svg: '<path d="M4 4v16h16"/><path d="M4 20l8-8 8-3"/>',
  },
  limit: {
    label: 'Limiter',
    kind: 'lv2',
    svg: '<path d="M4 4v16h16"/><path d="M4 20l8-8h8"/>',
  },
  gate: {
    label: 'Noise gate',
    kind: 'lv2',
    svg: '<path d="M3 17h5V7h8v10h5"/>',
  },
  vol: {
    label: 'Volume / swell',
    kind: 'lv2',
    svg: '<path d="M3 18L21 6v12z"/>',
  },
  geq: {
    label: 'Graphic EQ',
    kind: 'lv2',
    svg: '<path d="M5 4v16M9.67 4v16M14.33 4v16M19 4v16"/><path d="M3.5 14h3M8.17 8h3M12.83 11h3M17.5 6h3"/>',
  },
  peq: {
    label: 'Parametric EQ',
    kind: 'lv2',
    svg: '<path d="M3 16h3c2.5 0 3-8 6-8s3.5 8 6 8h3"/>',
  },
  lpf: {
    label: 'Filter (low/high pass)',
    kind: 'lv2',
    svg: '<path d="M3 8h9c4 0 6 3 9 11"/>',
  },
  wah: {
    label: 'Wah',
    kind: 'lv2',
    svg: '<rect x="3" y="16" width="18" height="4"/><path d="M5 16l14-6.5"/><circle cx="19.75" cy="9.25" r="1"/>',
  },
  env: {
    label: 'Envelope filter',
    kind: 'lv2',
    svg: '<path d="M3 19h3c2.5 0 3-7 6-7s3.5 7 6 7h3"/><path d="M6 6h12M8 4l-2 2 2 2M16 4l2 2-2 2"/>',
  },
  chorus: {
    label: 'Chorus',
    kind: 'mod',
    svg: '<path d="M2 9.5c2-4.5 4-4.5 6 0s4 4.5 6 0 4-4.5 6 0"/><path d="M4 14.5c2-4.5 4-4.5 6 0s4 4.5 6 0 4-4.5 6 0"/>',
  },
  flanger: {
    label: 'Flanger',
    kind: 'mod',
    svg: '<path d="M2 9c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/><path d="M3 16v4M6 16v4M9 16v4M12 16v4M15 16v4M18 16v4M21 16v4"/>',
  },
  phaser: {
    label: 'Phaser',
    kind: 'mod',
    svg: '<path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/><path stroke-dasharray="1.5 2" d="M4 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/>',
  },
  trem: {
    label: 'Tremolo',
    kind: 'mod',
    svg: '<path d="M2 12c0.833 -2 1.67 -2 2.5 0c0.833 4.67 1.67 4.67 2.5 0c0.833 -8 1.67 -8 2.5 0c0.833 9.33 1.67 9.33 2.5 0c0.833 -8 1.67 -8 2.5 0c0.833 4.67 1.67 4.67 2.5 0c0.833 -2 1.67 -2 2.5 0c0.833 4.67 1.67 4.67 2.5 0"/>',
  },
  vib: {
    label: 'Vibrato',
    kind: 'mod',
    svg: '<path d="M2 12c0.5 -5.3 1 -5.3 1.5 0c0.5 5.3 1 5.3 1.5 0c1 -5.3 2 -5.3 3 0c1 5.3 2 5.3 3 0c1.5 -5.3 3 -5.3 4.5 0c1.5 5.3 3 5.3 4.5 0"/>',
  },
  rotary: {
    label: 'Rotary',
    kind: 'mod',
    svg: '<circle cx="12" cy="12" r="1.5"/><path d="M5 12a7 7 0 0 1 7-7M12 5l-2.25-2.25M12 5l-2.25 2.25"/><path d="M19 12a7 7 0 0 1-7 7M12 19l2.25-2.25M12 19l2.25 2.25"/>',
  },
  delay: {
    label: 'Delay',
    kind: 'time',
    svg: '<circle cx="6" cy="12" r="3.5"/><circle cx="13.25" cy="12" r="2.5"/><circle cx="19" cy="12" r="1.5"/>',
  },
  reverb: {
    label: 'Reverb',
    kind: 'time',
    svg: '<polyline points="2 12 3.5 5 5 19 6.5 7 8 17 9.5 8.5 11 15.5 12.5 9.5 14 14.5 15.5 10.5 17 13.5 18.5 11.25 20 12.75 21.5 12 22 12"/>',
  },
  space: {
    label: 'Space / ambience',
    kind: 'time',
    svg: '<circle cx="5" cy="12" r="1.5"/><path d="M9 8.5a5 5 0 0 1 0 7"/><path d="M12.5 5.5a9 9 0 0 1 0 13"/><path d="M16 2.5a13 13 0 0 1 0 19"/>',
  },
  pitch: {
    label: 'Pitch shift',
    kind: 'mod',
    svg: '<path d="M7.5 20V5M4 8.5L7.5 5 11 8.5"/><path d="M16.5 4v15M13 15.5l3.5 3.5 3.5-3.5"/>',
  },
  octave: {
    label: 'Octave',
    kind: 'mod',
    svg: '<ellipse cx="6.5" cy="18" rx="2.5" ry="1.75"/><ellipse cx="17.5" cy="6" rx="2.5" ry="1.75"/><path d="M8.75 16.25l6.5-8.5"/>',
  },
  harm: {
    label: 'Harmonizer',
    kind: 'mod',
    svg: '<ellipse cx="9" cy="18.25" rx="2.25" ry="1.6"/><ellipse cx="9" cy="13.25" rx="2.25" ry="1.6"/><ellipse cx="9" cy="8.25" rx="2.25" ry="1.6"/><path d="M11.25 18.25V3"/>',
  },
  synth: {
    label: 'Synth',
    kind: 'mod',
    svg: '<path d="M2 18L9 6v12l7-12v12l6-10"/>',
  },
  tuner: {
    label: 'Tuner',
    kind: 'other',
    svg: '<path d="M4 17a8 8 0 0 1 16 0"/><path d="M12 17l3-7.5"/><path d="M12 7.5V9"/>',
  },
  looper: {
    label: 'Looper',
    kind: 'other',
    svg: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17.5 3.5v4h-4"/>',
  },
  split: {
    label: 'Split / mix',
    kind: 'other',
    svg: '<path d="M3 12h6M9 12l11-7M9 12l11 7"/>',
  },
  plugin: {
    label: 'Other LV2 plugin',
    kind: 'other',
    svg: '<path d="M2 12h6M16 12h6"/><rect x="8" y="7" width="8" height="10"/>',
  },
};

const gearGlyphs: Record<string, GlyphKey> = {
  amp: 'amp',
  combo: 'combo',
  'amp-cab': 'rig',
  'full-rig': 'rig',
  cab: 'cab',
  ir: 'ir',
  pedal: 'pedal',
  outboard: 'rack',
  space: 'space',
  experimental: 'plugin',
};

// Effect names are the only class signal LV2 hosting reports; first match wins.
const nameGlyphs: [RegExp, GlyphKey][] = [
  [/\btuner\b/, 'tuner'],
  [/loop(er)?\b/, 'looper'],
  [/\bwah\b/, 'wah'],
  [/envelope|auto.?wah|\benv\b/, 'env'],
  [/octav|\boct\b/, 'octave'],
  [/harmon/, 'harm'],
  [/pitch|shift|whammy/, 'pitch'],
  [/synth|oscillat|generat|instrument/, 'synth'],
  [/rotary|leslie/, 'rotary'],
  [/vibrato/, 'vib'],
  [/trem/, 'trem'],
  [/phas/, 'phaser'],
  [/flang/, 'flanger'],
  [/chorus|ensemble|doubl/, 'chorus'],
  [/reverb|plate|hall|spring|room|shimmer/, 'reverb'],
  [/delay|echo/, 'delay'],
  [/ambien|space|spatial|stereo|width/, 'space'],
  [/limit/, 'limit'],
  [/compress|\bcomp\b|dyn/, 'comp'],
  [/gate/, 'gate'],
  [/volume|gain|swell|level/, 'vol'],
  [/graphic|band.?eq|\b\d+.?band/, 'geq'],
  [/\beq\b|equali[sz]/, 'peq'],
  [/filter|low.?pass|high.?pass|band.?pass|\blpf\b|\bhpf\b/, 'lpf'],
  [/fuzz/, 'fuzz'],
  [/crush|lo.?fi|decimat|bit/, 'lofi'],
  [/overdrive|\bod\b|tube.?screamer|drive/, 'od'],
  [/boost/, 'boost'],
  [/distort|saturat|clip|waveshap/, 'dist'],
  [/split|mix/, 'split'],
  [/impulse|\bir\b|cab/, 'ir'],
];

/** Glyph for a block: provider gear type first, then name hints, then a generic plugin. */
export function glyphFor(gear: string, name = ''): GlyphKey {
  // Captures keep their gear object; a captured pedal stays a stompbox whatever it is called.
  const known = gearGlyphs[gear];
  if (known) return known;
  const text = name.toLowerCase();
  for (const [pattern, key] of nameGlyphs) if (pattern.test(text)) return key;
  return 'plugin';
}
