import {
  compressor,
  drive,
  echoAt,
  flyHall,
  flyRoom,
  fx,
  keyed,
  leadLift,
  nam,
  pitch,
  silk,
  voice,
  type Effect,
  type FactoryRecipe,
  type RecipeScene,
  type RoutedPath,
  type SceneSettings,
} from '../factoryRecipes.ts';
import type { FactoryGenre } from '../factoryMetadata.ts';

/**
 * Showcase presets for Oxidal's own reverb (Bloom), sustainer (Sustain), delay
 * (Echo) and modulation (Motion): six sounds for each effect, a service rig,
 * a rhythm-and-lead rig, one setup per genre, and the limit rig, which runs
 * all four around a full set of captures.
 *
 * Every sound keeps scenes 1 to 4 in the fixed order (base, rhythm, lead with
 * the one small level lift, special) and has at least one scene that changes
 * an effect's mode or time. Sustain sits before drive and amp blocks, Motion
 * and Echo after the amp, Bloom last. Each Oxidal effect is one block on the
 * shared chain; scenes change its settings rather than swap blocks.
 *
 * Engines: LV2-only sounds use no captures. Hybrid sounds add third-party
 * effect packs to a capture; the limit rigs are hybrid for their boost pedal. The TONE3000 tiers here use captures and only
 * Oxidal's own effects, so they need tones and nothing else. Captures are
 * named voices the player downloads with their own TONE3000 account; nothing
 * third-party ships with Oxidal. All settings are provisional until they have
 * been listened to on the unit.
 *
 * @see docs/factory-collection.md
 */

// --- Mode and choice values (docs/native-*.md) ------------------------------

const BLOOM = {
  room: 0,
  hall: 1,
  plate: 2,
  spring: 3,
  cloud: 4,
  bloom: 5,
  shimmer: 6,
  nonlinear: 7,
};
/** Shimmer interval and Nonlinear shape. */
const FIFTH_UP = 1;
const OCTAVE_DOWN = 2;
const REVERSE_SHAPE = 1;
const SWELL_SHAPE = 2;
const ECHO = {
  digital: 0,
  tape: 1,
  heads: 2,
  bucket: 3,
  reverse: 4,
  duck: 5,
  filter: 6,
  ping: 7,
};
/** Echo divisions used here. */
const DIV = { half: 4, quarter: 6, eighthDotted: 7, eighth: 9, triplet: 10 };
/** Echo head choices used here. */
const HEADS = { one: 0, oneTwo: 4, all: 14 };
const MOTION = {
  chorus: 0,
  flanger: 1,
  phaser: 2,
  vibe: 3,
  rotary: 4,
  tremolo: 5,
  harmonic: 6,
  vibrato: 7,
  ring: 8,
};
/** Sustain modes and harmonics. */
const SUSTAIN = { normal: 0, harmonic: 1, mix: 2 };
const OCTAVE_FIFTH = 1;
const TWO_OCTAVES = 2;

// --- Building blocks --------------------------------------------------------

type Controls = Record<string, number>;
/** One block of each Oxidal effect per sound, keyed so scenes can set it. */
const bloom = (controls: Controls = {}) =>
  keyed(
    'bloom',
    fx('Oxidal Bloom (Stereo)', { mode: BLOOM.hall, ...controls }),
  );
const echo = (controls: Controls = {}) =>
  keyed(
    'echo',
    fx('Oxidal Echo (Stereo)', { mode: ECHO.digital, ...controls }),
  );
const motion = (controls: Controls = {}) =>
  keyed(
    'motion',
    fx('Oxidal Motion (Stereo)', { mode: MOTION.chorus, ...controls }),
  );
const sustain = (controls: Controls = {}) =>
  keyed(
    'sustain',
    fx('Oxidal Sustain (Stereo)', {
      on: 1,
      mode: SUSTAIN.normal,
      ...controls,
    }),
  );
const swell = (time = 900) =>
  fx('Oxidal Swell (Stereo)', {
    threshold: -45,
    sensitivity: 60,
    time,
    release: 500,
    curve: 60,
    mix: 100,
  });

/** A scene at unity level: name, send into each voice, effect settings. */
const scene = (
  name: string,
  mix: number[],
  controls?: SceneSettings,
  level = 1,
): RecipeScene => ({ name, mix, level, ...(controls ? { controls } : {}) });
/** The lead scene: the one deliberate level lift. */
const lead = (name: string, mix: number[], controls?: SceneSettings) =>
  scene(name, mix, controls, leadLift);

/** The Oxidal effect each sound is built around. */
export type OxidalFeaturedEffect = 'Bloom' | 'Sustain' | 'Echo' | 'Motion';
export const oxidalEffectPlugins: Record<OxidalFeaturedEffect, string> = {
  Bloom: 'Oxidal Bloom (Stereo)',
  Sustain: 'Oxidal Sustain (Stereo)',
  Echo: 'Oxidal Echo (Stereo)',
  Motion: 'Oxidal Motion (Stereo)',
};

