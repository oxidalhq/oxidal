import type { OxidalSound } from './sound-browser';
import { SOURCES } from '../widgets/block-source.data';

/** Example sounds, from the product's own recipes (descriptions shortened). */
export const SOUNDS: OxidalSound[] = [
  {
    id: 'power-stack',
    name: 'Power Stack',
    era: '80s',
    genres: ['Hard rock', 'Modern metal'],
    engine: 'hybrid',
    complexity: 'layered',
    description:
      'Saturated master-volume stack for heavy metal rhythm and lead. Tightening comes before the amp; the Lead scene adds a small lift.',
    inspiration:
      '1980s heavy metal: a saturated master-volume stack, tightened before the amp and boosted for solos.',
    performance:
      'Intro cuts more low end for a thinner picked part. Rhythm is the tightened stack. Lead adds an overdrive in front with the level lift; Echo break sends the thin voice into long repeats.',
    scenes: ['Intro', 'Rhythm', 'Lead', 'Echo break'],
    blocks: [
      { label: 'Tight', kind: 'lv2', role: 'eq' },
      { label: 'Overdrive', kind: 'pedal', role: 'drive' },
      { label: 'JCM lead', kind: 'amp' },
      { label: '4×12 V30', kind: 'cab' },
      { label: 'Echo', kind: 'time', role: 'delay' },
    ],
    nam: 1,
    readiness: {
      state: 'needs',
      tones: [{ ...SOURCES.plexi, title: 'JCM 800 lead', image: undefined }],
      packs: [],
    },
  },
  {
    id: 'cold-steel',
    name: 'Cold Steel',
    era: '80s',
    genres: ['Modern metal', 'Hard rock'],
    engine: 'hybrid',
    complexity: 'layered',
    description:
      'Fast, tight, thick lead voice for thrash rhythm; palm-muted riffs stay clear because the low end is pulled back before the amp.',
    inspiration:
      '1980s thrash: a fast, thick, compressed lead amp with the low end pulled back so palm mutes stay clear.',
    performance:
      'Intro is the amp without the boost. Rhythm is the tightest boosted voice for fast riffs. Lead lets more low end through with the level lift; Break puts the unboosted voice in a large room.',
    scenes: ['Intro', 'Rhythm', 'Lead', 'Break'],
    blocks: [
      { label: 'Tight', kind: 'lv2', role: 'eq' },
      { label: 'Boost', kind: 'pedal', role: 'drive' },
      { label: 'Lead stack', kind: 'amp' },
      { label: '4×12 V30', kind: 'cab' },
      { label: 'Room', kind: 'time', role: 'reverb' },
    ],
    nam: 1,
    readiness: { state: 'ready' },
  },
  {
    id: 'studio-clean',
    name: 'Studio Clean',
    genres: ['Clean', 'Pop'],
    engine: 'hybrid',
    complexity: 'layered',
    description:
      'A glassy clean with compression, a chorus, an echo and a swell pad on a plate-style hall.',
    inspiration:
      'Polished studio cleans from the late 1970s to the 1990s: compressed, wide and tidy under a vocal.',
    performance:
      'Clean is the bed. Chorus thickens chords, Lead lifts a single-note line with a little echo, Ambient opens the hall. Swell turns each note into a pad.',
    scenes: ['Clean', 'Chorus', 'Lead', 'Ambient', 'Swell'],
    blocks: [
      { label: 'Compressor', kind: 'lv2', role: 'comp' },
      { label: 'Twin clean', kind: 'amp' },
      { label: '2×12 Blue', kind: 'cab' },
      { label: 'Motion', kind: 'mod', role: 'chorus' },
      { label: 'Echo', kind: 'time', role: 'delay' },
      { label: 'Swell', kind: 'mod', role: 'volume swell' },
      { label: 'Bloom', kind: 'time', role: 'reverb' },
    ],
    nam: 1,
    readiness: { state: 'ready' },
  },
  {
    id: 'arena-chime',
    name: 'Arena Chime',
    genres: ['Edge of breakup', 'Pop'],
    engine: 'hybrid',
    complexity: 'complex',
    description:
      'A jangling edge-of-breakup amp with four parallel paths: dotted echo, shimmer, swell and a frozen tail.',
    inspiration:
      'Big-room pop and rock guitar of the 1980s: chiming rhythm parts under dotted echoes and a wide hall.',
    performance:
      'Chime is the open rhythm. Dotted adds the rhythmic echo, Lead pushes the amp forward, Shimmer lifts an octave into the hall. Swell fades each chord in; Freeze holds the chord that is ringing.',
    scenes: ['Chime', 'Dotted', 'Lead', 'Shimmer', 'Swell', 'Freeze'],
    blocks: [
      { label: 'AC30 chime', kind: 'amp' },
      { label: '2×12 Blue', kind: 'cab' },
      { label: 'Dotted echo', kind: 'time', role: 'delay' },
      { label: 'Shimmer', kind: 'time', role: 'reverb' },
      { label: 'Swell', kind: 'mod', role: 'volume swell' },
      { label: 'Hold', kind: 'time', role: 'freeze' },
      { label: 'Hall', kind: 'time', role: 'reverb' },
    ],
    nam: 1,
    readiness: {
      state: 'needs',
      tones: [],
      packs: ['Dragonfly Reverb'],
    },
  },
  {
    id: 'slow-weather',
    name: 'Slow Weather',
    genres: ['Ambient', 'Post-rock'],
    engine: 'lv2',
    complexity: 'complex',
    description:
      'A slow pad that blooms under sustained chords; the Freeze scene holds the chord you are playing under what you play next.',
    inspiration:
      'Slow, swelling guitar beds from 1990s ambient and post-rock records: no pick attack, long chords, a deep hall.',
    performance:
      'Bed is the plain guitar into the hall. Swell fades each chord in over about a second and a half. Lead adds a gentle lift for melodies. Wash slows the swell and pulls the dry guitar back.',
    scenes: ['Bed', 'Swell', 'Lead', 'Wash', 'Freeze'],
    blocks: [
      { label: 'Swell', kind: 'mod', role: 'volume swell' },
      { label: 'Chorus', kind: 'mod', role: 'chorus' },
      { label: 'Hold', kind: 'time', role: 'freeze' },
      { label: 'Hall', kind: 'time', role: 'reverb' },
    ],
    nam: 0,
    readiness: { state: 'ready' },
  },
  {
    id: 'glass-atrium',
    name: 'Glass Atrium',
    genres: ['Ambient', 'Post-rock'],
    engine: 'lv2',
    complexity: 'complex',
    description:
      'A high shimmer over a clear guitar: an octave-up voice into a shimmering reverb, a cathedral wash, an octave-down choir and a frozen chord.',
    inspiration:
      'Bright, spacious cathedral textures from 2000s post-rock: simple chords, a high halo and room for notes to ring.',
    performance:
      'Clean keeps the direct guitar. Halo adds the octave shimmer. Lead lifts the direct sound for melodies. Cathedral opens a long wash; Octave down adds a dark choir.',
    scenes: ['Clean', 'Halo', 'Lead', 'Cathedral', 'Octave down'],
    blocks: [
      { label: 'Octave up', kind: 'lv2', role: 'pitch' },
      { label: 'Octave down', kind: 'lv2', role: 'octave' },
      { label: 'Shimmer', kind: 'time', role: 'reverb' },
      { label: 'Cathedral', kind: 'time', role: 'reverb' },
    ],
    nam: 0,
    readiness: { state: 'checking' },
  },
  {
    id: 'eight-rooms',
    name: 'Eight Rooms',
    genres: ['Clean', 'Ambient'],
    engine: 'lv2',
    complexity: 'layered',
    description:
      'A compressed clean guitar and a swell pad through one reverb that changes voice with the scene: room, hall, plate, cloud and a swelling tail.',
    inspiration:
      'Studio reverbs from the 1960s to the 1990s heard one after another on the same clean part.',
    performance:
      'Room is the dry, close bed. Hall opens it for chords. Lead moves to a plate held back behind the note. Cloud is a long blurred wash; Swelling plays the pad alone into a rising tail.',
    scenes: ['Room', 'Hall', 'Lead', 'Cloud', 'Swelling'],
    blocks: [
      { label: 'Compressor', kind: 'lv2', role: 'comp' },
      { label: 'Swell', kind: 'mod', role: 'volume swell' },
      { label: 'Bloom', kind: 'time', role: 'reverb' },
    ],
    nam: 0,
    readiness: { state: 'ready' },
  },
  {
    id: 'glass-ceiling',
    name: 'Glass Ceiling',
    genres: ['Ambient', 'Post-rock'],
    engine: 'lv2',
    complexity: 'layered',
    description:
      'A clean guitar under a shimmering reverb: the tail rises an octave or a fifth, or sinks an octave, and one scene holds it.',
    inspiration:
      'Ambient and worship-style guitar from the 1980s onward: slow chords under a reverb whose tail climbs like a choir.',
    performance:
      'Plate is the plain clean. Octave adds the rising tail for chords. Lead keeps the shimmer low with a quarter-note echo. Fifths stacks fifths in the tail; Depths drops it an octave.',
    scenes: ['Plate', 'Octave', 'Lead', 'Fifths', 'Depths'],
    blocks: [
      { label: 'Echo', kind: 'time', role: 'delay' },
      { label: 'Bloom', kind: 'time', role: 'reverb' },
    ],
    nam: 0,
    readiness: {
      state: 'needs',
      tones: [],
      packs: ['x42 plugins', 'Calf'],
    },
  },
];
