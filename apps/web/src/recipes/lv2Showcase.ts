import {
  compressor,
  drive,
  flyHall,
  flyRoom,
  fx,
  pitch,
  silk,
  orbit,
  sub,
  voice,
  type Effect,
  type FactoryRecipe,
} from '../factoryRecipes.ts';

/**
 * LV2-only showcase presets: no captures, installed on first boot. Every
 * preset keeps scenes 1 to 4 in the fixed order (base, rhythm, lead with the
 * one deliberate +3 dB lift, ambient or special); scenes 5 and up are used
 * only where the sound earns them. Scenes are mixes of parallel voices or
 * paths that share one output chain.
 *
 * @see docs/factory-collection.md
 */

// --- Local building blocks -------------------------------------------------

/** A scene at unity loudness. */
const sc = (name: string, mix: number[], level = 1) => ({ name, mix, level });
/** The lead scene: the one deliberate level lift (+3 dB). */
const lead = (name: string, mix: number[]) => sc(name, mix, 1.41);

const dub = (delay: number, feedback: number, mix: number, tone = 0.3) =>
  fx('MDA DubDelay', {
    delay,
    feedback,
    fb_tone: tone,
    lfo_depth: 0.1,
    lfo_rate: 0.3,
    fx_mix: mix,
  });
const darc = (threshold: number, ratio = 0.5, attack = 0.02, release = 0.4) =>
  fx('x42 Compressor Stereo', {
    threshold,
    Ratio: ratio,
    attack,
    release,
  });
const lpf = (freq: number) => fx('Invada Low Pass Filter (stereo)', { freq });
const hpf = (freq: number) => fx('Invada High Pass Filter (stereo)', { freq });
const tape = (drive_ = 0.3, wow = 0.008, flutter = 0.005, hiss = 0.08) =>
  fx('GxTape', {
    drive: drive_,
    wowdepth: wow,
    flutdepth: flutter,
    hiss,
  });
const swell = (time: number, sensitivity = 60, release = 600) =>
  fx('Oxidal Swell (Stereo)', {
    threshold: -45,
    sensitivity,
    time,
    release,
    curve: 60,
    mix: 100,
  });
const hold = (attack: number, release: number, level = -6) =>
  fx('Oxidal Hold (Stereo)', {
    hold: 0,
    dry: 0,
    level,
    attack,
    release,
    focus: 80,
    width: 80,
  });
const bigHall = (decay: number, late: number, dry = 100) =>
  fx('Dragonfly Hall', {
    dry_level: dry,
    early_level: 8,
    late_level: late,
    size: 40,
    decay,
    low_cut: 120,
    high_cut: 6500,
    low_mult: 0.8,
    delay: 22,
    spin: 1.8,
    wander: 15,
  });
const springRoom = (wet = 20) =>
  fx('GxReverb-Stereo', { dry_wet: wet, roomsize: 0.4, damp: 0.35 });
const shimmer = (decay: number, wet = 1) =>
  fx('GxShimmizita', {
    DRYWET: wet,
    PSDRYWET: 0.5,
    SHIFT: 0,
    T60M: decay,
    T60DS: decay,
  });
const calfDelay = (ms: number, feedback: number, amount: number, dry = 1) =>
  fx('Calf Vintage Delay', {
    timing: 1,
    ms,
    feedback,
    amount,
    dry,
    mix_mode: 0,
    medium: 1,
  });
const calfChorus = (amount = 0.8, dry = 0.6) =>
  fx('Calf Multi Chorus', {
    min_delay: 5,
    mod_depth: 3,
    mod_rate: 0.3,
    voices: 4,
    amount,
    dry,
  });
const duck = (time: number, feedback: number, amount: number, effect = -3) =>
  fx('GxDuckDelay-Stereo', {
    TIME: time,
    FEEDBACK: feedback,
    AMOUNT: amount,
    EFFECT: effect,
  });
const wah = (range: number, freq: number, mix: number) =>
  fx('FOMP Auto-wah', { drive: 4, decay: 0.3, range, freq, mix });
const rotor = (speed: number) =>
  fx('MDA Leslie', { speed, mode: speed < 0.5 ? 0.2 : 0.8 });
const reverseEcho = (seconds: number, feedback = 0.25) =>
  fx('Reverse Delay (5s max)', {
    delay_time: seconds,
    dry_level: -70,
    wet_level: -6,
    feedback,
    xfade_samp: 2500,
  });
const tracker = (mode: number, glide: number, transpose = 0.5) =>
  fx('MDA Tracker', { mode, mix: 1, glide, transpose });
const envFilter = (freq: number, res: number, env: number) =>
  fx('MDA RezFilter', {
    freq,
    res,
    env_vcf: env,
    lfo_vcf: 0.5,
    output: 0.6,
  });
const octaves = (direct: number, o1: number, o2: number) =>
  fx('GxOC-2', { DIRECT: direct, OCTAVE1: o1, OCTAVE2: o2 });
const degrade = (quant: number, rate: number) =>
  fx('MDA Degrade', {
    headroom: 0.7,
    quant,
    rate,
    post_filt: 0.6,
    non_lin: 0.6,
  });
const detune = (semitones: number) =>
  fx('Oxidal Pitch (Stereo)', { semitones, step: 0, window: 1, input_mode: 0 });
const tremolo = (freq: number, depth: number) =>
  fx('GxTremolo', { depth, freq, dry_wet: 100 });
const saturate = (amount: number, mix = 0.6) =>
  fx('Calf Saturator', { drive: amount, blend: 5, mix });
const fuzz = (sustain: number, tone: number, volume = 0.35) =>
  fx('GxBigMuffPi', { SUSTAIN: sustain, TONE: tone, VOLUME: volume });