const bloomSounds: FactoryRecipe[] = [
  {
    id: 'OX-01',
    name: 'Eight Rooms',
    description:
      'A compressed clean guitar and a swell pad through one reverb that changes voice with the scene: room, hall, plate, cloud and a tail that swells.',
    categories: ['Clean', 'Ambient', 'Reverb'],
    genres: ['Clean', 'Ambient'],
    techniques: ['Bloom', 'Swell', 'Scene settings'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Studio reverbs from the 1960s to the 1990s heard one after another on the same clean part: a tracking room, a concert hall, a steel plate and the long washes of later rack units.',
    performance:
      'Room is the dry, close bed. Hall opens it for chords. Lead moves to a plate held back behind the note, with the level lift. Cloud is a long blurred wash under slow parts. Swelling plays the pad alone into a tail that rises after each chord.',
    before: [compressor()],
    voices: [voice('Direct'), voice('Pad', swell(1100))],
    after: [bloom({ mode: BLOOM.room, decay: 0.8, mix: 18 })],
    scenes: [
      scene('Room', [1, 0]),
      scene('Hall', [1, 0], {
        bloom: { mode: BLOOM.hall, decay: 2.4, mix: 24 },
      }),
      lead('Lead', [1, 0], {
        bloom: { mode: BLOOM.plate, decay: 1.8, predelay: 70, mix: 22 },
      }),
      scene('Cloud', [0.7, 0.5], {
        bloom: { mode: BLOOM.cloud, decay: 12, mix: 45 },
      }),
      scene('Swelling', [0, 1], {
        bloom: { mode: BLOOM.bloom, decay: 8, build: 2, mix: 50 },
      }),
    ],
  },
  {
    id: 'OX-02',
    name: 'Glass Ceiling',
    description:
      'A clean guitar under a shimmering reverb: the tail rises an octave or a fifth, or sinks an octave, and one scene holds it.',
    categories: ['Ambient', 'Post-rock', 'Reverb'],
    genres: ['Ambient', 'Post-rock'],
    techniques: ['Bloom', 'Echo', 'Swell', 'Scene settings'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Ambient and worship-style guitar from the 1980s onward: slow chords under a reverb whose tail climbs in pitch like a choir or a string pad.',
    performance:
      'Plate is the plain clean. Octave adds the rising tail for chords. Lead keeps the shimmer low and adds a quarter-note echo, with the level lift. Fifths stacks fifths in the tail. Depths drops the tail an octave under the pad. Held freezes the tail that is ringing when you choose it; play over it and leave the scene to let it go.',
    before: [compressor()],
    voices: [voice('Direct'), voice('Pad', swell(1400))],
    after: [
      echo({ time: 480, feedback: 30, mix: 0 }),
      bloom({ mode: BLOOM.plate, decay: 2, mix: 22, shimmer: 55 }),
    ],
    scenes: [
      scene('Plate', [1, 0]),
      scene('Octave', [0.9, 0.3], {
        bloom: { mode: BLOOM.shimmer, decay: 7, mix: 40 },
      }),
      lead('Lead', [1, 0], {
        bloom: { mode: BLOOM.shimmer, decay: 4, mix: 25, shimmer: 30 },
        echo: { mix: 18 },
      }),
      scene('Fifths', [0.8, 0.5], {
        bloom: { mode: BLOOM.shimmer, decay: 9, mix: 45, interval: FIFTH_UP },
      }),
      scene('Depths', [0.3, 1], {
        bloom: {
          mode: BLOOM.shimmer,
          decay: 14,
          mix: 55,
          interval: OCTAVE_DOWN,
        },
      }),
      scene('Held', [1, 0], {
        bloom: { mode: BLOOM.shimmer, decay: 9, mix: 45, freeze: 1 },
      }),
    ],
  },
  {
    id: 'OX-03',
    name: 'Tank Drip',
    description:
      'A bright clean combo into a spring tank that drips and splashes, with a slapback and a tremolo scene.',
    categories: ['Country', 'Clean', 'Reverb'],
    genres: ['Country', 'Clean'],
    techniques: ['Bloom', 'Motion', 'Scene settings'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Instrumental guitar records of the early 1960s: a clean combo, heavy strings picked hard near the bridge and a spring tank turned up until it splashes.',
    performance:
      'Dry tank is a light spring for rhythm. Deep tank turns the spring up for picked lines. Lead adds a slapback and the level lift. Tremolo brings in a steady throb. Splash is the tank nearly full up, for single hits and endings.',
    before: [compressor(), nam('blackface-clean')],
    voices: [voice('Direct'), voice('Slap', echoAt(0.11))],
    after: [
      motion({ mode: MOTION.tremolo, rate: 5.5, depth: 60, mix: 0 }),
      bloom({ mode: BLOOM.spring, decay: 2, tone: 70, mix: 20 }),
    ],
    scenes: [
      scene('Dry tank', [1, 0]),
      scene('Deep tank', [1, 0], { bloom: { decay: 3, mix: 38 } }),
      lead('Lead', [1, 0.35], { bloom: { mix: 26 } }),
      scene('Tremolo', [1, 0], { motion: { mix: 100 } }),
      scene('Splash', [1, 0.2], {
        bloom: { decay: 4.5, mix: 60, tone: 85 },
      }),
      scene('Room', [1, 0], {
        bloom: { mode: BLOOM.room, decay: 0.7, mix: 18 },
      }),
    ],
  },
  {
    id: 'OX-04',
    name: 'Gated Room',
    description:
      'A hot rock stack with a reverb that stops dead, plays backwards or rises and falls instead of fading.',
    categories: ['Hard rock', 'Pop', 'Reverb'],
    genres: ['Hard rock', 'Pop'],
    techniques: ['Bloom', 'Scene settings'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Big rock and pop production of the 1980s: a loud stack in a live room whose reverb is cut off sharply after every chord, and the reversed swells of the same years.',
    performance:
      'Tight is the stack in a small room. Gate adds a burst of reverb that stops dead, for stabs and riffs with gaps. Lead is a plate held behind the note, with a wider chorus voice and the level lift. Backwards makes each chord rise into itself. Rise and fall is the softer shape for held chords.',
    before: [drive(), nam('jcm800-v30')],
    voices: [voice('Direct'), voice('Wide', silk())],
    after: [bloom({ mode: BLOOM.room, decay: 0.6, mix: 14 })],
    scenes: [
      scene('Tight', [1, 0]),
      scene('Gate', [1, 0], {
        bloom: { mode: BLOOM.nonlinear, decay: 0.45, mix: 40 },
      }),
      lead('Lead', [0.9, 0.4], {
        bloom: { mode: BLOOM.plate, decay: 2, predelay: 80, mix: 22 },
      }),
      scene('Backwards', [1, 0], {
        bloom: {
          mode: BLOOM.nonlinear,
          shape: REVERSE_SHAPE,
          decay: 0.9,
          mix: 55,
        },
      }),
      scene('Rise and fall', [0.8, 0.5], {
        bloom: {
          mode: BLOOM.nonlinear,
          shape: SWELL_SHAPE,
          decay: 1.2,
          mix: 45,
        },
      }),
    ],
  },
  {
    id: 'OX-05',
    name: 'Slow Bloom',
    description:
      'A clean amp and a smooth overdriven amp into a reverb whose tail swells up after the note, then thickens as it fades.',
    categories: ['Ambient', 'Post-rock', 'Reverb'],
    genres: ['Ambient', 'Post-rock'],
    techniques: ['Bloom', 'Dual amp', 'Scene settings'],
    engine: 'tone3000-a2-lite',
    complexity: 'layered',
    inspiration:
      'Instrumental post-rock of the late 1990s and 2000s: sparse clean notes that grow into a wall of reverb some seconds after they are played.',
    performance:
      'Clean is the clean amp in a hall. Rhythm blends in the overdriven amp in a shorter room. Lead is the overdriven amp on a plate with the level lift. Bloom makes the tail swell in after each note. Long bloom is slower and far longer, for the build. Held freezes the tail while you play over it.',
    before: [],
    voices: [
      voice('Clean', nam('two-rock-clean')),
      voice('Overdrive', nam('dumble-ods')),
    ],
    after: [bloom({ mode: BLOOM.hall, decay: 2.5, mix: 22 })],
    scenes: [
      scene('Clean', [1, 0]),
      scene('Rhythm', [0.6, 0.7], {
        bloom: { mode: BLOOM.room, decay: 1, mix: 18 },
      }),
      lead('Lead', [0, 1], {
        bloom: { mode: BLOOM.plate, decay: 2.2, predelay: 60, mix: 24 },
      }),
      scene('Bloom', [1, 0.2], {
        bloom: { mode: BLOOM.bloom, decay: 9, build: 1.5, mix: 45 },
      }),
      scene('Long bloom', [0.8, 0.5], {
        bloom: { mode: BLOOM.bloom, decay: 25, build: 4, mix: 60 },
      }),
      scene('Held', [1, 0], {
        bloom: { mode: BLOOM.bloom, decay: 25, mix: 55, freeze: 1 },
      }),
    ],
  },
  {
    id: 'OX-06',
    name: 'Cathedral Cloud',
    description:
      'A flat, wide clean amp and a swell pad in a very large, slow reverb, from a hall to a wash that lasts a minute.',
    categories: ['Ambient', 'Clean', 'Reverb'],
    genres: ['Ambient', 'Clean'],
    techniques: ['Bloom', 'Swell', 'Scene settings'],
    engine: 'tone3000-a2-full',
    complexity: 'layered',
    inspiration:
      'Ambient guitar of the 1980s and after: a very clean solid-state amp feeding reverbs so long that chords overlap into one slow-moving texture.',
    performance:
      'Hall is the clean amp in a large hall. Cloud blurs chords into a wash. Lead is a brighter plate with the level lift. Endless plays the pad into a tail close to a minute long. Dark is the same space with the highs dying early, for low parts.',
    before: [nam('jc-clean')],
    voices: [voice('Direct'), voice('Pad', swell(1500))],
    after: [bloom({ mode: BLOOM.hall, decay: 3, size: 70, mix: 25 })],
    scenes: [
      scene('Hall', [1, 0]),
      scene('Cloud', [0.8, 0.4], {
        bloom: { mode: BLOOM.cloud, decay: 14, mix: 45 },
      }),
      lead('Lead', [1, 0], {
        bloom: { mode: BLOOM.plate, decay: 2.5, predelay: 50, mix: 24 },
      }),
      scene('Endless', [0.2, 1], {
        bloom: { mode: BLOOM.cloud, decay: 50, mix: 70 },
      }),
      scene('Dark', [1, 0.3], {
        bloom: { mode: BLOOM.cloud, decay: 10, tone: 25, mix: 40 },
      }),
    ],
  },
];

const sustainSounds: FactoryRecipe[] = [
  {
    id: 'OX-07',
    name: 'Endless Bow',
    description:
      'A clean guitar whose notes do not die away: held at pitch, turned into a harmonic, or heard with no pick attack at all.',
    categories: ['Ambient', 'Experimental', 'Sustain'],
    genres: ['Ambient', 'Experimental'],
    techniques: ['Sustain', 'Bloom', 'Swell', 'Scene settings'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Bowed and magnetically sustained guitar from the 1970s onward: single notes held for as long as the hand stays on the string, like a cello line.',
    performance:
      'Held sustains each note at its own pitch. Gentle eases the sustain off for chords. Lead lets the note turn into its octave after a moment, with the level lift. Bowed removes the picked sound, so every note swells in. Overtone holds the note an octave and a fifth up. Mute the strings to stop a note.',
    before: [sustain({ drive: 65, tone: 55 }), compressor()],
    voices: [voice('Direct'), voice('Pad', swell(1000))],
    after: [bloom({ mode: BLOOM.hall, decay: 3, mix: 25 })],
    scenes: [
      scene('Held', [1, 0]),
      scene('Gentle', [1, 0], { sustain: { drive: 25 } }),
      lead('Lead', [1, 0], {
        sustain: { mode: SUSTAIN.mix, bloom: 1500, drive: 80 },
      }),
      scene('Bowed', [0.8, 0.4], {
        sustain: { dry: 0 },
        bloom: { mode: BLOOM.cloud, decay: 9, mix: 40 },
      }),
      scene('Overtone', [1, 0], {
        sustain: { mode: SUSTAIN.harmonic, harmonic: OCTAVE_FIFTH },
      }),
    ],
  },
  {
    id: 'OX-08',
    name: 'Feedback Garden',
    description:
      'An overdrive pedal sound with controlled feedback: notes hold, then climb to an octave or two octaves, at any volume.',
    categories: ['Classic rock', 'Experimental', 'Sustain'],
    genres: ['Classic rock', 'Experimental'],
    techniques: ['Sustain', 'Echo', 'Scene settings'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Loud rock guitar of the late 1960s and 1970s, where a held note standing near the speakers turns into a singing overtone, here without the volume.',
    performance:
      'Crunch has the sustain off: the plain overdrive. Hold keeps notes ringing at pitch. Lead lets a held note climb to its octave after about two seconds, with the level lift and an octave voice. High goes to two octaves, the squeal. Echo wash adds a worn tape echo under held notes.',
    before: [sustain({ on: 0, drive: 70 }), drive()],
    voices: [voice('Direct'), voice('Octave', pitch(12))],
    after: [
      echo({ mode: ECHO.tape, time: 420, feedback: 40, age: 50, mix: 0 }),
      bloom({ mode: BLOOM.room, decay: 1, mix: 16 }),
    ],
    scenes: [
      scene('Crunch', [1, 0]),
      scene('Hold', [1, 0], { sustain: { on: 1 } }),
      lead('Lead', [1, 0.25], {
        sustain: { on: 1, mode: SUSTAIN.mix, bloom: 2200 },
      }),
      scene('High', [1, 0], {
        sustain: {
          on: 1,
          mode: SUSTAIN.mix,
          harmonic: TWO_OCTAVES,
          bloom: 1200,
        },
      }),
      scene('Echo wash', [1, 0], {
        sustain: { on: 1 },
        echo: { mix: 30 },
      }),
    ],
  },
  {
    id: 'OX-09',
    name: 'Singing Stack',
    description:
      'A boosted crunch stack with a sustainer in front: chords stay raw, and held lead notes bloom into feedback.',
    categories: ['Hard rock', 'Classic rock', 'Sustain'],
    genres: ['Hard rock', 'Classic rock'],
    techniques: ['Sustain', 'Bloom', 'Scene settings'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Arena hard rock of the 1970s and 1980s: a cranked stack, a boost pedal and lead notes held until they tip over into feedback.',
    performance:
      'Crunch has the sustain off for riffs. Rhythm holds chords a little longer. Lead blooms each held note into its octave over three seconds, with an echo and the level lift. Fifth blooms faster into an octave and a fifth, for a wilder ending. Mute to stop a note.',
    before: [sustain({ on: 0, drive: 60 }), drive(), nam('plexi-crunch')],
    voices: [voice('Direct'), voice('Echo', echoAt(0.38))],
    after: [bloom({ mode: BLOOM.plate, decay: 1.6, mix: 16 })],
    scenes: [
      scene('Crunch', [1, 0]),
      scene('Rhythm', [1, 0], { sustain: { on: 1, drive: 40 } }),
      lead('Lead', [1, 0.3], {
        sustain: { on: 1, mode: SUSTAIN.mix, bloom: 3000, drive: 80 },
      }),
      scene('Fifth', [1, 0.3], {
        sustain: {
          on: 1,
          mode: SUSTAIN.mix,
          harmonic: OCTAVE_FIFTH,
          bloom: 1200,
          drive: 85,
        },
        bloom: { mode: BLOOM.hall, decay: 3, mix: 24 },
      }),
    ],
  },
  {
    id: 'OX-10',
    name: 'Violin Lead',
    description:
      'A smooth overdriven amp with a sustainer in front, for long legato lines that hold like a bowed string.',
    categories: ['Progressive', 'Jazz', 'Sustain'],
    genres: ['Progressive', 'Jazz'],
    techniques: ['Sustain', 'Echo', 'Bloom', 'Scene settings'],
    engine: 'tone3000-a2-lite',
    complexity: 'layered',
    inspiration:
      'Fusion and progressive rock leads of the 1970s and 1980s: a smooth, mid-heavy overdrive and notes that sustain as long as the phrase needs.',
    performance:
      'Smooth holds notes at pitch. Rhythm switches the sustain off for chords. Lead pushes the sustain harder and adds an echo and the level lift. Bowed removes the pick attack, with an octave below. Overtone lets long notes turn into their octave.',
    before: [sustain({ drive: 60, tone: 50 }), nam('dumble-ods')],
    voices: [voice('Direct'), voice('Octave down', pitch(-12))],
    after: [
      echo({ mode: ECHO.digital, time: 400, feedback: 30, mix: 0 }),
      bloom({ mode: BLOOM.plate, decay: 2, mix: 18 }),
    ],
    scenes: [
      scene('Smooth', [1, 0]),
      scene('Rhythm', [0.8, 0], { sustain: { on: 0 } }),
      lead('Lead', [1, 0], {
        sustain: { drive: 85 },
        echo: { mix: 22 },
      }),
      scene('Bowed', [1, 0.35], {
        sustain: { dry: 0 },
        bloom: { mode: BLOOM.hall, decay: 4, mix: 30 },
      }),
      scene('Overtone', [1, 0], {
        sustain: { mode: SUSTAIN.mix, bloom: 2500 },
        echo: { mix: 15 },
      }),
    ],
  },
  {
    id: 'OX-11',
    name: 'Infinite Clean',
    description:
      'A flat clean amp where chords ring on without distortion, with a chorus, an organ-like harmonic scene and a pad.',
    categories: ['Clean', 'Pop', 'Sustain'],
    genres: ['Clean', 'Pop'],
    techniques: ['Sustain', 'Motion', 'Bloom', 'Scene settings'],
    engine: 'tone3000-a2-lite',
    complexity: 'layered',
    inspiration:
      'Polished clean guitar of the 1980s: compressed, chorused and sustained far past what a clean amp gives on its own.',
    performance:
      'Clean holds chords gently. Chorus widens them. Lead holds single notes firmly, with the level lift. Organ adds the octave above each held note through a slow rotary, for sustained chords. Pad removes the pick attack and opens a long wash.',
    before: [sustain({ drive: 40, tone: 70 }), nam('jc-clean')],
    voices: [voice('Direct'), voice('Octave', pitch(12))],
    after: [
      motion({ mode: MOTION.chorus, rate: 0.6, depth: 45, mix: 0 }),
      bloom({ mode: BLOOM.hall, decay: 2.2, mix: 20 }),
    ],
    scenes: [
      scene('Clean', [1, 0]),
      scene('Chorus', [1, 0], { motion: { mix: 45 } }),
      lead('Lead', [1, 0], { sustain: { drive: 80 }, motion: { mix: 25 } }),
      scene('Organ', [1, 0.3], {
        sustain: { mode: SUSTAIN.harmonic, drive: 75 },
        motion: { mode: MOTION.rotary, mix: 70 },
      }),
      scene('Pad', [1, 0.2], {
        sustain: { dry: 0, drive: 80 },
        bloom: { mode: BLOOM.cloud, decay: 10, mix: 45 },
      }),
    ],
  },
  {
    id: 'OX-12',
    name: 'Long Bend',
    description:
      'A mid-boost pedal into a barking four-by-ten combo, with a sustainer for held bends that turn into feedback.',
    categories: ['Blues', 'Classic rock', 'Sustain'],
    genres: ['Blues', 'Classic rock'],
    techniques: ['Sustain', 'Echo', 'Bloom', 'Scene settings'],
    engine: 'tone3000-a2-full',
    complexity: 'layered',
    inspiration:
      'Slow electric blues from the 1960s to the 1980s: a pushed combo, a long bend held at the top and the note catching into feedback.',
    performance:
      'Push has the sustain off and the amp driven lightly. Rhythm drives it harder. Lead holds each bend and lets it bloom into the octave over four seconds, with the level lift. Catch blooms sooner, into an octave and a fifth. Slap adds a short tape echo and more spring for a shuffle.',
    before: [
      sustain({ on: 0, drive: 65 }),
      nam('drive-ts9'),
      nam('super-reverb-65'),
    ],
    voices: [voice('Direct'), voice('Octave down', pitch(-12))],
    after: [
      echo({ mode: ECHO.tape, time: 110, feedback: 10, age: 40, mix: 0 }),
      bloom({ mode: BLOOM.spring, decay: 1.8, mix: 16 }),
    ],
    scenes: [
      scene('Push', [0.6, 0]),
      scene('Rhythm', [1, 0]),
      lead('Lead', [1, 0], {
        sustain: { on: 1, mode: SUSTAIN.mix, bloom: 4000 },
      }),
      scene('Catch', [1, 0.2], {
        sustain: {
          on: 1,
          mode: SUSTAIN.mix,
          harmonic: OCTAVE_FIFTH,
          bloom: 1500,
        },
      }),
      scene('Slap', [0.8, 0], {
        echo: { mix: 28 },
        bloom: { mix: 26 },
      }),
    ],
  },
];

const echoSounds: FactoryRecipe[] = [
  {
    id: 'OX-13',
    name: 'Tape Loop Diary',
    description:
      'A clean guitar through a tape echo that goes from a slapback to four heads, to a worn loop that feeds itself.',
    categories: ['Lo-fi', 'Ambient', 'Delay'],
    genres: ['Lo-fi', 'Ambient'],
    techniques: ['Echo', 'Bloom', 'Swell', 'Scene settings'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Tape echo machines of the 1950s to the 1970s: slapback on early rock and roll records, then multi-head units and worn loops that smear and wobble.',
    performance:
      'Slap is the short single repeat. Quarter is a steady echo for rhythm. Lead is a longer, louder echo with the level lift. Heads plays all four heads at uneven spacing. Worn ages the tape until it wobbles and darkens. Runaway lets the echo feed itself under the pad; change scene to stop it.',
    before: [compressor()],
    voices: [voice('Direct'), voice('Pad', swell(1200))],
    after: [
      echo({ mode: ECHO.tape, time: 110, feedback: 10, age: 35, mix: 28 }),
      bloom({ mode: BLOOM.room, decay: 0.9, mix: 14 }),
    ],
    scenes: [
      scene('Slap', [1, 0]),
      scene('Quarter', [1, 0], {
        echo: { time: 380, feedback: 35, mix: 22 },
      }),
      lead('Lead', [1, 0], {
        echo: { time: 450, feedback: 40, mix: 30 },
      }),
      scene('Heads', [1, 0], {
        echo: {
          mode: ECHO.heads,
          time: 600,
          feedback: 45,
          spacing: 100,
          mix: 32,
        },
      }),
      scene('Worn', [0.8, 0.4], {
        echo: { time: 520, feedback: 55, age: 90, mod: 60, mix: 35 },
      }),
      scene('Runaway', [0.3, 1], {
        echo: { time: 700, feedback: 104, age: 70, mix: 40 },
      }),
    ],
  },
  {
    id: 'OX-14',
    name: 'Dotted Clock',
    description:
      'A clean guitar with an echo locked to 120 BPM: eighths, dotted eighths, triplets, ping-pong and a backwards half note.',
    categories: ['Pop', 'Clean', 'Delay'],
    genres: ['Pop', 'Clean'],
    techniques: ['Echo', 'Tempo sync', 'Scene settings'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Rhythmic delay guitar of the 1980s and after: muted eighth notes against a dotted echo, so one guitar plays a part that sounds like two.',
    performance:
      'Set the echo BPM to the song; it is 120 as shipped. Eighths doubles the pick. Dotted is the galloping pattern for muted eighth notes. Lead is a quarter-note echo that ducks under the playing, with the level lift. Ping throws the dotted repeats left and right. Triplets and Backwards are the special colours.',
    before: [compressor()],
    voices: [voice('Direct'), voice('Chorus', silk())],
    after: [
      echo({
        mode: ECHO.digital,
        sync: 1,
        bpm: 120,
        division: DIV.eighth,
        feedback: 25,
        mix: 25,
      }),
      bloom({ mode: BLOOM.plate, decay: 1.6, mix: 15 }),
    ],
    scenes: [
      scene('Eighths', [1, 0]),
      scene('Dotted', [1, 0.3], {
        echo: { division: DIV.eighthDotted, feedback: 35, mix: 35 },
      }),
      lead('Lead', [1, 0], {
        echo: { mode: ECHO.duck, division: DIV.quarter, mod: 60, mix: 30 },
      }),
      scene('Ping', [1, 0.3], {
        echo: {
          mode: ECHO.ping,
          division: DIV.eighthDotted,
          feedback: 40,
          width: 100,
          mix: 35,
        },
      }),
      scene('Triplets', [1, 0], {
        echo: { division: DIV.triplet, feedback: 40, mix: 30 },
      }),
      scene('Backwards', [0.8, 0.5], {
        echo: { mode: ECHO.reverse, division: DIV.half, mix: 50 },
      }),
    ],
  },
  {
    id: 'OX-15',
    name: 'Bucket Blues',
    description:
      'A raw small combo with a dark, slightly gritty analogue-style echo, from a slapback to long murky repeats.',
    categories: ['Blues', 'Edge of breakup', 'Delay'],
    genres: ['Blues', 'Edge of breakup'],
    techniques: ['Echo', 'Scene settings'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Bar-band blues and roots rock of the late 1970s: a small combo on the edge of breakup and a bucket-brigade echo pedal whose repeats get darker the longer they are.',
    performance:
      'Slap is one short repeat for shuffles. Rhythm is a soft echo behind chords. Lead is a longer, louder echo with the level lift. Murk is a long dark echo with some noise, for slow tunes. Tape swaps to a tape echo, brighter and with wobble.',
    before: [compressor(), nam('tweed-crunch')],
    voices: [voice('Direct'), voice('Wide', silk())],
    after: [
      echo({ mode: ECHO.bucket, time: 95, feedback: 10, age: 30, mix: 28 }),
      flyRoom(),
    ],
    scenes: [
      scene('Slap', [1, 0]),
      scene('Rhythm', [1, 0.2], {
        echo: { time: 300, feedback: 30, mix: 18 },
      }),
      lead('Lead', [1, 0], {
        echo: { time: 420, feedback: 40, mix: 30 },
      }),
      scene('Murk', [1, 0.3], {
        echo: { time: 700, feedback: 50, age: 60, mix: 32 },
      }),
      scene('Tape', [1, 0], {
        echo: { mode: ECHO.tape, time: 330, feedback: 35, mod: 40, mix: 25 },
      }),
    ],
  },
  {
    id: 'OX-16',
    name: 'Arena Repeat',
    description:
      'A chiming edge-of-breakup amp with a tempo-locked echo: dotted, ducking, ping-pong, a filter sweep and a held repeat.',
    categories: ['Pop', 'Edge of breakup', 'Delay'],
    genres: ['Pop', 'Edge of breakup'],
    techniques: ['Echo', 'Tempo sync', 'Scene settings'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Stadium pop-rock guitar of the 1980s: a chiming amp and dotted echoes filling a large hall behind a simple picked figure.',
    performance:
      'Set the echo BPM to the song; it is 120 as shipped. Chime is the amp with the echo off. Dotted is the rhythmic echo for picked eighth notes. Lead is a quarter-note echo that ducks while you play, with the level lift. Ping spreads the repeats wide. Sweep runs a filter through them. Hold loops the last repeat for as long as the scene is on.',
    before: [compressor(), nam('ac30-chime')],
    voices: [voice('Direct'), voice('Chorus', silk())],
    after: [
      echo({
        mode: ECHO.digital,
        sync: 1,
        bpm: 120,
        division: DIV.eighthDotted,
        feedback: 35,
        mix: 0,
      }),
      flyHall(2.5, 16),
    ],
    scenes: [
      scene('Chime', [1, 0]),
      scene('Dotted', [1, 0.2], { echo: { mix: 32 } }),
      lead('Lead', [1, 0], {
        echo: { mode: ECHO.duck, division: DIV.quarter, mod: 60, mix: 30 },
      }),
      scene('Ping', [1, 0.3], {
        echo: { mode: ECHO.ping, width: 100, mix: 35 },
      }),
      scene('Sweep', [1, 0], {
        echo: { mode: ECHO.filter, feedback: 55, mod: 70, mix: 35 },
      }),
      scene('Hold', [1, 0.3], {
        echo: { mix: 40, hold: 1 },
      }),
    ],
  },
  {
    id: 'OX-17',
    name: 'Drum Echo',
    description:
      'A clean amp and a warm crunch amp into a four-head echo: one head, two, all four, and a dark swirling drum sound.',
    categories: ['Classic rock', 'Progressive', 'Delay'],
    genres: ['Classic rock', 'Progressive'],
    techniques: ['Echo', 'Dual amp', 'Bloom', 'Scene settings'],
    engine: 'tone3000-a2-lite',
    complexity: 'layered',
    inspiration:
      'Multi-head tape and drum echoes of the 1960s and 1970s: rhythmic, slightly unsteady repeats behind clean arpeggios and slow, spacious solos.',
    performance:
      'Clean is the clean amp with one head, a single repeat. Rhythm adds the crunch amp and a second head. Lead is the crunch amp through all four heads with the level lift. Golden swings the heads to uneven spacing so the repeats tumble. Swirl ages the echo and raises the feedback for a dark wash. Single is a plain tape echo.',
    before: [],
    voices: [
      voice('Clean', nam('blackface-clean')),
      voice('Crunch', nam('bluesbreaker-crunch')),
    ],
    after: [
      echo({
        mode: ECHO.heads,
        heads: HEADS.one,
        time: 440,
        feedback: 30,
        age: 30,
        mix: 22,
      }),
      bloom({ mode: BLOOM.plate, decay: 1.8, mix: 16 }),
    ],
    scenes: [
      scene('Clean', [1, 0]),
      scene('Rhythm', [0.6, 0.7], { echo: { heads: HEADS.oneTwo } }),
      lead('Lead', [0, 1], {
        echo: { heads: HEADS.all, time: 520, feedback: 40, mix: 28 },
      }),
      scene('Golden', [1, 0.3], {
        echo: { heads: HEADS.all, spacing: 100, time: 600, mix: 30 },
      }),
      scene('Swirl', [0.5, 0.8], {
        echo: { heads: HEADS.all, age: 80, mod: 50, feedback: 70, mix: 34 },
      }),
      scene('Single', [0.8, 0.5], {
        echo: { mode: ECHO.tape, time: 380, feedback: 35, mix: 24 },
      }),
    ],
  },
  {
    id: 'OX-18',
    name: 'Backwards Hour',
    description:
      'A chiming clean amp and a swell pad with an echo that plays each phrase backwards, plus ducking and filtered repeats.',
    categories: ['Experimental', 'Post-rock', 'Delay'],
    genres: ['Experimental', 'Post-rock'],
    techniques: ['Echo', 'Bloom', 'Swell', 'Scene settings'],
    engine: 'tone3000-a2-full',
    complexity: 'layered',
    inspiration:
      'Backwards guitar from late-1960s studio experiments, where a solo was recorded with the tape reversed, and the reverse delays that later did it live.',
    performance:
      'Clean is the amp with a light echo. Rhythm ducks the echo under the playing. Lead is a longer echo with the level lift. Backwards plays each second of what you play in reverse, nearly wet: play short phrases and leave gaps. Sweep filters the repeats. Tide is a slower reverse into a long wash, with the pad.',
    before: [nam('match-brave')],
    voices: [voice('Direct'), voice('Pad', swell(1300))],
    after: [
      echo({ mode: ECHO.digital, time: 380, feedback: 30, mix: 14 }),
      bloom({ mode: BLOOM.hall, decay: 2.4, mix: 20 }),
    ],
    scenes: [
      scene('Clean', [1, 0]),
      scene('Rhythm', [1, 0], {
        echo: { mode: ECHO.duck, time: 300, mod: 70, mix: 22 },
      }),
      lead('Lead', [1, 0], { echo: { time: 440, feedback: 40, mix: 26 } }),
      scene('Backwards', [1, 0], {
        echo: { mode: ECHO.reverse, time: 1000, feedback: 15, mix: 70 },
      }),
      scene('Sweep', [1, 0.2], {
        echo: { mode: ECHO.filter, time: 500, feedback: 55, mod: 70, mix: 35 },
      }),
      scene('Tide', [0.5, 0.8], {
        echo: { mode: ECHO.reverse, time: 1800, feedback: 30, mix: 60 },
        bloom: { mode: BLOOM.cloud, decay: 12, mix: 45 },
      }),
    ],
  },
];

const motionSounds: FactoryRecipe[] = [
  {
    id: 'OX-19',
    name: 'Eight Motions',
    description:
      'One compressed clean guitar and eight kinds of movement, a scene each: chorus, phaser, flanger, vibe, tremolo, harmonic tremolo, vibrato and ring.',
    categories: ['Funk', 'Clean', 'Modulation'],
    genres: ['Funk', 'Clean'],
    techniques: ['Motion', 'Scene settings'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'The modulation pedals of the 1960s to the 1980s, lined up on one clean rhythm part: the swirl of soul and funk records, the sweep of early hard rock, the wobble of surf.',
    performance:
      'Chorus is the wide clean. Phaser is the slow sweep for sixteenth-note rhythm. Lead is a ringing flanger with an octave below and the level lift. Vibe throbs. Tremolo and Harmonic pulse the volume, the second more softly. Vibrato bends the pitch with no dry sound. Ring is a bell-like clang for effects.',
    before: [compressor()],
    voices: [voice('Direct'), voice('Octave down', pitch(-12))],
    after: [
      motion({ mode: MOTION.chorus, rate: 0.7, depth: 50, mix: 50 }),
      flyRoom(),
    ],
    scenes: [
      scene('Chorus', [1, 0]),
      scene('Phaser', [1, 0], {
        motion: { mode: MOTION.phaser, rate: 0.5, depth: 70, feedback: 30 },
      }),
      lead('Lead', [1, 0.3], {
        motion: { mode: MOTION.flanger, rate: 0.25, depth: 60, feedback: 55 },
      }),
      scene('Vibe', [1, 0], {
        motion: { mode: MOTION.vibe, rate: 1.8, depth: 75, mix: 100 },
      }),
      scene('Tremolo', [1, 0], {
        motion: { mode: MOTION.tremolo, rate: 5, depth: 65, mix: 100 },
      }),
      scene('Harmonic', [1, 0], {
        motion: { mode: MOTION.harmonic, rate: 3.5, depth: 80, mix: 100 },
      }),
      scene('Vibrato', [1, 0], {
        motion: { mode: MOTION.vibrato, rate: 4.5, depth: 30, mix: 100 },
      }),
      scene('Ring', [1, 0.4], {
        motion: { mode: MOTION.ring, rate: 2, depth: 100, mix: 60 },
      }),
    ],
  },
  {
    id: 'OX-20',
    name: 'Spinning Cabinet',
    description:
      'A lightly driven guitar through a rotating speaker: slow, fast, braked, horn only, with an octave voice for organ-like chords.',
    categories: ['Jazz', 'Blues', 'Modulation'],
    genres: ['Jazz', 'Blues'],
    techniques: ['Motion', 'Bloom', 'Scene settings'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Guitar played through a rotating organ speaker, as on soul, blues and psychedelic records of the late 1960s: a slow shimmer that spins up for the chorus.',
    performance:
      'Slow is the gentle turn for chords. Fast spins the rotors up; they take a moment to get there. Lead stays fast with an octave above and the level lift. Brake lets the rotors come to rest. Horn keeps the drum still for a thinner, brighter swirl. Vibe swaps to a throbbing phase for a change of colour.',
    before: [compressor(), drive()],
    voices: [voice('Direct'), voice('Octave', pitch(12))],
    after: [
      motion({ mode: MOTION.rotary, rate: 0.8, depth: 70, mix: 80 }),
      bloom({ mode: BLOOM.room, decay: 1, mix: 16 }),
    ],
    scenes: [
      scene('Slow', [1, 0]),
      scene('Fast', [1, 0], { motion: { fast: 1 } }),
      lead('Lead', [1, 0.3], { motion: { fast: 1, depth: 85 } }),
      scene('Brake', [1, 0.2], { motion: { shape: 2 } }),
      scene('Horn', [1, 0], { motion: { shape: 1, fast: 1 } }),
      scene('Vibe', [1, 0], {
        motion: { mode: MOTION.vibe, rate: 1.5, depth: 70 },
      }),
    ],
  },
  {
    id: 'OX-21',
    name: 'Lamp Throb',
    description:
      'A boosted crunch stack with a lamp-and-photocell style throb after it, plus rotary and phaser scenes.',
    categories: ['Classic rock', 'Blues', 'Modulation'],
    genres: ['Classic rock', 'Blues'],
    techniques: ['Motion', 'Scene settings'],
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Psychedelic blues-rock of the late 1960s: a loud stack and a pulsing, lopsided phase effect that makes chords sound as if they are under water.',
    performance:
      'Crunch is the stack with no movement. Vibe adds the throb for chords and slow riffs. Lead is the heavier, slower throb with an echo and the level lift. Rotary swaps to a rotating speaker. Phaser is a slow eight-stage sweep for a later-decade colour.',
    before: [drive(), nam('plexi-crunch')],
    voices: [voice('Direct'), voice('Echo', echoAt(0.35))],
    after: [
      motion({ mode: MOTION.vibe, rate: 1.6, depth: 70, mix: 0 }),
      flyRoom(),
    ],
    scenes: [
      scene('Crunch', [1, 0]),
      scene('Vibe', [1, 0], { motion: { mix: 100 } }),
      lead('Lead', [1, 0.3], {
        motion: { shape: 1, rate: 1.1, depth: 85, mix: 100 },
      }),
      scene('Rotary', [1, 0], {
        motion: { mode: MOTION.rotary, rate: 0.8, fast: 1, mix: 80 },
      }),
      scene('Phaser', [1, 0.2], {
        motion: {
          mode: MOTION.phaser,
          shape: 2,
          rate: 0.3,
          feedback: 40,
          mix: 50,
        },
      }),
    ],
  },
  {
    id: 'OX-22',
    name: 'Harmonic Tremolo',
    description:
      'A barking clean combo with tremolo after it: plain, harmonic (lows and highs in turn), a square chop and a vibrato.',
    categories: ['Country', 'Blues', 'Modulation'],
    genres: ['Country', 'Blues'],
    techniques: ['Motion', 'Bloom', 'Scene settings'],
    engine: 'tone3000-a2-lite',
    complexity: 'layered',
    inspiration:
      'Combo amplifiers of the early 1960s with built-in tremolo and spring reverb: swampy rhythm parts and slow ballads that pulse with the song.',
    performance:
      'Clean is the amp and a little spring. Tremolo is the steady pulse for rhythm. Lead uses the slow harmonic tremolo, which moves without dropping the level, plus the level lift. Deep is the harmonic tremolo at full depth. Chop is a hard on-off pulse for stops and intros. Vibrato bends the pitch gently.',
    before: [nam('super-reverb-77')],
    voices: [voice('Direct'), voice('Pad', swell(900))],
    after: [
      motion({ mode: MOTION.tremolo, rate: 4.5, depth: 55, mix: 0 }),
      bloom({ mode: BLOOM.spring, decay: 2, mix: 20 }),
    ],
    scenes: [
      scene('Clean', [1, 0]),
      scene('Tremolo', [1, 0], { motion: { mix: 100 } }),
      lead('Lead', [1, 0], {
        motion: { mode: MOTION.harmonic, rate: 2.5, depth: 60, mix: 100 },
      }),
      scene('Deep', [1, 0.3], {
        motion: { mode: MOTION.harmonic, rate: 3.5, depth: 100, mix: 100 },
      }),
      scene('Chop', [1, 0], {
        motion: { shape: 2, rate: 7, depth: 100, mix: 100 },
      }),
      scene('Vibrato', [1, 0], {
        motion: { mode: MOTION.vibrato, rate: 5, depth: 25, mix: 100 },
      }),
    ],
  },
  {
    id: 'OX-23',
    name: 'Jet Stream',
    description:
      'A boosted high-gain stack with a flanger after it, from a slow sweep to through-zero and a ringing jet.',
    categories: ['Hard rock', 'Progressive', 'Modulation'],
    genres: ['Hard rock', 'Progressive'],
    techniques: ['Motion', 'Echo', 'Bloom', 'Scene settings'],
    engine: 'tone3000-a2-full',
    complexity: 'layered',
    inspiration:
      'Hard rock of the late 1970s and early 1980s: heavy riffs with a slow jet-plane sweep across them, an effect first made with two tape machines.',
    performance:
      'Rhythm is the stack with no movement. Flange adds the slow sweep to riffs. Lead swaps to a slow phaser with an echo and the level lift. Through-zero is the tape-style sweep that passes through a null. Jet is the ringing, inverted sweep for intros and breaks. Chorus widens the octave voice for a cleaner bridge.',
    before: [nam('drive-sd1'), nam('friedman-be100')],
    voices: [voice('Direct'), voice('Octave', pitch(12))],
    after: [
      motion({ mode: MOTION.flanger, rate: 0.2, depth: 60, mix: 0 }),
      echo({ mode: ECHO.digital, time: 420, feedback: 30, mix: 0 }),
      bloom({ mode: BLOOM.plate, decay: 1.6, mix: 12 }),
    ],
    scenes: [
      scene('Rhythm', [1, 0]),
      scene('Flange', [1, 0], { motion: { feedback: 40, mix: 50 } }),
      lead('Lead', [1, 0], {
        motion: { mode: MOTION.phaser, rate: 0.3, depth: 60, mix: 40 },
        echo: { mix: 22 },
      }),
      scene('Through-zero', [1, 0], {
        motion: { shape: 1, rate: 0.12, depth: 80, mix: 50 },
      }),
      scene('Jet', [1, 0], {
        motion: { shape: 2, rate: 0.1, depth: 90, feedback: 70, mix: 50 },
      }),
      scene('Chorus', [0.7, 0.3], {
        motion: { mode: MOTION.chorus, shape: 1, rate: 0.6, mix: 50 },
      }),
    ],
  },
  {
    id: 'OX-24',
    name: 'Clean Ensemble',
    description:
      'A warm, round clean amp with a chorus that grows from two voices to a full ensemble, plus vibrato, rotary and ring scenes.',
    categories: ['Clean', 'Jazz', 'Modulation'],
    genres: ['Clean', 'Jazz', 'Pop'],
    techniques: ['Motion', 'Bloom', 'Scene settings'],
    engine: 'tone3000-a2-full',
    complexity: 'layered',
    inspiration:
      'Clean chorus guitar of the late 1970s and 1980s: round jazz-style chords and pop arpeggios made wide by a string-ensemble style chorus.',
    performance:
      'Clean is the amp with a light two-voice chorus. Ensemble thickens it to three voices for chords. Lead adds the faster shimmer and a plate, with the level lift. Vibrato removes the dry sound for a wavering line. Rotary is a slow rotating speaker. Bell is a ring effect with an octave above, for single strange notes.',
    before: [nam('polytone-jazz')],
    voices: [voice('Direct'), voice('Octave', pitch(12))],
    after: [
      motion({ mode: MOTION.chorus, rate: 0.6, depth: 40, mix: 30 }),
      bloom({ mode: BLOOM.hall, decay: 2, mix: 16 }),
    ],
    scenes: [
      scene('Clean', [1, 0]),
      scene('Ensemble', [1, 0], { motion: { shape: 1, depth: 55, mix: 50 } }),
      lead('Lead', [1, 0], {
        motion: { shape: 2, depth: 55, mix: 50 },
        bloom: { mode: BLOOM.plate, decay: 2.2, mix: 22 },
      }),
      scene('Vibrato', [1, 0], {
        motion: { mode: MOTION.vibrato, rate: 4, depth: 25, mix: 100 },
      }),
      scene('Rotary', [1, 0], {
        motion: { mode: MOTION.rotary, rate: 0.7, depth: 70, mix: 80 },
      }),
      scene('Bell', [1, 0.4], {
        motion: { mode: MOTION.ring, rate: 1.5, depth: 100, mix: 50 },
      }),
    ],
  },
];

// --- Rigs that combine the four effects -------------------------------------

/** A service rig, once with a capture and once with effects only: the same
 * voices, chain and eight scenes after a different front end. */
const serviceRig = (
  spec: Pick<
    FactoryRecipe,
    'id' | 'name' | 'engine' | 'description' | 'before' | 'techniques'
  >,
): FactoryRecipe => ({
  ...spec,
  categories: ['Ambient', 'Pop', 'Clean'],
  genres: ['Ambient', 'Pop', 'Clean'],
  complexity: 'layered',
  inspiration:
    'Congregational and modern worship guitar from the 2000s onward: a chiming clean part with dotted echoes under the singing, and long pads that fill the room between songs.',
  performance:
    'Set the echo BPM to the song; it is 120 as shipped. Verse is the plain clean with a light chorus and hall. Dotted adds the dotted-eighth echo for picked parts. Lead is a quarter-note echo on a plate with gentle sustain and the level lift. Pad plays swells into a long wash for prayer and transitions. Big chorus adds an octave and a shimmering tail under the dotted echo. Shimmer pad is the swell under a rising tail. Freeze holds the tail that is ringing when you choose it, to play or speak over; leave the scene to let it go. Tremolo is a soft pulsing clean for a quiet verse.',
  voices: [
    voice('Direct'),
    voice('Pad', swell(1500)),
    voice('Octave', pitch(12)),
  ],
  after: [
    motion({ mode: MOTION.chorus, rate: 0.5, depth: 35, mix: 25 }),
    echo({
      mode: ECHO.digital,
      sync: 1,
      bpm: 120,
      division: DIV.eighthDotted,
      feedback: 35,
      tone: 40,
      mix: 0,
    }),
    bloom({ mode: BLOOM.hall, decay: 2.6, predelay: 20, mix: 22 }),
  ],
  scenes: [
    scene('Verse', [1, 0, 0]),
    scene('Dotted', [1, 0, 0], { echo: { mix: 32 } }),
    lead('Lead', [1, 0, 0], {
      sustain: { on: 1 },
      echo: { division: DIV.quarter, feedback: 40, mix: 28 },
      bloom: { mode: BLOOM.plate, decay: 2.8, predelay: 60, mix: 26 },
    }),
    scene('Pad', [0.2, 1, 0], {
      echo: { division: DIV.quarter, mix: 20 },
      bloom: { mode: BLOOM.cloud, decay: 14, mix: 55 },
    }),
    scene('Big chorus', [1, 0, 0.25], {
      echo: { mix: 30 },
      bloom: { mode: BLOOM.shimmer, decay: 5, shimmer: 30, mix: 30 },
    }),
    scene('Shimmer pad', [0, 1, 0.2], {
      bloom: { mode: BLOOM.shimmer, decay: 10, shimmer: 55, mix: 55 },
    }),
    scene('Freeze', [1, 0, 0], {
      bloom: { mode: BLOOM.cloud, decay: 14, mix: 50, freeze: 1 },
    }),
    scene('Tremolo', [1, 0, 0], {
      motion: { mode: MOTION.harmonic, rate: 3, depth: 50, mix: 100 },
    }),
  ],
});

const serviceSounds: FactoryRecipe[] = [
  serviceRig({
    id: 'OX-25',
    name: 'Sunday Morning',
    engine: 'tone3000-a2-lite',
    description:
      'A chiming amp on the edge of breakup with a dotted-eighth echo, a hall, swell pads, a shimmer and a frozen tail to play over: eight scenes for a service.',
    techniques: ['Sustain', 'Motion', 'Echo', 'Bloom', 'Swell', 'Tempo sync'],
    before: [sustain({ on: 0, drive: 35, tone: 65 }), nam('ac30-chime')],
  }),
  serviceRig({
    id: 'OX-26',
    name: 'Sunday Morning Direct',
    engine: 'lv2',
    description:
      'The service rig without an amp capture: a compressed clean guitar with a dotted-eighth echo, a hall, swell pads, a shimmer and a frozen tail. It needs no tones.',
    techniques: ['Sustain', 'Motion', 'Echo', 'Bloom', 'Swell', 'Tempo sync'],
    before: [sustain({ on: 0, drive: 35, tone: 65 }), compressor()],
  }),
];

const rhythmLeadSounds: FactoryRecipe[] = [
  {
    id: 'OX-27',
    name: 'Riff and Solo',
    description:
      'A crunch stack set up as two rhythm sounds and two lead sounds: a short echo and a room for riffs, then sustain, a longer echo and a bigger reverb for solos.',
    categories: ['Classic rock', 'Hard rock'],
    genres: ['Classic rock', 'Hard rock'],
    techniques: ['Sustain', 'Motion', 'Echo', 'Bloom', 'Scene settings'],
    engine: 'tone3000-a2-lite',
    complexity: 'layered',
    inspiration:
      'The two-sound rock rig from the 1970s onward: one footswitch between a dry, punchy rhythm sound and a louder, wetter lead sound.',
    performance:
      'Rhythm is the crunch with a slow phaser, a short echo and a room. Tight drops the phaser and the echo for fast riffs. Lead switches the sustain on and moves to a longer tape echo and a plate, with the level lift. Long lead holds notes into their octave under a longer echo and a hall. Break backs the amp off under a tremolo for a quiet section.',
    before: [sustain({ on: 0, drive: 70 }), nam('plexi-crunch')],
    voices: [voice('Direct'), voice('Octave down', pitch(-12))],
    after: [
      motion({ mode: MOTION.phaser, rate: 0.25, depth: 50, mix: 25 }),
      echo({ mode: ECHO.digital, time: 120, feedback: 15, mix: 12 }),
      bloom({ mode: BLOOM.room, decay: 0.8, mix: 15 }),
    ],
    scenes: [
      scene('Rhythm', [1, 0]),
      scene('Tight', [1, 0], { motion: { mix: 0 }, echo: { mix: 0 } }),
      lead('Lead', [1, 0], {
        sustain: { on: 1 },
        motion: { mix: 0 },
        echo: { mode: ECHO.tape, time: 450, feedback: 35, mix: 26 },
        bloom: { mode: BLOOM.plate, decay: 2.4, predelay: 60, mix: 24 },
      }),
      scene('Long lead', [1, 0.2], {
        sustain: { on: 1, mode: SUSTAIN.mix, bloom: 2500 },
        motion: { mix: 0 },
        echo: { mode: ECHO.tape, time: 560, feedback: 45, mix: 30 },
        bloom: { mode: BLOOM.hall, decay: 3.5, predelay: 40, mix: 28 },
      }),
      scene('Break', [0.5, 0], {
        motion: { mode: MOTION.tremolo, rate: 5, depth: 60, mix: 100 },
        echo: { mix: 0 },
      }),
    ],
  },
  {
    id: 'OX-28',
    name: 'Chords and Lines',
    description:
      'A clean guitar set up as two rhythm sounds and two lead sounds: chorus, a short echo and a room for chords, then sustain, a longer echo and a hall for single-note lines.',
    categories: ['Clean', 'Pop'],
    genres: ['Clean', 'Pop'],
    techniques: ['Sustain', 'Motion', 'Echo', 'Bloom', 'Scene settings'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Session-style clean guitar of the 1980s and 1990s: a chorused rhythm sound for the verses and a sustained, echoing clean lead for the fills.',
    performance:
      'Rhythm is the clean with a chorus, a short echo and a room. Dry drops the chorus and the echo for tight funk-style parts. Lead switches the sustain on and moves to a longer echo that ducks under the playing, on a plate, with the level lift. Long lead holds notes firmly under a wide ping-pong echo and a hall. Pad plays swells into the hall.',
    before: [sustain({ on: 0, drive: 55, tone: 65 }), compressor()],
    voices: [voice('Direct'), voice('Pad', swell(1200))],
    after: [
      motion({ mode: MOTION.chorus, rate: 0.6, depth: 45, mix: 40 }),
      echo({ mode: ECHO.digital, time: 140, feedback: 15, mix: 14 }),
      bloom({ mode: BLOOM.room, decay: 0.9, mix: 16 }),
    ],
    scenes: [
      scene('Rhythm', [1, 0]),
      scene('Dry', [1, 0], { motion: { mix: 0 }, echo: { mix: 0 } }),
      lead('Lead', [1, 0], {
        sustain: { on: 1 },
        motion: { mix: 20 },
        echo: { mode: ECHO.duck, time: 420, feedback: 35, mod: 60, mix: 28 },
        bloom: { mode: BLOOM.plate, decay: 2.2, predelay: 50, mix: 22 },
      }),
      scene('Long lead', [1, 0], {
        sustain: { on: 1, drive: 80 },
        motion: { mix: 20 },
        echo: { mode: ECHO.ping, time: 520, feedback: 45, width: 100, mix: 30 },
        bloom: { mode: BLOOM.hall, decay: 3.5, mix: 28 },
      }),
      scene('Pad', [0.2, 1], {
        echo: { time: 480, feedback: 40, mix: 22 },
        bloom: { mode: BLOOM.hall, decay: 5, mix: 40 },
      }),
    ],
  },
];

// --- One setup per genre ----------------------------------------------------

const all4 = ['Sustain', 'Motion', 'Echo', 'Bloom', 'Scene settings'];

const genreSounds: FactoryRecipe[] = [
  {
    id: 'OX-29',
    name: 'Breakup Point',
    description:
      'A clean amp with a light boost capture that breaks up when you dig in, with a harmonic tremolo, a tape slap and a spring.',
    categories: ['Edge of breakup', 'Blues'],
    genres: ['Edge of breakup'],
    techniques: ['Motion', 'Echo', 'Bloom', 'Scene settings'],
    engine: 'tone3000-a2-lite',
    complexity: 'layered',
    inspiration:
      'Touch-sensitive roots and indie guitar from the 1960s to today: an amp set where soft picking stays clean and hard picking growls.',
    performance:
      'Clean drives the amp lightly, with a little spring. Edge drives it fully for chords that bite. Lead adds a tape slap and a plate with the level lift. Tremolo is the harmonic tremolo, which pulses without thinning the sound. Room is the driest, closest version for busy parts.',
    before: [nam('drive-morning-glory'), nam('two-rock-clean')],
    voices: [voice('Direct'), voice('Pad', swell(900))],
    after: [
      motion({ mode: MOTION.harmonic, rate: 3.5, depth: 60, mix: 0 }),
      echo({ mode: ECHO.tape, time: 120, feedback: 10, age: 40, mix: 0 }),
      bloom({ mode: BLOOM.spring, decay: 1.8, mix: 18 }),
    ],
    scenes: [
      scene('Clean', [0.5, 0]),
      scene('Edge', [1, 0]),
      lead('Lead', [1, 0], {
        echo: { mix: 24 },
        bloom: { mode: BLOOM.plate, decay: 2, mix: 20 },
      }),
      scene('Tremolo', [0.8, 0], { motion: { mix: 100 } }),
      scene('Room', [1, 0], {
        bloom: { mode: BLOOM.room, decay: 0.7, mix: 14 },
      }),
    ],
  },
  {
    id: 'OX-30',
    name: 'Tight Pocket',
    description:
      'A squeezed clean guitar in a small, tight room with a phaser, a throbbing vibe and a quick flanger for sixteenth-note rhythm.',
    categories: ['Funk', 'Clean'],
    genres: ['Funk'],
    techniques: ['Motion', 'Echo', 'Bloom', 'Scene settings'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Funk and disco rhythm guitar of the 1970s: thin, compressed, played in tight sixteenth notes with a phaser sweeping slowly across the bar.',
    performance:
      'Dry is the tight clean in a small room. Phaser is the slow four-stage sweep for rhythm. Lead is a throbbing vibe with a short echo and the level lift. Flange is a quick, shallow sweep for single-note lines. Wide is an ensemble chorus for held chords.',
    before: [compressor()],
    voices: [voice('Direct'), voice('Octave down', pitch(-12))],
    after: [
      motion({ mode: MOTION.phaser, rate: 0.4, depth: 65, mix: 0 }),
      echo({ mode: ECHO.digital, time: 160, feedback: 15, mix: 0 }),
      bloom({ mode: BLOOM.room, decay: 0.4, size: 25, mix: 12 }),
    ],
    scenes: [
      scene('Dry', [1, 0]),
      scene('Phaser', [1, 0], { motion: { feedback: 30, mix: 50 } }),
      lead('Lead', [1, 0.2], {
        motion: { mode: MOTION.vibe, rate: 2, depth: 70, mix: 100 },
        echo: { mix: 18 },
      }),
      scene('Flange', [1, 0], {
        motion: { mode: MOTION.flanger, rate: 0.9, depth: 35, mix: 40 },
      }),
      scene('Wide', [1, 0], {
        motion: { mode: MOTION.chorus, shape: 1, rate: 0.6, mix: 50 },
      }),
    ],
  },
  {
    id: 'OX-31',
    name: 'Smoky Corner',
    description:
      'A boosted four-by-ten combo with a dark analogue-style echo and a spring tank, and a sustained scene for the slow solo.',
    categories: ['Blues', 'Edge of breakup'],
    genres: ['Blues'],
    techniques: all4,
    engine: 'tone3000-a2-full',
    complexity: 'layered',
    inspiration:
      'Club blues from the 1960s to the 1980s: a combo turned up until it sings, a spring tank and a dark echo pedal behind the solo.',
    performance:
      'Clean backs the amp off, with a little spring. Rhythm drives it for shuffles, with a short dark slap. Lead is a longer dark echo and more spring, with the level lift. Slow holds each note for the slow blues. Wet is a deep spring and a tremolo for a ballad intro.',
    before: [
      sustain({ on: 0, drive: 60 }),
      nam('drive-kot'),
      nam('super-reverb-65'),
    ],
    voices: [voice('Direct'), voice('Octave down', pitch(-12))],
    after: [
      motion({ mode: MOTION.tremolo, rate: 4, depth: 50, mix: 0 }),
      echo({ mode: ECHO.bucket, time: 110, feedback: 10, age: 35, mix: 0 }),
      bloom({ mode: BLOOM.spring, decay: 1.8, mix: 16 }),
    ],
    scenes: [
      scene('Clean', [0.5, 0]),
      scene('Rhythm', [1, 0], { echo: { mix: 22 } }),
      lead('Lead', [1, 0], {
        echo: { time: 380, feedback: 35, mix: 26 },
        bloom: { decay: 2.4, mix: 24 },
      }),
      scene('Slow', [1, 0], {
        sustain: { on: 1 },
        echo: { time: 460, feedback: 40, mix: 24 },
      }),
      scene('Wet', [0.6, 0], {
        motion: { mix: 100 },
        bloom: { decay: 3.5, mix: 40 },
      }),
    ],
  },
  {
    id: 'OX-32',
    name: 'Slap Ranch',
    description:
      'A bright compressed clean with a tape slapback and a spring tank, plus a tremolo and a longer echo for ballads.',
    categories: ['Country', 'Clean'],
    genres: ['Country'],
    techniques: ['Motion', 'Echo', 'Bloom', 'Scene settings'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Country and rockabilly picking of the 1950s and 1960s: a bright bridge pickup, a single tape slap and a splash of spring.',
    performance:
      'Slap is the single short repeat for picking. Spring swaps the slap for a deeper tank. Lead is a slightly longer slap with more level and the lift. Tremolo adds a steady pulse for ballads. Long is a quarter-note tape echo for slow tunes, with the octave below for baritone-style lines.',
    before: [compressor()],
    voices: [voice('Direct'), voice('Octave down', pitch(-12))],
    after: [
      motion({ mode: MOTION.tremolo, rate: 5, depth: 55, mix: 0 }),
      echo({ mode: ECHO.tape, time: 100, feedback: 8, age: 30, mix: 30 }),
      bloom({ mode: BLOOM.spring, decay: 1.6, tone: 70, mix: 14 }),
    ],
    scenes: [
      scene('Slap', [1, 0]),
      scene('Spring', [1, 0], {
        echo: { mix: 0 },
        bloom: { decay: 2.8, mix: 32 },
      }),
      lead('Lead', [1, 0], { echo: { time: 130, feedback: 15, mix: 34 } }),
      scene('Tremolo', [1, 0], {
        motion: { mix: 100 },
        echo: { mix: 15 },
      }),
      scene('Long', [0.9, 0.4], {
        echo: { time: 400, feedback: 30, mix: 24 },
      }),
    ],
  },
  {
    id: 'OX-33',
    name: 'Warm Room',
    description:
      'A round, dark clean amp in a small warm room, with a light chorus and a gentle sustained scene for ballads.',
    categories: ['Jazz', 'Clean'],
    genres: ['Jazz'],
    techniques: all4,
    engine: 'tone3000-a2-lite',
    complexity: 'simple',
    inspiration:
      'Small-group jazz guitar from the 1950s onward: a hollow instrument, a dark clean amp and the sound of a small club around it.',
    performance:
      'Room is the amp in a small dark room. Chorus adds a light two-voice chorus for chord melody. Lead brings the amp forward on a short plate with the level lift. Ballad holds notes gently in a longer hall. Octaves adds the octave below for doubled lines.',
    before: [sustain({ on: 0, drive: 30, tone: 45 }), nam('polytone-jazz')],
    voices: [voice('Direct'), voice('Octave down', pitch(-12))],
    after: [
      motion({ mode: MOTION.chorus, rate: 0.5, depth: 30, mix: 0 }),
      echo({ mode: ECHO.bucket, time: 280, feedback: 15, mix: 0 }),
      bloom({ mode: BLOOM.room, decay: 0.9, tone: 40, mix: 16 }),
    ],
    scenes: [
      scene('Room', [0.8, 0]),
      scene('Chorus', [0.8, 0], { motion: { mix: 30 } }),
      lead('Lead', [1, 0], {
        bloom: { mode: BLOOM.plate, decay: 1.4, tone: 45, mix: 16 },
      }),
      scene('Ballad', [0.8, 0], {
        sustain: { on: 1 },
        echo: { mix: 12 },
        bloom: { mode: BLOOM.hall, decay: 2.4, tone: 45, mix: 22 },
      }),
      scene('Octaves', [0.8, 0.5]),
    ],
  },
  {
    id: 'OX-34',
    name: 'Tape and Plate',
    description:
      'A pushed crunch amp with the studio effects of its day after it: a throbbing vibe, a tape echo, a rotating speaker and a plate.',
    categories: ['Classic rock', 'Blues'],
    genres: ['Classic rock'],
    techniques: all4,
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Rock records of the late 1960s and early 1970s: a small amp turned all the way up, with the tape echo, plate and rotating speaker of the studio added afterwards.',
    performance:
      'Crunch is the amp on a short plate. Vibe adds the throb for chords. Lead holds notes through a tape echo with the level lift. Rotary swaps to a slow rotating speaker for a bridge. Feedback lets held notes climb to their octave over a long echo.',
    before: [
      sustain({ on: 0, drive: 65 }),
      drive(),
      nam('bluesbreaker-crunch'),
    ],
    voices: [voice('Direct'), voice('Octave', pitch(12))],
    after: [
      motion({ mode: MOTION.vibe, rate: 1.4, depth: 65, mix: 0 }),
      echo({ mode: ECHO.tape, time: 400, feedback: 35, age: 45, mix: 0 }),
      bloom({ mode: BLOOM.plate, decay: 1.5, mix: 15 }),
    ],
    scenes: [
      scene('Crunch', [1, 0]),
      scene('Vibe', [1, 0], { motion: { mix: 100 } }),
      lead('Lead', [1, 0], {
        sustain: { on: 1 },
        echo: { mix: 26 },
        bloom: { decay: 2.2, mix: 20 },
      }),
      scene('Rotary', [1, 0], {
        motion: { mode: MOTION.rotary, rate: 0.8, mix: 80 },
      }),
      scene('Feedback', [1, 0.2], {
        sustain: { on: 1, mode: SUSTAIN.mix, bloom: 2000 },
        echo: { time: 520, feedback: 45, mix: 30 },
      }),
    ],
  },
  {
    id: 'OX-35',
    name: 'Ducked Solo',
    description:
      'A boosted hot stack: dry and tight for riffs, then sustain, a plate and an echo that stays out of the way until the phrase ends.',
    categories: ['Hard rock'],
    genres: ['Hard rock'],
    techniques: all4,
    engine: 'tone3000-a2-full',
    complexity: 'layered',
    inspiration:
      'Hard rock lead guitar of the 1980s: a boosted stack, long singing notes and an echo mixed so that it only shows in the gaps.',
    performance:
      'Riff is the stack nearly dry. Wide adds a slow flanger for open chords. Lead switches on the sustain, a plate and a ducked echo, with the level lift. Scream lets held notes climb to two octaves. Clean-up backs the amp off with a chorus for the quiet part.',
    before: [
      sustain({ on: 0, drive: 70 }),
      nam('drive-sd1'),
      nam('jcm800-v30'),
    ],
    voices: [voice('Direct'), voice('Octave down', pitch(-12))],
    after: [
      motion({ mode: MOTION.flanger, rate: 0.15, depth: 50, mix: 0 }),
      echo({ mode: ECHO.duck, time: 430, feedback: 35, mod: 70, mix: 0 }),
      bloom({ mode: BLOOM.room, decay: 0.6, mix: 10 }),
    ],
    scenes: [
      scene('Riff', [1, 0]),
      scene('Wide', [1, 0], { motion: { mix: 40 } }),
      lead('Lead', [1, 0], {
        sustain: { on: 1 },
        echo: { mix: 28 },
        bloom: { mode: BLOOM.plate, decay: 2.2, predelay: 70, mix: 22 },
      }),
      scene('Scream', [1, 0], {
        sustain: {
          on: 1,
          mode: SUSTAIN.mix,
          harmonic: TWO_OCTAVES,
          bloom: 1500,
        },
        echo: { mix: 24 },
        bloom: { mode: BLOOM.plate, decay: 2.2, predelay: 70, mix: 20 },
      }),
      scene('Clean-up', [0.3, 0], {
        motion: { mode: MOTION.chorus, rate: 0.6, mix: 45 },
        bloom: { mode: BLOOM.hall, decay: 2, mix: 20 },
      }),
    ],
  },
  {
    id: 'OX-36',
    name: 'Iron Gate',
    description:
      'A boosted modern high-gain amp kept dry for fast riffs, with a gated burst of reverb for stabs and a sustained, ducked-echo lead.',
    categories: ['Modern metal', 'Hard rock'],
    genres: ['Modern metal'],
    techniques: all4,
    engine: 'hybrid',
    complexity: 'layered',
    inspiration:
      'Modern metal production from the 2000s onward: a tight boosted high-gain amp with almost no ambience on the riffs and a wide, wet lead on top.',
    performance:
      'Riff is the amp almost dry. Stab adds a short burst of reverb that stops dead, for chords with gaps. Lead switches on the sustain, a plate and a ducked echo, with the level lift. Octave holds lead notes at the octave above. Clean-up backs the amp off under a chorus and a hall for intros.',
    before: [sustain({ on: 0, drive: 75 }), drive(), nam('rectifier-2025')],
    voices: [voice('Direct'), voice('Octave down', pitch(-12))],
    after: [
      motion({ mode: MOTION.chorus, rate: 0.5, depth: 40, mix: 0 }),
      echo({ mode: ECHO.duck, time: 400, feedback: 30, mod: 80, mix: 0 }),
      bloom({ mode: BLOOM.room, decay: 0.4, lowcut: 250, mix: 6 }),
    ],
    scenes: [
      scene('Riff', [1, 0]),
      scene('Stab', [1, 0], {
        bloom: { mode: BLOOM.nonlinear, decay: 0.35, mix: 30 },
      }),
      lead('Lead', [1, 0], {
        sustain: { on: 1 },
        echo: { mix: 26 },
        bloom: { mode: BLOOM.plate, decay: 2.4, predelay: 80, mix: 22 },
      }),
      scene('Octave', [1, 0], {
        sustain: { on: 1, mode: SUSTAIN.harmonic },
        echo: { mix: 22 },
        bloom: { mode: BLOOM.plate, decay: 2.4, predelay: 80, mix: 20 },
      }),
      scene('Clean-up', [0.25, 0], {
        motion: { mix: 50 },
        bloom: { mode: BLOOM.hall, decay: 2.5, mix: 24 },
      }),
    ],
  },
  {
    id: 'OX-37',
    name: 'Odd Meter',
    description:
      'A smooth crunch amp with a tempo-locked echo that changes note value by scene, a flanger, a phaser and a sustained lead.',
    categories: ['Progressive'],
    genres: ['Progressive'],
    techniques: [...all4, 'Tempo sync'],
    engine: 'tone3000-a2-lite',
    complexity: 'layered',
    inspiration:
      'Progressive rock of the 1970s and its later revivals: long pieces whose sections each have their own echo pattern and modulation.',
    performance:
      'Set the echo BPM to the piece; it is 120 as shipped. Crunch is the amp with a short room. Dotted adds a dotted-eighth echo for arpeggios. Lead sustains over a quarter-note echo and a plate, with the level lift. Triplets changes the echo to triplets under a slow flanger. Phase is an eight-stage phaser for held chords. Half time is a backwards half-note echo for the strange section.',
    before: [sustain({ on: 0, drive: 65 }), nam('slo-crunch')],
    voices: [voice('Direct'), voice('Octave', pitch(12))],
    after: [
      motion({ mode: MOTION.flanger, rate: 0.2, depth: 55, mix: 0 }),
      echo({
        mode: ECHO.digital,
        sync: 1,
        bpm: 120,
        division: DIV.eighthDotted,
        feedback: 35,
        mix: 0,
      }),
      bloom({ mode: BLOOM.room, decay: 0.9, mix: 14 }),
    ],
    scenes: [
      scene('Crunch', [1, 0]),
      scene('Dotted', [1, 0], { echo: { mix: 30 } }),
      lead('Lead', [1, 0], {
        sustain: { on: 1 },
        echo: { division: DIV.quarter, mix: 26 },
        bloom: { mode: BLOOM.plate, decay: 2.2, mix: 20 },
      }),
      scene('Triplets', [1, 0], {
        motion: { mix: 40 },
        echo: { division: DIV.triplet, feedback: 45, mix: 28 },
      }),
      scene('Phase', [1, 0.2], {
        motion: { mode: MOTION.phaser, shape: 2, rate: 0.25, mix: 50 },
      }),
      scene('Half time', [1, 0], {
        echo: { mode: ECHO.reverse, division: DIV.half, mix: 50 },
        bloom: { mode: BLOOM.hall, decay: 3, mix: 24 },
      }),
    ],
  },
  {
    id: 'OX-38',
    name: 'Tide Wall',
    description:
      'A lightly driven guitar and a swell pad that build from a clean hall to a backwards echo, a cloud, a shimmer and a frozen wall.',
    categories: ['Post-rock', 'Ambient'],
    genres: ['Post-rock'],
    techniques: [...all4, 'Swell'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Instrumental post-rock of the 2000s: a piece that starts with a few clean notes and ends, minutes later, as a wall of held sound.',
    performance:
      'Quiet is the clean start in a hall. Build adds a long echo and a larger space. Lead sustains a tremolo-picked line into a cloud with the level lift. Backwards reverses each phrase under the pad. Shimmer lifts the tail an octave for the peak. Wall freezes the tail that is ringing when you choose it; play over it and leave the scene to let it go.',
    before: [sustain({ on: 0, drive: 70 }), drive()],
    voices: [voice('Direct'), voice('Pad', swell(1400))],
    after: [
      motion({ mode: MOTION.tremolo, rate: 6, depth: 40, mix: 0 }),
      echo({ mode: ECHO.digital, time: 500, feedback: 40, mix: 12 }),
      bloom({ mode: BLOOM.hall, decay: 3, mix: 24 }),
    ],
    scenes: [
      scene('Quiet', [0.6, 0]),
      scene('Build', [1, 0.3], {
        echo: { time: 620, feedback: 50, mix: 28 },
        bloom: { decay: 5, mix: 32 },
      }),
      lead('Lead', [1, 0], {
        sustain: { on: 1 },
        echo: { mix: 24 },
        bloom: { mode: BLOOM.cloud, decay: 10, mix: 40 },
      }),
      scene('Backwards', [0.6, 0.8], {
        echo: { mode: ECHO.reverse, time: 1400, feedback: 30, mix: 60 },
        bloom: { mode: BLOOM.cloud, decay: 12, mix: 45 },
      }),
      scene('Shimmer', [1, 0.5], {
        sustain: { on: 1 },
        bloom: { mode: BLOOM.shimmer, decay: 12, shimmer: 60, mix: 50 },
      }),
      scene('Wall', [1, 0], {
        sustain: { on: 1 },
        bloom: { mode: BLOOM.cloud, decay: 20, mix: 55, freeze: 1 },
      }),
    ],
  },
  {
    id: 'OX-39',
    name: 'Glass Oscillator',
    description:
      'A guitar made to behave like a synthesiser: notes with no pick attack held at a harmonic, a ring effect, a vibrato and a gated reverb.',
    categories: ['Synth', 'Experimental'],
    genres: ['Synth'],
    techniques: all4,
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Guitar synthesisers and synth-pop of the late 1970s and 1980s: steady, organ-like tones with no pick attack, pitch wobble and gated reverb.',
    performance:
      'Play single notes and mute to stop them. Tone holds each note with no pick attack. Fifth holds an octave and a fifth above, like an organ stop. Lead holds the octave with a vibrato and an echo, plus the level lift. Bell multiplies the tone into a clang. Gate adds a burst of reverb that stops dead. Sub adds the octave below.',
    before: [sustain({ dry: 0, drive: 85, tone: 50 }), compressor()],
    voices: [voice('Direct'), voice('Octave down', pitch(-12))],
    after: [
      motion({ mode: MOTION.vibrato, rate: 5, depth: 20, mix: 0 }),
      echo({ mode: ECHO.digital, time: 375, feedback: 35, mix: 0 }),
      bloom({ mode: BLOOM.plate, decay: 1.6, mix: 18 }),
    ],
    scenes: [
      scene('Tone', [1, 0]),
      scene('Fifth', [1, 0], {
        sustain: { mode: SUSTAIN.harmonic, harmonic: OCTAVE_FIFTH },
      }),
      lead('Lead', [1, 0], {
        sustain: { mode: SUSTAIN.harmonic },
        motion: { mix: 100 },
        echo: { mix: 24 },
      }),
      scene('Bell', [1, 0], {
        motion: { mode: MOTION.ring, rate: 2.5, depth: 100, mix: 60 },
      }),
      scene('Gate', [1, 0], {
        bloom: { mode: BLOOM.nonlinear, decay: 0.5, mix: 40 },
      }),
      scene('Sub', [0.8, 0.7]),
    ],
  },
  {
    id: 'OX-40',
    name: 'Low Chorus',
    description:
      'A big clean bass amp with a chorus, a short room that keeps the low notes out of its tail, a dark echo and a sustained scene.',
    categories: ['Bass'],
    genres: ['Bass'],
    techniques: all4,
    engine: 'tone3000-a2-lite',
    complexity: 'simple',
    inspiration:
      'Chorused electric bass of the 1980s: fretless-style lines and picked eighth notes made wide without losing the bottom.',
    performance:
      'Dry is the amp in a short room. Chorus widens it for melodic parts. Lead holds notes for a singing fretless-style line, with the level lift. Phase is a slow four-stage phaser for a funk part. Dub is a dark echo for sparse lines. The reverb and room keep bass out of the tail, so the low end stays in the centre.',
    before: [sustain({ on: 0, drive: 55, tone: 40 }), nam('svt-head')],
    voices: [voice('Direct'), voice('Octave', pitch(12))],
    after: [
      motion({ mode: MOTION.chorus, rate: 0.5, depth: 40, mix: 0 }),
      echo({ mode: ECHO.bucket, time: 360, feedback: 30, mix: 0 }),
      bloom({ mode: BLOOM.room, decay: 0.5, lowcut: 300, mix: 12 }),
    ],
    scenes: [
      scene('Dry', [1, 0]),
      scene('Chorus', [1, 0], { motion: { mix: 40 } }),
      lead('Lead', [1, 0.15], {
        sustain: { on: 1 },
        motion: { mix: 30 },
      }),
      scene('Phase', [1, 0], {
        motion: { mode: MOTION.phaser, rate: 0.3, depth: 60, mix: 40 },
      }),
      scene('Dub', [1, 0], { echo: { mix: 24 } }),
    ],
  },
  {
    id: 'OX-41',
    name: 'Warped Cassette',
    description:
      'A clean guitar that sounds like an old tape: a wavering pitch, a worn tape echo and a small dark room.',
    categories: ['Lo-fi', 'Ambient'],
    genres: ['Lo-fi'],
    techniques: ['Motion', 'Echo', 'Bloom', 'Swell', 'Scene settings'],
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Home recordings on worn cassette from the 1980s and the lo-fi styles that copy them: unsteady pitch, dull highs and an echo that smears.',
    performance:
      'Warble is the clean with a slow pitch waver in a dark room. Worn adds an aged tape echo. Lead is a steadier, drifting vibrato with a louder echo and the level lift. Seasick deepens the waver. Dusty swaps to a noisy, dark analogue-style echo under the pad.',
    before: [compressor()],
    voices: [voice('Direct'), voice('Pad', swell(1000))],
    after: [
      motion({
        mode: MOTION.vibrato,
        rate: 1.2,
        depth: 20,
        tone: 35,
        mix: 100,
      }),
      echo({
        mode: ECHO.tape,
        time: 340,
        feedback: 35,
        age: 85,
        mod: 60,
        tone: 30,
        mix: 0,
      }),
      bloom({ mode: BLOOM.room, decay: 0.8, tone: 30, mix: 15 }),
    ],
    scenes: [
      scene('Warble', [1, 0]),
      scene('Worn', [1, 0], { echo: { mix: 26 } }),
      lead('Lead', [1, 0], {
        motion: { shape: 2, depth: 15 },
        echo: { time: 420, mix: 30 },
      }),
      scene('Seasick', [1, 0], {
        motion: { rate: 0.7, depth: 45 },
        echo: { mix: 20 },
      }),
      scene('Dusty', [0.6, 0.7], {
        echo: { mode: ECHO.bucket, time: 600, feedback: 45, age: 80, mix: 32 },
      }),
    ],
  },
  {
    id: 'OX-42',
    name: 'Bell Machine',
    description:
      'A guitar pushed away from sounding like one: ring clang, held high harmonics, a filter echo that feeds itself and a backwards reverb.',
    categories: ['Experimental', 'Synth'],
    genres: ['Experimental'],
    techniques: all4,
    engine: 'lv2',
    complexity: 'layered',
    inspiration:
      'Experimental and noise guitar from the 1980s onward: the instrument used as a sound source for clangs, drones and textures rather than chords.',
    performance:
      'Clang is a ring effect over the dry guitar. Drone holds each note two octaves up with no pick attack. Lead is a square-carrier ring with a filter echo and the level lift. Backwards turns each hit into a rising burst. Spiral lets the filter echo feed itself; change scene to stop it. Chime holds an octave and a fifth over four echo heads.',
    before: [sustain({ on: 0, drive: 85 }), compressor()],
    voices: [voice('Direct'), voice('Octave', pitch(12))],
    after: [
      motion({ mode: MOTION.ring, rate: 2, depth: 100, mix: 50 }),
      echo({ mode: ECHO.filter, time: 450, feedback: 50, mod: 70, mix: 0 }),
      bloom({ mode: BLOOM.plate, decay: 1.8, mix: 18 }),
    ],
    scenes: [
      scene('Clang', [1, 0]),
      scene('Drone', [1, 0], {
        sustain: {
          on: 1,
          dry: 0,
          mode: SUSTAIN.harmonic,
          harmonic: TWO_OCTAVES,
        },
        motion: { mix: 0 },
      }),
      lead('Lead', [1, 0.2], {
        motion: { shape: 1, rate: 3, mix: 45 },
        echo: { mix: 26 },
      }),
      scene('Backwards', [1, 0], {
        bloom: {
          mode: BLOOM.nonlinear,
          shape: REVERSE_SHAPE,
          decay: 1,
          mix: 55,
        },
      }),
      scene('Spiral', [1, 0], {
        motion: { mix: 30 },
        echo: { feedback: 103, mix: 40 },
      }),
      scene('Chime', [1, 0.3], {
        sustain: {
          on: 1,
          mode: SUSTAIN.harmonic,
          harmonic: OCTAVE_FIFTH,
        },
        motion: { mix: 0 },
        echo: { mode: ECHO.heads, time: 640, spacing: 100, mix: 30 },
      }),
    ],
  },
];

/**
 * One setup for every genre in the fixed list, by id. Three genres point at a
 * sound from the effect groups that already is that setup: Clean (a chorused
 * clean in a hall), Pop (a tempo-locked dotted echo on a plate) and Ambient
 * (a shimmering tail with a held scene).
 */
export const oxidalGenreSet: Record<FactoryGenre, string> = {
  Clean: 'OX-24',
  'Edge of breakup': 'OX-29',
  Funk: 'OX-30',
  Blues: 'OX-31',
  Country: 'OX-32',
  Jazz: 'OX-33',
  Pop: 'OX-14',
  'Classic rock': 'OX-34',
  'Hard rock': 'OX-35',
  'Modern metal': 'OX-36',
  Progressive: 'OX-37',
  Ambient: 'OX-02',
  'Post-rock': 'OX-38',
  Synth: 'OX-39',
  Bass: 'OX-40',
  'Lo-fi': 'OX-41',
  Experimental: 'OX-42',
};

// --- The limit rig ----------------------------------------------------------

const lane = (name: string, pan: number, ...steps: Effect[]): RoutedPath => ({
  name,
  ...(pan ? { pan } : {}),
  steps,
});

/** What each of the eight scenes sets on the four effects. Every scene sets
 * every control listed, so a scene never depends on the one before it. */
const limitSettings: [name: string, controls: SceneSettings][] = [
  [
    'Clean',
    {
      sustain: { on: 0, mode: SUSTAIN.normal, harmonic: 0 },
      motion: { mode: MOTION.chorus, rate: 0.6, shape: 0, fast: 0, mix: 35 },
      echo: { mode: ECHO.digital, time: 380, feedback: 30, mix: 12, hold: 0 },
      bloom: { mode: BLOOM.hall, decay: 2.2, shape: 0, mix: 20, freeze: 0 },
    },
  ],
  [
    'Rhythm',
    {
      sustain: { on: 0, mode: SUSTAIN.normal, harmonic: 0 },
      motion: { mode: MOTION.chorus, rate: 0.6, shape: 0, fast: 0, mix: 0 },
      echo: { mode: ECHO.duck, time: 300, feedback: 25, mix: 15, hold: 0 },
      bloom: { mode: BLOOM.room, decay: 0.9, shape: 0, mix: 15, freeze: 0 },
    },
  ],
  [
    'Lead',
    {
      sustain: { on: 1, mode: SUSTAIN.mix, harmonic: 0 },
      motion: { mode: MOTION.phaser, rate: 0.3, shape: 1, fast: 0, mix: 30 },
      echo: { mode: ECHO.tape, time: 450, feedback: 40, mix: 28, hold: 0 },
      bloom: { mode: BLOOM.plate, decay: 2.4, shape: 0, mix: 24, freeze: 0 },
    },
  ],
  [
    'Ambient',
    {
      sustain: { on: 1, mode: SUSTAIN.normal, harmonic: 0 },
      motion: { mode: MOTION.rotary, rate: 0.7, shape: 0, fast: 0, mix: 60 },
      echo: { mode: ECHO.heads, time: 700, feedback: 45, mix: 32, hold: 0 },
      bloom: { mode: BLOOM.cloud, decay: 14, shape: 0, mix: 50, freeze: 0 },
    },
  ],
  [
    'Tremolo',
    {
      sustain: { on: 0, mode: SUSTAIN.normal, harmonic: 0 },
      motion: { mode: MOTION.harmonic, rate: 4.5, shape: 0, fast: 0, mix: 100 },
      echo: { mode: ECHO.bucket, time: 330, feedback: 30, mix: 20, hold: 0 },
      bloom: { mode: BLOOM.spring, decay: 2.5, shape: 0, mix: 28, freeze: 0 },
    },
  ],
  [
    'Shimmer',
    {
      sustain: { on: 1, mode: SUSTAIN.harmonic, harmonic: 0 },
      motion: { mode: MOTION.vibe, rate: 1.2, shape: 0, fast: 0, mix: 60 },
      echo: { mode: ECHO.ping, time: 520, feedback: 40, mix: 28, hold: 0 },
      bloom: { mode: BLOOM.shimmer, decay: 8, shape: 0, mix: 45, freeze: 0 },
    },
  ],
  [
    'Backwards',
    {
      sustain: { on: 1, mode: SUSTAIN.normal, harmonic: 0 },
      motion: { mode: MOTION.flanger, rate: 0.15, shape: 1, fast: 0, mix: 50 },
      echo: { mode: ECHO.reverse, time: 1200, feedback: 20, mix: 60, hold: 0 },
      bloom: {
        mode: BLOOM.nonlinear,
        decay: 1,
        shape: REVERSE_SHAPE,
        mix: 40,
        freeze: 0,
      },
    },
  ],
  [
    'Frozen',
    {
      sustain: { on: 1, mode: SUSTAIN.mix, harmonic: OCTAVE_FIFTH },
      motion: { mode: MOTION.rotary, rate: 0.7, shape: 0, fast: 1, mix: 70 },
      echo: { mode: ECHO.filter, time: 600, feedback: 55, mix: 30, hold: 0 },
      bloom: { mode: BLOOM.bloom, decay: 30, shape: 0, mix: 60, freeze: 1 },
    },
  ],
];

/** Scene mixes from relative weights: every scene is scaled to the same summed
 * power and the third (the lead) sits about 2 dB above, as in the other
 * routed showcase presets. */
const limitScenes = (weights: number[][]): RecipeScene[] =>
  limitSettings.map(([name, controls], index) => {
    const row = weights[index]!;
    const power = index === 2 ? 1 : 0.64;
    const scale = Math.sqrt(power / row.reduce((sum, w) => sum + w * w, 0));
    return {
      name,
      mix: row.map((w) => Math.round(w * scale * 1000) / 1000),
      controls,
    };
  });

const limitPerformance = (lanes: string) =>
  `${lanes} Clean is the clean amp with a chorus, a light echo and a hall. Rhythm is the stacks, wide, with a ducking echo in a room. Lead sustains each note into its octave through a phaser, a tape echo and a plate. Ambient holds notes through a slow rotary, four echo heads and a cloud. Tremolo is a harmonic tremolo with a dark echo and a spring. Shimmer holds the octave above each note under a rising tail. Backwards reverses each phrase into a reversed burst of reverb. Frozen holds the reverb tail that is ringing when you choose it while the rotary runs fast. Every scene changes the mode of all four effects, so expect a short crossfade.`;

const limitRig = (
  spec: Pick<FactoryRecipe, 'id' | 'name' | 'engine' | 'description'> & {
    lanes: string;
    paths: RoutedPath[];
    weights: number[][];
  },
): FactoryRecipe => ({
  id: spec.id,
  name: spec.name,
  description: spec.description,
  categories: ['Progressive', 'Experimental', 'Parallel routing'],
  genres: ['Progressive', 'Experimental', 'Hard rock'],
  techniques: [
    'Parallel routing',
    'Dual amp',
    'Stereo',
    'Sustain',
    'Motion',
    'Echo',
    'Bloom',
    'Scene settings',
  ],
  engine: spec.engine,
  complexity: 'complex',
  inspiration:
    'The large touring rigs of the 1980s and 1990s: several amplifiers kept running side by side, with a rack of effects re-patched for every section of the set.',
  performance: limitPerformance(spec.lanes),
  topology: 'routed',
  before: [],
  voices: [],
  route: [
    sustain({ on: 0, drive: 65, bloom: 2500 }),
    fx('GxTubeScreamer', { fslider0_: -10, fslider2_: 0.15 }),
    { paths: spec.paths },
  ],
  after: [
    motion({ mode: MOTION.chorus, depth: 55 }),
    echo({ mode: ECHO.digital, age: 40 }),
    bloom({ mode: BLOOM.hall }),
  ],
  scenes: limitScenes(spec.weights),
});

const limitRigs: FactoryRecipe[] = [
  limitRig({
    id: 'OX-LIMIT',
    name: 'Everything On',
    engine: 'hybrid',
    description:
      'The limit rig: a sustainer and a boost into four amps side by side, then modulation, echo and reverb, with eight scenes that change all of them. It uses the whole capture budget at the lighter tone size.',
    lanes:
      'Four amps stay loaded: a clean in the centre, a stack on each side and a smooth lead amp in the centre.',
    paths: [
      lane('Centre clean', 0, nam('jc-clean')),
      lane('Left stack', -0.8, nam('jcm800-v30')),
      lane('Right stack', 0.8, nam('friedman-be100')),
      lane('Lead amp', 0, nam('dumble-ods')),
    ],
    weights: [
      [1, 0, 0, 0],
      [0, 1, 1, 0],
      [0, 0.4, 0.4, 1],
      [1, 0, 0, 0.5],
      [1, 0.3, 0, 0],
      [0.8, 0, 0, 0.7],
      [0.3, 0.8, 0.8, 0],
      [0.7, 0.5, 0.5, 0.7],
    ],
  }),
  limitRig({
    id: 'OX-LIMIT-F',
    name: 'Everything On Full',
    engine: 'hybrid',
    description:
      'The limit rig at the full tone size: a sustainer and a boost into three amps side by side, then modulation, echo and reverb, with eight scenes that change all of them.',
    lanes:
      'Three amps stay loaded: a clean in the centre and a stack on each side.',
    paths: [
      lane('Centre clean', 0, nam('jc-clean')),
      lane('Left stack', -0.8, nam('jcm800-v30')),
      lane('Right stack', 0.8, nam('friedman-be100')),
    ],
    weights: [
      [1, 0, 0],
      [0, 1, 1],
      [0.3, 0.6, 1],
      [1, 0, 0.3],
      [1, 0.3, 0],
      [1, 0.2, 0.2],
      [0.3, 0.8, 0.8],
      [0.8, 0.6, 0.6],
    ],
  }),
];

/** The ids of the two limit rigs. */
export const oxidalLimitRigIds = ['OX-LIMIT', 'OX-LIMIT-F'] as const;

/** The six sounds built around each effect, by id. */
export const oxidalEffectsFeatured: Record<OxidalFeaturedEffect, string[]> = {
  Bloom: bloomSounds.map((r) => r.id),
  Sustain: sustainSounds.map((r) => r.id),
  Echo: echoSounds.map((r) => r.id),
  Motion: motionSounds.map((r) => r.id),
};

export const oxidalEffectsShowcaseRecipes: FactoryRecipe[] = [
  ...bloomSounds,
  ...sustainSounds,
  ...echoSounds,
  ...motionSounds,
  ...serviceSounds,
  ...rhythmLeadSounds,
  ...genreSounds,
  ...limitRigs,
];

/**
 * The Oxidal effects set list, in a playable order: the limit rig first, then
 * sounds for each effect. Apart from the limit rig, every entry is LV2-only
 * and uses no captures, so it plays as soon as its effect packs are installed.
 * The limit rig needs four tones from the player's TONE3000 account.
 */
export const oxidalEffectsSetList = [
  'OX-LIMIT', // Everything On: all four effects
  'OX-01', // Eight Rooms: Bloom
  'OX-07', // Endless Bow: Sustain
  'OX-14', // Dotted Clock: Echo
  'OX-19', // Eight Motions: Motion
  'OX-13', // Tape Loop Diary: Echo
  'OX-02', // Glass Ceiling: Bloom
] as const;

/**
 * A set list for a service, built around the service rig: the rig itself, a
 * sustained clean, an ambient pad sound and a lead sound. Glass Ceiling uses
 * no captures; the others need tones at the lighter size.
 */
export const oxidalWorshipSetList = [
  'OX-25', // Sunday Morning: the service rig
  'OX-11', // Infinite Clean: clean
  'OX-02', // Glass Ceiling: ambient pad
  'OX-10', // Violin Lead: lead
] as const;
