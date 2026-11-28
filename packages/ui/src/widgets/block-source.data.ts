import type { BlockSource } from './block-source';

const repo = (crate: string) =>
  `https://github.com/oxidalhq/oxidal/tree/main/crates/${crate}`;

/**
 * Example sources for stories. TONE3000 creators here are made up; the
 * device supplies real names, profile and page addresses, and the picture.
 */
export const SOURCES = {
  plexi: {
    kind: 'tone3000',
    title: 'Plexi 50',
    creator: {
      name: 'Jane Capture',
      username: 'jane.capture',
      profile: 'https://www.tone3000.com/jane.capture',
    },
    page: 'https://www.tone3000.com/tones/12345',
    image: '/examples/amp-head.svg',
    images: ['/examples/amp-head.svg', '/examples/plugin-art.svg'],
    counts: { a2: 4, standard: 2 },
    gear: 'Amp',
    format: 'NAM A2',
    models: 6,
    licence: 'CC BY 4.0',
  },
  ts9: {
    kind: 'tone3000',
    title: 'TS9 into a clean amp',
    creator: { name: 'Porch Tones', username: 'porchtones' },
    page: 'https://www.tone3000.com/tones/23456',
    gear: 'Pedal',
    format: 'NAM',
    models: 3,
    licence: 'TONE3000 licence',
  },
  greenback: {
    kind: 'file',
    title: '4×12 Greenback',
    type: 'IR',
    author: 'You',
    audio: { sampleRate: 48000, bits: 24, channels: 1, durationMs: 200 },
    fingerprint: '9f2c41ab07d3',
  },
  twin: {
    kind: 'file',
    title: 'Twin clean',
    type: 'NAM',
    author: 'Sam Rivera',
    trainer: 'NAM trainer 0.10',
    gear: 'Amp',
  },
  gate: {
    kind: 'lv2',
    title: 'Gate',
    author: 'Calf Studio Gear',
    category: 'Dynamics',
    uri: 'http://calf.sourceforge.net/plugins/Gate',
    homepage: 'https://calf-studio-gear.org/doc/Gate.html',
    pack: {
      name: 'Calf',
      version: '0.90.3',
      package: 'calf-plugins',
      website: 'https://calf-studio-gear.org',
      licence: 'LGPL-2.1',
      qualification: 'Passes the ARM64 check; Pi run pending',
    },
  },
  moment: {
    kind: 'oxidal',
    title: 'Moment',
    crate: 'oxidal-moment',
    licence: 'Apache-2.0',
    repo: 'https://github.com/oxidalhq/oxidal/tree/main/crates/oxidal-moment',
    references: [
      'Curtis Roads, “Microsound”',
      'Julius O. Smith, “Digital Audio Resampling”',
    ],
  },
  echo: {
    kind: 'oxidal',
    title: 'Echo',
    crate: 'oxidal-echo',
    licence: 'Apache-2.0',
    repo: repo('oxidal-echo'),
    references: [
      'Chowdhury, "Real-Time Physical Modelling for Analog Tape Machines"',
      'Raffel and Smith, "Practical Modeling of Bucket-Brigade Device Circuits"',
      'Holters and Parker, "A Combined Model for a Bucket Brigade Device and its Input and Output Filters"',
    ],
  },
  bloom: {
    kind: 'oxidal',
    title: 'Bloom',
    crate: 'oxidal-bloom',
    licence: 'Apache-2.0',
    repo: repo('oxidal-bloom'),
    references: [
      'Jot and Chaigne, "Digital Delay Networks for Designing Artificial Reverberators"',
      'Schlecht and Habets, "On Lossless Feedback Delay Networks"',
      'Schroeder, "Natural Sounding Artificial Reverberation"',
    ],
  },
  motion: {
    kind: 'oxidal',
    title: 'Motion',
    crate: 'oxidal-motion',
    licence: 'Apache-2.0',
    repo: repo('oxidal-motion'),
    references: [
      'Dattorro, "Effect Design, Part 2: Delay-Line Modulation and Chorus"',
      'Zölzer (ed.), DAFX: Digital Audio Effects',
    ],
  },
  hold: {
    kind: 'engine',
    title: 'Hold',
    engine: 'TONE3000 engine',
  },
} satisfies Record<string, BlockSource>;
