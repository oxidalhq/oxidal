/**
 * Oxidal's own effects in plain words: one line each, shared by Settings ›
 * Effects and About so both pages say the same thing. The device's LV2
 * catalogue adds what is installed: Mono and Stereo, the Mode list, the
 * number of controls, latency and the plugin's full description.
 * @see docs/native-effects.md
 */
import type { GlyphKey } from './block-glyphs';

export type OxidalEffect = {
  /** The id in the plugin URI, `urn:oxidal:plugin:<id>#mono`. */
  id: string;
  name: string;
  kind: string;
  summary: string;
  glyph: GlyphKey;
};

export const OXIDAL_EFFECTS: readonly OxidalEffect[] = [
  {
    id: 'bloom',
    name: 'Bloom',
    kind: 'Reverb',
    summary:
      'Eight reverbs behind one Mode, from a small room to a slow cloud.',
    glyph: 'reverb',
  },
  {
    id: 'echo',
    name: 'Echo',
    kind: 'Delay',
    summary:
      'Eight delays behind one Mode: clean, tape, bucket-brigade and more.',
    glyph: 'delay',
  },
  {
    id: 'motion',
    name: 'Motion',
    kind: 'Modulation',
    summary:
      'Chorus, flanger, phaser, vibe, rotary, tremolo, vibrato and ring.',
    glyph: 'chorus',
  },
  {
    id: 'moment',
    name: 'Moment',
    kind: 'Micro-looper',
    summary:
      'Keeps what you just played as a loop to slow, reverse, stretch or smear.',
    glyph: 'looper',
  },
  {
    id: 'sustain',
    name: 'Sustain',
    kind: 'Sustainer',
    summary: 'Holds each note at a steady level; Normal, Harmonic and Mix.',
    glyph: 'comp',
  },
  {
    id: 'hold',
    name: 'Hold',
    kind: 'Freeze',
    summary: 'Keeps what you play ringing as a drone while you play over it.',
    glyph: 'space',
  },
  {
    id: 'swell',
    name: 'Swell',
    kind: 'Auto-swell',
    summary: 'Fades each note in, like a volume pedal worked by your playing.',
    glyph: 'vol',
  },
  {
    id: 'fuzz',
    name: 'Fuzz',
    kind: 'Fuzz',
    summary: 'A compact waveshaping fuzz with Drive, Tone, Mix and Level.',
    glyph: 'fuzz',
  },
  {
    id: 'wah',
    name: 'Wah',
    kind: 'Wah',
    summary:
      'A resonant wah filter to place before drive or amp; scenes can sweep it.',
    glyph: 'wah',
  },
  {
    id: 'pitch',
    name: 'Pitch',
    kind: 'Pitch shift',
    summary:
      '±24 semitones anywhere in a preset. A port of the TONE3000 pitch engine, credited in its notice.',
    glyph: 'pitch',
  },
];

/** `urn:oxidal:plugin:bloom#stereo` → the Bloom entry. */
export function oxidalEffectFor(uri: string): OxidalEffect | undefined {
  const id = /^urn:oxidal:plugin:([a-z]+)#/.exec(uri)?.[1];
  return OXIDAL_EFFECTS.find((effect) => effect.id === id);
}

/** The few LV2 catalogue fields the Effects page reads. */
export type CatalogueEffect = {
  uri: string;
  name: string;
  category?: string | null;
  comment?: string | null;
  unsupported?: unknown;
  ports: {
    symbol: string;
    audio?: boolean;
    control?: boolean;
    input?: boolean;
    latency?: boolean;
    scale_points?: { label: string }[];
  }[];
};

/** What one effect card shows; see `EffectCard`. */
export type EffectSummary = {
  id: string;
  name: string;
  kind: string;
  summary?: string;
  glyph: GlyphKey;
  modes?: string[];
  channels?: string[];
  controls?: number;
  latency?: boolean;
  details?: string;
};

/**
 * Oxidal's own effects from the device's LV2 catalogue: one card per effect
 * with its Mono and Stereo versions together, in the order of
 * `OXIDAL_EFFECTS`. Modes come from the plugin's Mode list, controls and
 * latency from its ports, and the long text from its own description. An
 * effect the device does not report is left out; one this list does not
 * know yet still gets a card from its catalogue entry.
 */
export function oxidalEffectsFromCatalogue(
  plugins: readonly CatalogueEffect[],
): EffectSummary[] {
  const own = plugins.filter(
    (p) => p.uri.startsWith('urn:oxidal:plugin:') && !p.unsupported,
  );
  const ids = [
    ...new Set(own.map((p) => /^urn:oxidal:plugin:([a-z]+)#/.exec(p.uri)?.[1])),
  ]
    .filter((id): id is string => !!id)
    .sort((a, b) => {
      const order = (id: string) => {
        const at = OXIDAL_EFFECTS.findIndex((e) => e.id === id);
        return at < 0 ? OXIDAL_EFFECTS.length : at;
      };
      return order(a) - order(b) || a.localeCompare(b);
    });
  return ids.map((id) => {
    const versions = own.filter((p) =>
      p.uri.startsWith(`urn:oxidal:plugin:${id}#`),
    );
    const first = versions.find((p) => p.uri.endsWith('#mono')) ?? versions[0]!;
    const known = OXIDAL_EFFECTS.find((e) => e.id === id);
    const mode = first.ports.find((port) => port.symbol === 'mode');
    const channels = ['mono', 'stereo']
      .filter((c) => versions.some((p) => p.uri.endsWith(`#${c}`)))
      .map((c) => (c === 'mono' ? 'Mono' : 'Stereo'));
    return {
      id,
      name:
        known?.name ??
        first.name.replace(/^Oxidal\s+|\s*\((Mono|Stereo)\)$/g, ''),
      kind: known?.kind ?? first.category ?? 'Effect',
      summary: known?.summary,
      glyph: known?.glyph ?? 'plugin',
      modes: mode?.scale_points?.map((point) => point.label),
      channels,
      controls: first.ports.filter((port) => port.control && port.input).length,
      latency: first.ports.some((port) => port.latency),
      details: first.comment || undefined,
    };
  });
}

/**
 * Effects that are part of the TONE3000 engine, present when its editor is
 * installed. They have no LV2 entry, so their facts are fixed here.
 */
export const ENGINE_EFFECTS: readonly EffectSummary[] = [
  {
    id: 'engine-hold',
    name: 'Hold',
    kind: 'Freeze',
    summary: 'Freezes a note inside a TONE3000 block.',
    glyph: 'space',
  },
  {
    id: 'engine-swell',
    name: 'Swell',
    kind: 'Auto-swell',
    summary: 'Volume swells inside a TONE3000 block.',
    glyph: 'vol',
  },
  {
    id: 'engine-pitch',
    name: 'Pitch',
    kind: 'Pitch shift',
    summary: 'Pitch shift inside a TONE3000 block; turn it on in NAM engine.',
    glyph: 'pitch',
  },
];
