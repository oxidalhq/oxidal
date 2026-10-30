import type { Lv2Plugin } from './api';
import { glyphFor, type GlyphKey } from './blockGlyphs';

/**
 * Sorting installed LV2 effects for the effect chooser: what kind of effect
 * each is, and where it comes from. The LV2 class wins when a plugin declares
 * a useful one; otherwise the name hints that pick tile icons decide.
 * @see docs/interface.md
 */
export const EFFECT_TYPES = [
  'Drive',
  'Dynamics',
  'Filter & EQ',
  'Modulation',
  'Delay',
  'Reverb & space',
  'Pitch',
  'Other',
] as const;
export type EffectType = (typeof EFFECT_TYPES)[number];

// LV2 class labels (lv2core) to the glyph that draws them.
const classGlyphs: Record<string, GlyphKey> = {
  Delay: 'delay',
  Reverb: 'reverb',
  Distortion: 'dist',
  Waveshaper: 'dist',
  Dynamics: 'comp',
  Compressor: 'comp',
  Limiter: 'limit',
  Gate: 'gate',
  Expander: 'gate',
  Filter: 'lpf',
  Lowpass: 'lpf',
  Highpass: 'lpf',
  Bandpass: 'lpf',
  Allpass: 'lpf',
  Comb: 'lpf',
  Equaliser: 'peq',
  Parametric: 'peq',
  Multiband: 'geq',
  Chorus: 'chorus',
  Flanger: 'flanger',
  Phaser: 'phaser',
  Modulator: 'trem',
  'Pitch Shifter': 'pitch',
  Spatial: 'space',
  Generator: 'synth',
  Oscillator: 'synth',
  Instrument: 'synth',
};

const glyphTypes: Partial<Record<GlyphKey, EffectType>> = {
  boost: 'Drive',
  od: 'Drive',
  dist: 'Drive',
  fuzz: 'Drive',
  lofi: 'Drive',
  comp: 'Dynamics',
  limit: 'Dynamics',
  gate: 'Dynamics',
  vol: 'Dynamics',
  geq: 'Filter & EQ',
  peq: 'Filter & EQ',
  lpf: 'Filter & EQ',
  wah: 'Filter & EQ',
  env: 'Filter & EQ',
  chorus: 'Modulation',
  flanger: 'Modulation',
  phaser: 'Modulation',
  trem: 'Modulation',
  vib: 'Modulation',
  rotary: 'Modulation',
  delay: 'Delay',
  reverb: 'Reverb & space',
  space: 'Reverb & space',
  pitch: 'Pitch',
  octave: 'Pitch',
  harm: 'Pitch',
};

/** The glyph for an effect: its LV2 class when known, else its name. */
export function effectGlyph(plugin: Lv2Plugin): GlyphKey {
  const byName = glyphFor('', plugin.name);
  const byClass = plugin.category ? classGlyphs[plugin.category] : undefined;
  // A named flanger or octave says more than a generic "Filter" class.
  return byName !== 'plugin' && glyphTypes[byName]
    ? byName
    : (byClass ?? byName);
}

export function effectType(plugin: Lv2Plugin): EffectType {
  return glyphTypes[effectGlyph(plugin)] ?? 'Other';
}

// Well-known LV2 collections by URI prefix, named as players know them.
const collections: [string, string][] = [
  ['urn:oxidal:', 'Oxidal'],
  ['http://two-play.com/', 'PiPedal'],
  ['https://two-play.com/', 'PiPedal'],
  ['http://plugin.org.uk/', 'SWH'],
  ['http://calf.sourceforge.net/', 'Calf'],
  ['http://guitarix.sourceforge.net/', 'Guitarix'],
  ['http://gareus.org/', 'x42'],
  ['http://lsp-plug.in/', 'LSP'],
  ['urn:dragonfly:', 'Dragonfly'],
  ['https://github.com/michaelwillis/dragonfly', 'Dragonfly'],
  ['http://moddevices.com/', 'MOD'],
  ['https://mod.audio/', 'MOD'],
  ['urn:zamaudio:', 'Zam'],
];

/** Where an effect comes from: a known collection, its author or its site. */
export function effectSource(plugin: Lv2Plugin): string {
  const known = collections.find(([prefix]) => plugin.uri.startsWith(prefix));
  if (known) return known[1];
  if (plugin.author) return plugin.author;
  const host = /^[a-z]+:\/\/([^/]+)/i.exec(plugin.uri)?.[1];
  return host?.replace(/^www\./, '') ?? 'Other LV2';
}