const grind = (amount: number, level = -8) =>
  fx('GxRat', { DRIVE: amount, LEVEL: level, TONE: 0.5 });

const dry = () => voice('Dry');
const path = (
  name: string,
  steps: Effect[],
  options: { level?: number; pan?: number } = {},
) => ({ name, steps, ...options });

// --- Presets ----------------------------------------------------------------

export const lv2ShowcaseRecipes: FactoryRecipe[] = [
  {
    id: 'L01',
    name: 'Slow Weather',
    description:
      'A slow pad that blooms under sustained chords. The swell block fades each note in; an optional Hold layer freezes a chord under the playing.',
    categories: ['Ambient', 'Swell', 'Hold'],
    genres: ['Ambient', 'Post-rock'],
    techniques: ['Swell', 'Hold', 'Parallel routing'],
    engine: 'lv2',
    complexity: 'complex',
    inspiration:
      'Slow, swelling guitar beds from 1990s ambient and post-rock records: no pick attack, long chords, a deep hall behind everything.',
    performance:
      'Bed is the plain guitar into the hall. Swell fades each chord in. Lead is the bed with a gentle lift for melodies. Wash opens the pad fully. For Freeze, play a chord, switch Hold on in the Hold block, then choose Freeze. Swell only drops the picked attack altogether.',
    before: [darc(-35, 0.5, 0.03, 1)],
    voices: [
      dry(),
      voice('Swell', swell(1400), silk()),
      voice('Held layer', hold(900, 4000)),
    ],
    after: [dub(0.5, 0.55, 0.3), bigHall(7, 55, 60)],
    scenes: [
      sc('Bed', [1, 0, 0]),
      sc('Swell', [0.7, 0.8, 0]),
      lead('Lead', [0.9, 0.3, 0]),
      sc('Wash', [0.4, 0.8, 0.5]),
      sc('Freeze', [0.4, 0.3, 1]),
      sc('Swell only', [0, 1, 0]),
    ],
  },
  {
    id: 'L02',
    name: 'Glass Atrium',
    description:
      'A high shimmer over a clear guitar. An octave-up voice feeds a shimmering reverb, with a long cathedral wash and an octave-down choir.',
    categories: ['Ambient', 'Shimmer', 'Pitch'],
    genres: ['Ambient', 'Post-rock'],
    techniques: ['Pitch', 'Shimmer'],
    engine: 'lv2',
    complexity: 'complex',
    inspiration:
      'Bright, spacious cathedral textures from 2000s post-rock: simple chords, a high halo, and room for notes to ring.',
    performance:
      'Clean keeps the direct guitar. Halo adds the octave shimmer under chords. Lead lifts the direct sound for melodies. Cathedral opens a long wash for held chords. Octave down adds a dark choir under open strings.',
    before: [darc(-30, 0.45, 0.02, 0.5)],
    voices: [
      dry(),
      voice('Halo', pitch(12), shimmer(4)),
      voice('Cathedral', shimmer(7)),
      voice('Under', pitch(-12), shimmer(5)),
    ],
    after: [flyHall(4, 20)],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Halo', [0.8, 0.55, 0, 0]),
      lead('Lead', [0.9, 0.25, 0, 0]),
      sc('Cathedral', [0.6, 0.2, 0.8, 0]),
      sc('Octave down', [0.6, 0, 0.3, 0.7]),
    ],
  },
  {
    id: 'L03',
    name: 'Reed Circuit',
    description:
      'A monophonic synth from single guitar notes: square and saw voices through a resonant filter, with an octave voice and a pad.',
    categories: ['Guitar synth', 'Synth'],
    genres: ['Synth', 'Experimental'],
    techniques: ['Guitar synth', 'Pitch tracking'],
    engine: 'lv2',
    complexity: 'complex',
    inspiration:
      'Early-1980s guitar-synth leads and sequenced pads: one note at a time, thick filter sweeps, a little pick left in the mix.',
    performance:
      'Play single notes on the neck pickup; chords will not track. Square is the hollow reed lead, Saw sweep opens the filter with your attack, Lead blends both with a lift, Pad is a slow held tone. Octave adds a second voice below. Dry guitar returns to the plain sound.',
    before: [fx('GxCompressor', { RATIO: 8, THRESHOLD: -30, ATTACK: 0.002 })],
    voices: [
      dry(),
      voice('Square', tracker(0.1, 0.6), envFilter(0.5, 0.45, 0.6)),
      voice(
        'Saw',
        tracker(0.4, 0.7),
        fx('MDA RezFilter', {
          freq: 0.35,
          res: 0.7,
          env_vcf: 0.8,
          lfo_vcf: 0.8,
          lfo_rate: 0.3,
          output: 0.6,
        }),
      ),
      voice('Pad', tracker(0.5, 0.95), envFilter(0.55, 0.3, 0.2)),
      voice('Octave', tracker(0.1, 0.7, 0.25), envFilter(0.4, 0.4, 0.5)),
    ],
    after: [dub(0.3, 0.3, 0.22), flyHall(2.5, 14)],
    scenes: [
      sc('Square', [0.15, 0.9, 0, 0, 0]),
      sc('Saw sweep', [0.15, 0, 0.9, 0, 0]),
      lead('Lead', [0.1, 0.5, 0.6, 0, 0]),
      sc('Pad', [0.1, 0, 0, 0.9, 0]),
      sc('Octave', [0.1, 0.5, 0, 0, 0.7]),
      sc('Dry guitar', [1, 0, 0, 0, 0]),
    ],
  },
  {
    id: 'L04',
    name: 'Low Lantern',
    description:
      'A synth bass from a guitar or bass: octave and sub layers, a growling filtered voice and a wide chorused sub.',
    categories: ['Synth bass', 'Bass', 'Synth'],
    genres: ['Synth', 'Bass'],
    techniques: ['Pitch', 'Sub synth', 'Parallel routing'],
    engine: 'lv2',
    complexity: 'complex',
    inspiration:
      'Analogue synth-bass lines from early-1980s dance and pop records, played from a guitar or bass with an octave and sub underneath.',
    performance:
      'Sub is a clean low octave with a little direct tone. Growl adds a filtered fuzz layer that opens with your picking. Lead is a brighter, louder mix for melodic lines. Wide spreads the sub across the stereo field. Dry returns to the filtered direct sound.',
    before: [
      fx('GxCompressor', { RATIO: 10, THRESHOLD: -28, ATTACK: 0.003 }),
      lpf(900),
    ],
    voices: [
      dry(),
      voice('Sub', detune(-12), sub(0.5)),
      voice(
        'Growl',
        octaves(0.2, 0.8, 0.6),
        saturate(5),
        envFilter(0.3, 0.6, 0.8),
      ),
      voice('Wide', detune(-12), calfChorus(1, 0)),
    ],
    after: [darc(-25, 0.6), hpf(35)],
    scenes: [
      sc('Sub', [0.25, 1, 0, 0]),
      sc('Growl', [0.2, 0.5, 0.9, 0]),
      lead('Lead', [0.3, 0.4, 0.5, 0]),
      sc('Wide', [0.25, 0.8, 0, 0.7]),
      sc('Dry', [1, 0, 0, 0]),
    ],
  },
  {
    id: 'L05',
    name: 'Pocket Wire',
    description:
      'Compressed funk rhythm with an envelope-filter quack, a dark wah, a phaser and a chorus, finished with a tight room and no tail.',
    categories: ['Funk', 'Envelope', 'Phaser'],
    genres: ['Funk', 'Clean'],
    techniques: ['Envelope filter', 'Phaser'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Tight, percussive 1970s funk rhythm guitar: heavy compression, muted strums and a quacking envelope filter on single-note lines.',
    performance:
      'Clean is the compressed chop. Quack adds the envelope filter for muted 16th lines. Solo pushes the filter with a louder level. Wide adds chorus for open chords. Dark wah and Phase are extra colors for fills.',
    before: [
      fx('GxCompressor', {
        RATIO: 6,
        THRESHOLD: -26,
        ATTACK: 0.005,
        RELEASE: 0.15,
      }),
    ],
    voices: [
      dry(),
      voice('Quack', wah(0.8, 0.4, 0.85)),
      voice('Dark', wah(0.6, 0.2, 0.85)),
      voice('Phase', orbit(0.4, 4)),
      voice('Wide', silk()),
    ],
    after: [flyRoom()],
    scenes: [
      sc('Clean', [1, 0, 0, 0, 0]),
      sc('Quack', [0.35, 0.85, 0, 0, 0]),
      lead('Solo', [0.4, 0.65, 0, 0, 0.3]),
      sc('Wide', [0.7, 0, 0, 0, 0.6]),
      sc('Phase', [0.6, 0, 0, 0.7, 0]),
      sc('Dark wah', [0.3, 0, 0.85, 0, 0]),
    ],
  },
  {
    id: 'L06',
    name: 'Dust Road',
    description:
      'Warm blues in a tape-echo room: a clean tone, a low-gain edge, a slapback and a long echo through a small spring-style room.',
    categories: ['Blues', 'Tape echo'],
    genres: ['Blues', 'Edge of breakup'],
    techniques: ['Tape echo'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Late-1950s and 1960s blues records: a warm tone close to breakup, a short tape slapback and a small, bright spring-style room.',
    performance:
      'Clean is the warm base with no drive. Edge adds the low-gain push for rhythm. Lead is the same drive with a lift and a long echo. Slapback is the clean tone with a short echo for single notes.',
    before: [tape(0.35, 0.01, 0.005, 0.1)],
    voices: [
      voice('Clean'),
      voice('Edge', drive()),
      voice('Slap', dub(0.12, 0.2, 1)),
      voice('Long echo', dub(0.34, 0.45, 1)),
    ],
    after: [springRoom(22)],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Edge', [0, 1, 0.12, 0]),
      lead('Lead', [0, 1, 0, 0.3]),
      sc('Slapback', [0.7, 0, 0.45, 0]),
    ],
  },
  {
    id: 'L07',
    name: 'Broken Radio',
    description:
      'A band-limited, saturated sound with tape wobble and a small room: a radio voice, a worn tape, a warped melt and a bit-crush.',
    categories: ['Lo-fi', 'Tape'],
    genres: ['Lo-fi', 'Experimental'],
    techniques: ['Tape', 'Bit-crush'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Home-recorded cassette and AM radio textures from the late 1980s: narrow bandwidth, hiss, wobble and a little distortion.',
    performance:
      'Radio is the narrow, saturated base. Tape wobbles the pitch a little for chords. Lead blends both with a lift. Melt adds slow warble and bit loss. Bit crush is the extreme setting for breaks.',
    before: [hpf(180), lpf(3500)],
    voices: [
      voice('Radio', hpf(300), saturate(4, 0.5)),
      voice('Tape', tape(0.6, 0.03, 0.02, 0.5)),
      voice('Melt', tape(0.5, 0.03, 0.03, 0.4), rotor(0.2), degrade(0.35, 0.5)),
      voice('Crush', degrade(0.15, 0.25)),
    ],
    after: [flyRoom()],
    scenes: [
      sc('Radio', [1, 0, 0, 0]),
      sc('Tape', [0, 1, 0, 0]),
      lead('Lead', [0.4, 0.7, 0, 0]),
      sc('Melt', [0, 0.3, 0.9, 0]),
      sc('Bit crush', [0, 0, 0, 1]),
    ],
  },
  {
    id: 'L08',
    name: 'Soft Ruin',
    description:
      'A dry path in parallel with reversed echoes, a frozen layer and a ring-modulated ruin, all through one hall.',
    categories: ['Experimental', 'Reverse', 'Hold'],
    genres: ['Experimental', 'Ambient'],
    techniques: ['Reverse delay', 'Hold', 'Parallel routing'],
    engine: 'lv2',
    complexity: 'complex',
    inspiration:
      'Backwards-tape and drone textures from late-1960s studio experiments and 1990s ambient records: sparse notes, long decays, and some deliberate damage.',
    performance:
      'Dry is the guitar alone. Reverse plays each note backwards under the dry sound. Lead keeps the dry sound upfront with reversed notes behind and a lift. Frozen needs Hold switched on while a chord rings. Ruin adds ring modulation and bit loss for a metallic bed.',
    topology: 'routed',
    before: [],
    voices: [],
    after: [bigHall(7, 50, 70)],
    route: [
      darc(-30, 0.5, 0.03, 0.8),
      {
        paths: [
          path('Dry', []),
          path('Reverse', [reverseEcho(1.2, 0.3)]),
          path('Frozen', [hold(600, 6000, -3)]),
          path('Ruin', [
            fx('MDA RingMod', { freq: 0.1, fine: 0.2, feedback: 0.3 }),
            degrade(0.3, 0.4),
          ]),
        ],
      },
    ],
    scenes: [
      sc('Dry', [1, 0, 0, 0]),
      sc('Reverse', [0.3, 1, 0, 0]),
      lead('Lead', [0.8, 0.6, 0, 0]),
      sc('Frozen', [0.3, 0.2, 1, 0]),
      sc('Ruin', [0.3, 0, 0, 0.9]),
    ],
  },
  {
    id: 'L09',
    name: 'Two Rooms',
    description:
      'Two stereo paths for a very wide clean: a chorus on the left, a slight detune on the right and a centered dry path under both.',
    categories: ['Clean', 'Stereo', 'Parallel routing'],
    genres: ['Clean', 'Pop'],
    techniques: ['Parallel routing', 'Stereo width'],
    engine: 'lv2',
    complexity: 'complex',
    inspiration:
      'Wide, glassy clean guitars from 1980s studio records, built from two slightly different sounds panned apart.',
    performance:
      'Mono is the centered dry path, safe for mono speakers. Wide adds Path 1 on the left and Path 2 on the right. Lead pulls the center forward with a lift. Huge opens both sides fully and lowers the center.',
    topology: 'routed',
    before: [],
    voices: [],
    after: [flyHall(4, 20)],
    route: [
      darc(-28, 0.3, 0.02, 0.4),
      {
        paths: [
          path(
            'Path 1',
            [fx('GxChorus-Stereo', { level: 0.4, depth: 0.04, freq: 0.5 })],
            {
              pan: -0.8,
            },
          ),
          path('Path 2', [detune(0.15), detune(-0.1)], { pan: 0.8 }),
          path('Center', []),
        ],
      },
    ],
    scenes: [
      sc('Mono', [0, 0, 1]),
      sc('Wide', [0.6, 0.6, 0.7]),
      lead('Lead', [0.3, 0.3, 1]),
      sc('Huge', [1, 1, 0.2]),
    ],
  },
  {
    id: 'L10',
    name: 'Offbeat',
    description:
      'Roots and dub guitar: a clipped skank, a rolling echo and a runaway feedback throw through a small spring-style room.',
    categories: ['Dub', 'Echo'],
    genres: ['Experimental', 'Funk'],
    techniques: ['Dub echo'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Late-1970s roots-reggae and dub mixing: clipped offbeat chords, a rolling tape echo and sudden feedback throws.',
    performance:
      'Skank is the dry chop with the low end rolled off. Echo adds a rolling repeat behind it. Lead is the skank with a short echo and a lift. Dub out runs the echo into feedback; play a chord, then stop and let it ring.',
    before: [fx('GxCompressor', { RATIO: 4, THRESHOLD: -24 }), hpf(200)],
    voices: [
      dry(),
      voice('Echo', dub(0.5, 0.8, 1, 0.25)),
      voice('Dub out', dub(0.5, 0.95, 1, 0.25), orbit(0.1, 6)),
    ],
    after: [darc(-20, 0.7, 0.01, 0.3), springRoom(22)],
    scenes: [
      sc('Skank', [1, 0, 0]),
      sc('Echo', [0.8, 0.5, 0]),
      lead('Lead', [0.9, 0.3, 0]),
      sc('Dub out', [0.2, 0.2, 0.9]),
    ],
  },
  {
    id: 'L11',
    name: 'Ducked Lead',
    description:
      'A drive into a ducking delay and a plate-style hall: the echoes stay quiet while you play and bloom in the gaps.',
    categories: ['Post-rock', 'Echo', 'Ducking'],
    genres: ['Post-rock', 'Progressive'],
    techniques: ['Ducking delay'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Late-1990s post-rock and progressive lead lines: a singing sustained note, repeats that stay out of the way and swell when you stop.',
    performance:
      'Rhythm is the plain guitar. Echo adds a ducked repeat that appears between phrases. Lead adds drive and a lift. Tail lengthens the feedback for the end of a section.',
    before: [],
    voices: [
      dry(),
      voice('Echo', duck(420, 0.4, 36)),
      voice('Lead', drive(), duck(420, 0.5, 40)),
      voice('Tail', duck(520, 0.75, 44)),
    ],
    after: [flyHall(3, 24)],
    scenes: [
      sc('Rhythm', [1, 0, 0, 0]),
      sc('Echo', [0, 1, 0, 0]),
      lead('Lead', [0, 0, 1, 0]),
      sc('Tail', [0, 0, 0, 1]),
    ],
  },
  {
    id: 'L12',
    name: 'Three Skies',
    description:
      'Three parallel paths under one hall: an octave shimmer, a reversed echo and a slow octave pad.',
    categories: ['Ambient', 'Parallel routing', 'Pitch'],
    genres: ['Ambient', 'Experimental'],
    techniques: ['Parallel routing', 'Pitch', 'Reverse delay', 'Hold'],
    engine: 'lv2',
    complexity: 'complex',
    inspiration:
      'Layered atmospheric guitars from 2000s post-rock and film scores: one sustained note answered by several slow, different textures.',
    performance:
      'Dry is the guitar alone. Sky adds the shimmer path. Lead keeps the dry sound upfront with a touch of shimmer and a lift. All opens every path. Pad only and Reverse only solo one path each for quiet sections.',
    topology: 'routed',
    before: [],
    voices: [],
    after: [bigHall(6, 45, 70)],
    route: [
      darc(-30, 0.5, 0.03, 0.8),
      {
        paths: [
          path('Dry', []),
          path('Shimmer', [pitch(12), shimmer(5)]),
          path('Reverse', [reverseEcho(1.5)]),
          path('Octave pad', [pitch(-12), hold(1500, 5000, -4)]),
        ],
      },
    ],
    scenes: [
      sc('Dry', [1, 0, 0, 0]),
      sc('Sky', [0.6, 0.8, 0, 0]),
      lead('Lead', [1, 0.3, 0, 0]),
      sc('All', [0.5, 0.6, 0.6, 0.6]),
      sc('Pad only', [0, 0, 0, 1]),
      sc('Reverse only', [0, 0, 1, 0]),
    ],
  },
  {
    id: 'L13',
    name: 'Chicken Scratch',
    description:
      'Clean funk with a muted-string chop, a gentle chorus and an envelope filter for single-note lines.',
    categories: ['Funk', 'Clean'],
    genres: ['Funk', 'Clean'],
    techniques: ['Envelope filter'],
    engine: 'lv2',
    complexity: 'simple',
    inspiration:
      'Clean, crisp rhythm guitars from 1970s soul and funk: short muted strums, a bright top end and an occasional quacking solo.',
    performance:
      'Clean is the compressed base. Chop is the same with the low end cut and light grit. Solo adds the envelope filter with a lift. Wide adds chorus for open strums.',
    before: [compressor()],
    voices: [
      dry(),
      voice('Chop', hpf(220), saturate(3, 0.5)),
      voice('Wide', calfChorus(0.8, 0.5)),
      voice('Wah', wah(0.6, 0.4, 0.7)),
    ],
    after: [flyRoom()],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Chop', [0, 1, 0, 0]),
      lead('Solo', [0, 0.4, 0, 0.8]),
      sc('Wide', [0.5, 0, 0.6, 0]),
    ],
  },
  {
    id: 'L14',
    name: 'Envelope Bass',
    description:
      'Funk bass with an envelope filter that follows your attack, a gritty layer and a clean octave under it.',
    categories: ['Bass', 'Funk', 'Envelope'],
    genres: ['Bass', 'Funk'],
    techniques: ['Envelope filter'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Rubbery 1970s funk bass lines with a filter that opens with every note, a thick low end and a little grit for fills.',
    performance:
      'Clean is the compressed bass. Funk adds the envelope filter for slapped lines. Solo adds filter and grit with a lift. Sub adds a clean octave below. Grit is the saturated layer for fills.',
    before: [fx('GxCompressor', { RATIO: 6, THRESHOLD: -26 }), hpf(30)],
    voices: [
      dry(),
      voice('Envelope', envFilter(0.25, 0.6, 0.9)),
      voice('Grit', saturate(6, 0.8)),
      voice('Octave', octaves(0.3, 0.6, 0)),
    ],
    after: [darc(-22, 0.5)],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Funk', [0.3, 0.9, 0, 0]),
      lead('Solo', [0.3, 0.7, 0.4, 0]),
      sc('Sub', [0.5, 0, 0, 0.8]),
      sc('Grit', [0.4, 0, 0.8, 0]),
    ],
  },
  {
    id: 'L15',
    name: 'Round Floor',
    description:
      'A warm, steady bass: light compression, soft saturation, a subtle chorus and a deep octave.',
    categories: ['Bass', 'Clean'],
    genres: ['Bass', 'Clean'],
    techniques: ['Saturation'],
    engine: 'lv2',
    complexity: 'simple',
    inspiration:
      'Round, even bass tones from 1970s and 1980s studio sessions: a compressed low end with a touch of tube-style warmth.',
    performance:
      'Clean is the compressed base. Warm adds saturation for rhythm. Solo adds saturation and chorus with a lift. Deep adds a sub octave for sustained notes.',
    before: [fx('GxCompressor', { RATIO: 4, THRESHOLD: -24 }), hpf(30)],
    voices: [
      dry(),
      voice('Warm', saturate(3, 0.7)),
      voice('Chorus', calfChorus(0.7, 0.6)),
      voice('Deep', detune(-12), sub(0.4)),
    ],
    after: [darc(-22, 0.4)],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Warm', [0, 1, 0, 0]),
      lead('Solo', [0, 0.6, 0.5, 0]),
      sc('Deep', [0.6, 0, 0, 0.7]),
    ],
  },
  {
    id: 'L16',
    name: 'Slow Burn',
    description:
      'A low-gain blues push with a tape echo: a clean base, an edge, a harder lead and a long echo for slow bars.',
    categories: ['Blues', 'Edge of breakup'],
    genres: ['Blues', 'Edge of breakup'],
    techniques: ['Tape echo'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Late-1960s blues-rock tones: a clean amp pushed into light breakup, a warm tape echo and a lot of touch sensitivity.',
    performance:
      'Clean is the warm base. Edge adds the low-gain push for rhythm. Lead has the same drive with a lift and a long echo. Slow echo is for slow bars with space between phrases.',
    before: [tape(0.4, 0.01, 0.005, 0.1)],
    voices: [
      voice('Clean'),
      voice(
        'Edge',
        fx('GxTubeScreamer', {
          fslider0_: -16,
          fslider1_: 500,
          fslider2_: 0.25,
        }),
      ),
      voice(
        'Push',
        fx('GxTubeScreamer', {
          fslider0_: -10,
          fslider1_: 500,
          fslider2_: 0.45,
        }),
      ),
      voice(
        'Echo',
        fx('GxTubeScreamer', {
          fslider0_: -16,
          fslider1_: 500,
          fslider2_: 0.25,
        }),
        dub(0.4, 0.55, 0.35),
      ),
    ],
    after: [springRoom(18)],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Edge', [0, 1, 0, 0]),
      lead('Lead', [0, 0, 1, 0]),
      sc('Slow echo', [0, 0, 0, 1]),
    ],
  },
  {
    id: 'L17',
    name: 'Porch Light',
    description:
      'A clean blues and country sound with a short slapback, a longer echo and a slow tremolo.',
    categories: ['Blues', 'Country', 'Tremolo'],
    genres: ['Blues', 'Country'],
    techniques: ['Slapback', 'Tremolo'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Clean 1950s roadhouse and early country recordings: a bright, compressed tone with a short slapback and a slow tremolo.',
    performance:
      'Clean is the compressed base. Slap adds the short slapback for rhythm. Lead uses a longer echo with a lift. Moonlight is a slow tremolo for ballads.',
    before: [compressor()],
    voices: [
      dry(),
      voice('Slap', calfDelay(110, 0.15, 0.6)),
      voice('Long', calfDelay(380, 0.35, 0.5)),
      voice('Tremolo', tremolo(4.5, 0.45)),
    ],
    after: [springRoom(18)],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Slap', [0, 1, 0, 0]),
      lead('Lead', [0, 0, 1, 0]),
      sc('Moonlight', [0, 0, 0, 1]),
    ],
  },
  {
    id: 'L18',
    name: 'Swamp Tremolo',
    description:
      'Gritty blues-rock: a clean base, a light crunch, a tremolo swamp and a fuzz lead.',
    categories: ['Blues', 'Classic rock', 'Tremolo'],
    genres: ['Blues', 'Edge of breakup', 'Classic rock'],
    techniques: ['Tremolo', 'Fuzz'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Late-1960s and early-1970s swampy blues-rock: a crunchy pushed amp, a heavy tremolo for slow numbers and a fuzz lead.',
    performance:
      'Clean is the plain base. Crunch adds the light push for rhythm. Lead is a smooth fuzz with a lift. Swamp is the crunch through a heavy tremolo.',
    before: [],
    voices: [
      dry(),
      voice('Crunch', drive()),
      voice('Swamp', drive(), tremolo(3.5, 0.7)),
      voice('Fuzz', fuzz(0.45, 0.45, 0.3)),
    ],
    after: [springRoom(16)],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Crunch', [0, 1, 0, 0]),
      lead('Lead', [0, 0, 0, 1]),
      sc('Swamp', [0, 0, 1, 0]),
    ],
  },
  {
    id: 'L19',
    name: 'Studio Glass',
    description:
      'A polished clean for pop: compression, a multi-voice chorus, a stereo double and a slow echo bloom.',
    categories: ['Clean', 'Pop', 'Chorus'],
    genres: ['Clean', 'Pop'],
    techniques: ['Chorus', 'Doubling'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Polished 1980s studio cleans: compressed strums, a lush chorus and a stereo double for width.',
    performance:
      'Clean is the compressed base. Chorus adds the lush chorus for strums. Lead uses a stereo double and a lift for melodies. Bloom adds a soft echo and a bigger hall for slow sections.',
    before: [compressor()],
    voices: [
      dry(),
      voice('Chorus', calfChorus(0.9, 0.4)),
      voice('Double', detune(0.12), detune(-0.1)),
      voice('Bloom', dub(0.45, 0.5, 1), silk()),
    ],
    after: [flyHall(2.8, 16)],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Chorus', [0.2, 0.9, 0, 0]),
      lead('Lead', [0.6, 0, 0.5, 0]),
      sc('Bloom', [0.7, 0, 0, 0.45]),
    ],
  },
  {
    id: 'L20',
    name: 'Warm Hour',
    description:
      'A soft, rounded jazz clean with a darker neck sound, a slow rotor and a gentle chorus.',
    categories: ['Jazz', 'Clean'],
    genres: ['Jazz', 'Clean'],
    techniques: ['Rotary'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Soft, rounded jazz tones from 1950s and 1960s small-group records: a darkened top end, a close room and no more effect than you need.',
    performance:
      'Warm is the rounded base. Chords adds a gentle chorus. Solo uses a darker neck tone with a lift. Cloud adds a slow rotor and chorus for ballads.',
    before: [lpf(6200)],
    voices: [
      dry(),
      voice('Dark', lpf(3200)),
      voice('Rotor', rotor(0.2)),
      voice('Silk', silk()),
    ],
    after: [flyRoom()],
    scenes: [
      sc('Warm', [1, 0, 0, 0]),
      sc('Chords', [0.6, 0, 0, 0.6]),
      lead('Solo', [0, 1, 0, 0]),
      sc('Cloud', [0.4, 0, 0.7, 0.3]),
    ],
  },
  {
    id: 'L21',
    name: 'Open Fields',
    description:
      'A bright country clean with a swelling steel-style voice, a short slapback and a light chime.',
    categories: ['Country', 'Clean', 'Swell'],
    genres: ['Country', 'Clean'],
    techniques: ['Swell', 'Slapback'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Bright, open country-pop of the 1990s: a compressed clean, a quick slapback and a swelling steel-style volume pad.',
    performance:
      'Clean is the compressed base. Strum adds a light chime. Lead uses a slapback with a lift. Steel fades each chord in, like a volume swell.',
    before: [
      fx('GxCompressor', {
        RATIO: 5,
        THRESHOLD: -24,
        ATTACK: 0.004,
        RELEASE: 0.2,
      }),
    ],
    voices: [
      dry(),
      voice('Chime', calfChorus(0.5, 0.7)),
      voice('Slap', calfDelay(90, 0.12, 0.6)),
      voice('Steel', swell(900, 55, 500), silk()),
    ],
    after: [flyRoom()],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Strum', [0.2, 0.9, 0, 0]),
      lead('Lead', [0, 0, 1, 0]),
      sc('Steel', [0.4, 0, 0, 0.9]),
    ],
  },
  {
    id: 'L22',
    name: 'Fuzz Furnace',
    description:
      'A fuzz-based rock sound with a trimmed top end: a clean base, a rhythm fuzz, a sustaining lead and a spacious special.',
    categories: ['Classic rock', 'Hard rock', 'Fuzz'],
    genres: ['Classic rock', 'Hard rock'],
    techniques: ['Fuzz'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Thick, sustaining fuzz guitars from the early 1970s: a woolly low end, a singing lead and a trimmed top end.',
    performance:
      'Clean is the plain base. Rhythm adds the fuzz for riffs. Lead has a sustaining fuzz with a lift and a short echo. Space adds fuzz, echo and hall for slow sections. For a fuller sound, put an amp and cab capture before this preset.',
    before: [],
    voices: [
      dry(),
      voice('Rhythm', fuzz(0.4, 0.5, 0.3)),
      voice('Lead', fuzz(0.65, 0.35, 0.3), dub(0.3, 0.25, 0.2)),
      voice('Space', fuzz(0.5, 0.4, 0.3), dub(0.45, 0.5, 0.35)),
    ],
    after: [lpf(5200), flyRoom()],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Rhythm', [0, 1, 0, 0]),
      lead('Lead', [0, 0, 1, 0]),
      sc('Space', [0, 0, 0, 1]),
    ],
  },
  {
    id: 'L23',
    name: 'Grind Cellar',
    description:
      'A tight distortion with a fast phaser: a clean base, a medium grind, a high-gain lead and a swirling special.',
    categories: ['Hard rock', 'Distortion'],
    genres: ['Hard rock', 'Edge of breakup'],
    techniques: ['Distortion', 'Phaser'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Hard-edged late-1970s and 1980s rock: a tight, narrow distortion, a fast phaser on a rhythm part and a cutting lead.',
    performance:
      'Clean is the plain base. Grind adds a medium distortion for riffs. Lead raises the gain with a lift. Swirl adds the phaser to the grind. Put an amp and cab capture before this preset for a fuller sound.',
    before: [],
    voices: [
      dry(),
      voice('Grind', grind(0.4), lpf(6000)),
      voice('Lead', grind(0.65), lpf(6000)),
      voice('Swirl', grind(0.4), orbit(0.4, 4), lpf(6000)),
    ],
    after: [flyRoom()],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Grind', [0, 1, 0, 0]),
      lead('Lead', [0, 0, 1, 0]),
      sc('Swirl', [0, 0, 0, 1]),
    ],
  },
  {
    id: 'L24',
    name: 'Tidal Bow',
    description:
      'A bowed-string swell: each note fades in, with an octave bow and a long tide of hall.',
    categories: ['Ambient', 'Swell', 'Post-rock'],
    genres: ['Ambient', 'Post-rock'],
    techniques: ['Swell', 'Pitch'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Slow, bowed-string-like guitar swells from 1990s ambient and post-rock: each note blooms from silence into a long hall.',
    performance:
      'Pluck keeps the normal attack. Bow fades each note in like a violin. Lead adds a plucked attack, an octave bow and a lift. Tide is all swell, no pick.',
    before: [darc(-32, 0.4, 0.03, 0.8)],
    voices: [
      dry(),
      voice('Bow', swell(2200, 60, 800), silk()),
      voice('Octave bow', detune(12), swell(2600, 60, 900)),
    ],
    after: [dub(0.5, 0.45, 0.25), bigHall(8, 45, 60)],
    scenes: [
      sc('Pluck', [1, 0, 0]),
      sc('Bow', [0.3, 0.9, 0]),
      lead('Lead', [0.6, 0.3, 0.6]),
      sc('Tide', [0, 0.6, 0.8]),
    ],
  },
  {
    id: 'L25',
    name: 'Long Division',
    description:
      'Rhythmic delays and an organ-like synth: a clean base, a dotted ducking echo, a fifth-above voice and a tracked organ.',
    categories: ['Progressive', 'Synth', 'Echo'],
    genres: ['Progressive', 'Synth'],
    techniques: ['Ducking delay', 'Pitch', 'Pitch tracking'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Interlocking, rhythmic guitar parts from 1980s progressive rock: dotted echoes against a steady pulse, and an organ-like synth for held chords.',
    performance:
      'Guitar is the plain base. Dotted adds a ducking dotted echo for interlocking parts. Fifths adds a fifth above with a lift for melodies. Organ is a tracked organ sound; play single notes.',
    before: [compressor()],
    voices: [
      dry(),
      voice('Dotted', duck(375, 0.45, 34)),
      voice('Fifths', pitch(7), duck(560, 0.5, 38)),
      voice('Organ', tracker(0.5, 0.9), rotor(0.7)),
    ],
    after: [flyHall(3.5, 20)],
    scenes: [
      sc('Guitar', [1, 0, 0, 0]),
      sc('Dotted', [0, 1, 0, 0]),
      lead('Fifths', [0.4, 0, 0.6, 0]),
      sc('Organ', [0.1, 0, 0, 0.9]),
    ],
  },
  {
    id: 'L26',
    name: 'Bell Foundry',
    description:
      'Ring-modulated bells and metal: a clean base, ringing bells, a high shard voice and a cold, harsh foundry.',
    categories: ['Experimental', 'Synth', 'Ring modulation'],
    genres: ['Experimental', 'Synth'],
    techniques: ['Ring modulation', 'Pitch'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Metallic electronic textures from late-1970s experimental records: struck-metal tones from ring modulation, with long hall tails.',
    performance:
      'Dry is the plain base. Bells adds a gentle ring-modulated chime. Lead uses a bright octave-up shard with a lift. Foundry adds ring modulation and bit loss for a cold, metallic bed.',
    before: [],
    voices: [
      dry(),
      voice(
        'Bells',
        fx('MDA RingMod', { freq: 0.15, fine: 0.2, feedback: 0.1 }),
      ),
      voice(
        'Shards',
        pitch(12),
        fx('MDA RingMod', { freq: 0.3, fine: 0.1, feedback: 0.15 }),
      ),
      voice(
        'Foundry',
        fx('MDA RingMod', { freq: 0.08, fine: 0, feedback: 0.35 }),
        degrade(0.3, 0.4),
      ),
    ],
    after: [bigHall(5, 35, 70)],
    scenes: [
      sc('Dry', [1, 0, 0, 0]),
      sc('Bells', [0.4, 0.7, 0, 0]),
      lead('Lead', [0.5, 0, 0.45, 0]),
      sc('Foundry', [0.2, 0, 0, 0.8]),
    ],
  },
  {
    id: 'L27',
    name: 'Cassette Porch',
    description:
      'A warm, worn home-recording sound: a clean base, a wobbling tape, a dusty top and a slow evening drift.',
    categories: ['Lo-fi', 'Clean', 'Tape'],
    genres: ['Lo-fi', 'Clean'],
    techniques: ['Tape'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Warm, worn bedroom recordings from the 1990s: a soft top end, a little tape wobble and a quiet, close room.',
    performance:
      'Base is the warm, soft clean. Wobble adds the tape movement for chords. Lead uses a dusty bit-loss layer with a lift. Evening adds slow rotor and echo for quiet parts.',
    before: [lpf(8000)],
    voices: [
      dry(),
      voice('Wobble', tape(0.5, 0.02, 0.012, 0.25)),
      voice('Dusty', lpf(4500), degrade(0.5, 0.55)),
      voice(
        'Evening',
        tape(0.4, 0.02, 0.01, 0.2),
        rotor(0.2),
        dub(0.4, 0.4, 0.3),
      ),
    ],
    after: [flyRoom()],
    scenes: [
      sc('Base', [1, 0, 0, 0]),
      sc('Wobble', [0.2, 0.9, 0, 0]),
      lead('Lead', [0.5, 0, 0.6, 0]),
      sc('Evening', [0, 0, 0, 1]),
    ],
  },
  {
    id: 'L28',
    name: 'Bright Stack',
    description:
      'A twelve-string-style chime for pop: a clean base, a faint octave-up layer, a stereo double and a wide chorus.',
    categories: ['Pop', 'Clean', 'Pitch'],
    genres: ['Pop', 'Clean'],
    techniques: ['Octave', 'Doubling'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Chiming, stacked acoustic-style electric guitars from 1980s pop records: octave-doubled strums and a light, wide shimmer.',
    performance:
      'Clean is the base. Chime adds a quiet octave-up layer under strummed chords. Lead uses the stereo double with a lift. Wide uses a chorus to widen the picture for choruses.',
    before: [compressor()],
    voices: [
      dry(),
      voice('Chime', pitch(12), hpf(600)),
      voice('Double', detune(0.12), detune(-0.12)),
      voice('Wide', calfChorus(0.9, 0.4)),
    ],
    after: [flyHall(2.2, 14)],
    scenes: [
      sc('Clean', [1, 0, 0, 0]),
      sc('Chime', [0.9, 0.2, 0, 0]),
      lead('Lead', [0.4, 0, 0.7, 0]),
      sc('Wide', [0.3, 0, 0, 0.9]),
    ],
  },
  {
    id: 'L29',
    name: 'Late Lounge',
    description:
      'Soft, soulful late-night chords: a tremolo, a slow rotor and a faster rotor over a rounded, compressed clean.',
    categories: ['Jazz', 'Pop', 'Tremolo'],
    genres: ['Jazz', 'Pop'],
    techniques: ['Tremolo', 'Rotary'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Soft, late-night soul and lounge chords from the 1970s: gentle tremolo, a slow rotating speaker and a lot of space.',
    performance:
      'Base is the compressed, rounded clean. Tremolo adds a gentle pulse for ballads. Lead uses the slow rotor with a lift. Spin adds the fast rotor for a climbing section.',
    before: [fx('GxCompressor', { RATIO: 3, THRESHOLD: -22 }), lpf(7000)],
    voices: [
      dry(),
      voice('Tremolo', tremolo(3.5, 0.35)),
      voice('Slow rotor', rotor(0.2)),
      voice('Fast rotor', rotor(0.8)),
    ],
    after: [flyHall(3, 16)],
    scenes: [
      sc('Base', [1, 0, 0, 0]),
      sc('Tremolo', [0, 1, 0, 0]),
      lead('Lead', [0.4, 0, 0.7, 0]),
      sc('Spin', [0.3, 0, 0, 0.8]),
    ],
  },
];
