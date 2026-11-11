import {
  nam,
  voice,
  type FactoryRecipe,
  type Voice,
} from '../factoryRecipes.ts';
import type { FactoryGenre } from '../factoryMetadata.ts';

/**
 * TONE3000 showcase presets, captures only. Every preset names Oxidal voices
 * (see `factoryVoices.ts`) and never carries a capture, an IR or a model file:
 * the player installs the tones with their own TONE3000 account. No LV2 blocks
 * appear here, so a scene can only change how hard each preloaded capture is
 * driven and how loud the preset is. The send gains ahead of a capture act as
 * the drive control; the scene level is the output trim. Levels are provisional
 * until the owner's listening pass on the Pi.
 *
 * Capture budget at the owner's 96-frame stream (provisional until WP-X
 * measures it): A2 Lite up to 3 distinct captures, A2 Full up to 2. Cabinet IRs
 * do not count as captures.
 *
 * @see docs/factory-collection.md
 */

/** Distinct captures a preset of each tier may keep loaded (provisional). */
export const tone3000CaptureBudget = {
  'tone3000-a2-lite': 3,
  'tone3000-a2-full': 2,
} as const;

type Tier = keyof typeof tone3000CaptureBudget;
/** One scene: name, send gain into each voice, and output level. */
type Scene = [name: string, mix: number[], level?: number];

type Spec = {
  id: string;
  name: string;
  tier: Tier;
  genres: FactoryGenre[];
  categories: string[];
  techniques?: string[];
  complexity: FactoryRecipe['complexity'];
  description: string;
  inspiration: string;
  performance: string;
  voices: Voice[];
  scenes: Scene[];
};

function recipe(spec: Spec): FactoryRecipe {
  return {
    id: spec.id,
    name: spec.name,
    description: spec.description,
    categories: spec.categories,
    genres: spec.genres,
    ...(spec.techniques ? { techniques: spec.techniques } : {}),
    engine: spec.tier,
    complexity: spec.complexity,
    inspiration: spec.inspiration,
    performance: spec.performance,
    before: [],
    voices: spec.voices,
    after: [],
    scenes: spec.scenes.map(([name, mix, level]) => ({
      name,
      mix,
      level: level ?? 1,
    })),
  };
}

const lite = (spec: Omit<Spec, 'tier'>) =>
  recipe({ ...spec, tier: 'tone3000-a2-lite' });
const full = (spec: Omit<Spec, 'tier'>) =>
  recipe({ ...spec, tier: 'tone3000-a2-full' });

const dryNote =
  ' Scenes change drive and level only; add effects in the rig if you want space.';

export const tone3000ShowcaseRecipes: FactoryRecipe[] = [
  // ---- A2 Lite: up to three captures, four prepared scenes fit a Pi. ----
  lite({
    id: 'A2L-01',
    name: 'Bell Clean',
    description:
      'A bell-like studio clean from one capture. Scenes change how hard the amp is pushed.',
    categories: ['Clean', 'Pop', 'TONE3000'],
    genres: ['Clean', 'Pop'],
    complexity: 'simple',
    inspiration:
      'Open, bell-like blackface-style cleans from 1960s studio sessions, with a soft top end and plenty of headroom.',
    performance:
      'Start on Clean for chords and arpeggios. Push thickens the same amp for rhythm, Lead adds the one deliberate level lift, and Hush pulls everything down for quiet verses.',
    voices: [voice('Bell', nam('blackface-clean'))],
    scenes: [
      ['Clean', [0.4], 1.7],
      ['Push', [0.65], 1.35],
      ['Lead', [1], 1.5],
      ['Hush', [0.22], 2.3],
    ],
  }),
  lite({
    id: 'A2L-02',
    name: 'Flat Sixteenths',
    description:
      'A flat, fast solid-state clean from one capture, built for muted sixteenth-note rhythm.',
    categories: ['Funk', 'Pop', 'TONE3000'],
    genres: ['Funk', 'Pop'],
    complexity: 'simple',
    inspiration:
      'Fast, flat solid-state cleans from 1970s funk and 1980s new wave, where every muted note has to land cleanly.',
    performance:
      'Clean is the default groove sound. Tight backs off the input for the tightest muted parts, Lead adds a boosted single-note level, and Soft sits under a vocal.',
    voices: [voice('Flat', nam('jc-clean'))],
    scenes: [
      ['Clean', [0.7], 1.2],
      ['Tight', [0.45], 1.6],
      ['Lead', [1], 1.35],
      ['Soft', [0.3], 2],
    ],
  }),
  lite({
    id: 'A2L-03',
    name: 'Chime',
    description:
      'A chiming, jangly combo at the edge of breakup from one capture.',
    categories: ['Edge of breakup', 'Pop', 'TONE3000'],
    genres: ['Edge of breakup', 'Pop'],
    complexity: 'simple',
    inspiration:
      'Chiming top-boost combos from 1960s British beat groups and 1980s arena pop, bright and a little gritty when played hard.',
    performance:
      'Chime is the open strummed sound. Grit digs in for choruses, Lead pushes the amp into singing breakup, and Soft leaves the edge off for intros.',
    voices: [voice('Chime', nam('ac30-chime'))],
    scenes: [
      ['Chime', [0.55], 1.5],
      ['Grit', [0.8], 1.3],
      ['Lead', [1], 1.45],
      ['Soft', [0.3], 2.1],
    ],
  }),
  lite({
    id: 'A2L-04',
    name: 'Texas Edge',
    description:
      'A clean combo with a mid-pushed overdrive in front. Both paths stay loaded, so scene changes never reload a capture.',
    categories: ['Blues', 'Edge of breakup', 'TONE3000'],
    genres: ['Blues'],
    techniques: ['Dual amp'],
    complexity: 'layered',
    inspiration:
      'Texas blues of the 1980s: a loud, open four-by-ten clean that turns fat and singing when a mid-pushed overdrive hits it.',
    performance:
      'Clean is the bare amp. Edge adds the overdrive for rhythm, Lead is the same chain pushed harder and louder, and Fat blends the clean and driven paths for a thicker comping tone.' +
      dryNote,
    voices: [
      voice('Clean', nam('super-reverb-77')),
      voice('Pedal and amp', nam('drive-ts9'), nam('super-reverb-77')),
    ],
    scenes: [
      ['Clean', [0.75, 0], 1.4],
      ['Edge', [0, 0.6], 1.5],
      ['Lead', [0, 1], 1.45],
      ['Fat', [0.35, 0.45], 1.6],
    ],
  }),
  lite({
    id: 'A2L-05',
    name: 'Smooth Lead',
    description:
      'A smooth, singing overdrive amp through a combo cabinet impulse, with a transparent drive in front for solos.',
    categories: ['Blues', 'Jazz', 'TONE3000'],
    genres: ['Blues', 'Jazz'],
    techniques: ['Dual amp'],
    complexity: 'layered',
    inspiration:
      'West-coast fusion-blues of the 1980s: a round, vocal overdrive that sustains without getting harsh.',
    performance:
      'Clean is the amp alone. Sing adds the drive for fills, Lead pushes the drive hardest for sustained notes, and Slow backs off to a gentle, rounded rhythm tone.',
    voices: [
      voice('Amp', nam('dumble-ods'), nam('ir-deluxe')),
      voice('Drive', nam('drive-kot'), nam('dumble-ods'), nam('ir-deluxe')),
    ],
    scenes: [
      ['Clean', [0.7, 0], 1.4],
      ['Sing', [0, 0.55], 1.5],
      ['Lead', [0, 1], 1.4],
      ['Slow', [0.35, 0], 1.9],
    ],
  }),
  lite({
    id: 'A2L-06',
    name: 'Raw Fifty',
    description:
      'A raw, open fifty-watt stack sound from one capture. Scenes change how hard the amp is driven.',
    categories: ['Classic rock', 'TONE3000'],
    genres: ['Classic rock'],
    complexity: 'simple',
    inspiration:
      'Late-1960s and 1970s stadium rock: a loud, open, dynamic crunch that responds to the pick and the guitar volume.',
    performance:
      'Rhythm is a loose, open chord sound. Crunch leans in for riffs, Lead adds the level lift for solos, and Roar drives the amp as hard as it goes.',
    voices: [voice('Stack', nam('plexi-crunch'))],
    scenes: [
      ['Rhythm', [0.5], 1.5],
      ['Crunch', [0.75], 1.3],
      ['Lead', [1], 1.5],
      ['Roar', [1], 1.2],
    ],
  }),
  lite({
    id: 'A2L-07',
    name: 'Tight Rhythm',
    description:
      'A boosted hard-rock stack: the amp alone for rhythm, the boost in front for tighter riffs and leads.',
    categories: ['Hard rock', 'TONE3000'],
    genres: ['Hard rock'],
    techniques: ['Dual amp'],
    complexity: 'layered',
    inspiration:
      '1980s hard rock and early thrash: a tight, boosted rhythm tone with a mid-forward bite.',
    performance:
      'Rhythm is the amp alone for open chords. Boost adds the pedal for palm-muted riffs, Lead is the boosted path with the level lift, and Clean-up backs off the input for a cleaner break.' +
      dryNote,
    voices: [
      voice('Amp', nam('jcm800-v30')),
      voice('Boosted', nam('drive-sd1'), nam('jcm800-v30')),
    ],
    scenes: [
      ['Rhythm', [0.9, 0], 1.3],
      ['Boost', [0, 0.65], 1.3],
      ['Lead', [0, 1], 1.4],
      ['Clean-up', [0.3, 0], 1.9],
    ],
  }),
  lite({
    id: 'A2L-08',
    name: 'Session Lead',
    description:
      'Dense crunch and a creamy lead from one amp capture, changed by how hard the input is driven.',
    categories: ['Hard rock', 'TONE3000'],
    genres: ['Hard rock', 'Classic rock'],
    complexity: 'simple',
    inspiration:
      'Late-1980s session leads: a dense, articulate crunch that opens into a smooth, creamy sustain.',
    performance:
      'Crunch is the starting rhythm sound. Rhythm tucks in for chugging verses, Lead lifts the level for solos, and Cream drives the amp into its smoothest sustain.',
    voices: [voice('Amp', nam('slo-crunch'))],
    scenes: [
      ['Crunch', [0.6], 1.4],
      ['Rhythm', [0.45], 1.6],
      ['Lead', [1], 1.5],
      ['Cream', [0.85], 1.4],
    ],
  }),
  lite({
    id: 'A2L-09',
    name: 'Wall',
    description:
      'An aggressive, saturated high-gain rig with its own cabinet, from one capture.',
    categories: ['Modern metal', 'TONE3000'],
    genres: ['Modern metal'],
    complexity: 'simple',
    inspiration:
      'Metalcore and death metal of the 2000s: a saturated, aggressive rhythm with a hard-hitting low end.',
    performance:
      'Rhythm is the full wall of gain. Tight backs off the input to keep fast palm mutes clear, Lead adds the level lift for solos, and Chug is the hardest-driven setting for slow breakdowns.',
    voices: [voice('Rig', nam('peavey-5150-rig'))],
    scenes: [
      ['Rhythm', [0.8], 1.3],
      ['Tight', [0.55], 1.5],
      ['Lead', [1], 1.45],
      ['Chug', [1], 1.2],
    ],
  }),
  lite({
    id: 'A2L-10',
    name: 'Scooped',
    description:
      'A scooped high-gain head through an oversized cabinet impulse, with a tight boost in front.',
    categories: ['Modern metal', 'TONE3000'],
    genres: ['Modern metal', 'Hard rock'],
    techniques: ['Dual amp'],
    complexity: 'layered',
    inspiration:
      '1990s and 2000s alternative metal: a scooped, heavy wall of sound that the boost pulls into focus.',
    performance:
      'Rhythm is the head on its own. Boost adds the pedal for tight, fast riffs, Lead uses the boosted path with the level lift, and Clean backs the input off for a cleaner break.',
    voices: [
      voice('Head', nam('rectifier-2025'), nam('ir-mesa-os')),
      voice(
        'Boosted',
        nam('drive-fortin'),
        nam('rectifier-2025'),
        nam('ir-mesa-os'),
      ),
    ],
    scenes: [
      ['Rhythm', [0.85, 0], 1.3],
      ['Boost', [0, 0.65], 1.3],
      ['Lead', [0, 1], 1.4],
      ['Clean', [0.25, 0], 2.2],
    ],
  }),
  lite({
    id: 'A2L-11',
    name: 'Low Tuned',
    description:
      'A tight, percussive head for low-tuned rhythm through an oversized cabinet impulse, with a boost in front.',
    categories: ['Progressive', 'Modern metal', 'TONE3000'],
    genres: ['Progressive', 'Modern metal'],
    techniques: ['Dual amp'],
    complexity: 'layered',
    inspiration:
      'Progressive metal of the 2010s: tight, percussive low-tuned rhythm with a clear attack on every note.',
    performance:
      'Rhythm is the head alone for open riffs. Tight adds the boost to keep palm mutes focused, Lead is the boosted path with the level lift, and Soft clean pulls the input far back for a quiet, open break.',
    voices: [
      voice('Head', nam('badlander-head'), nam('ir-mesa-os')),
      voice(
        'Boosted',
        nam('drive-fortin'),
        nam('badlander-head'),
        nam('ir-mesa-os'),
      ),
    ],
    scenes: [
      ['Rhythm', [0.85, 0], 1.3],
      ['Tight', [0, 0.65], 1.3],
      ['Lead', [0, 1], 1.4],
      ['Soft clean', [0.2, 0], 2.3],
    ],
  }),
  lite({
    id: 'A2L-12',
    name: 'Round Bass',
    description:
      'A round tube bass head through an eight-by-ten cabinet impulse, with a gritty driver in front for heavier parts.',
    categories: ['Bass', 'TONE3000'],
    genres: ['Bass', 'Classic rock'],
    techniques: ['Dual amp'],
    complexity: 'layered',
    inspiration:
      'Rock bass from the 1970s to the 1990s: a round, full tube tone with a gritty top when the part needs weight.',
    performance:
      'Clean is the amp on its own for fingerstyle lines. Grit adds the driver for rock parts, Solo is the driven path with the level lift, and Sub pulls the input back for a deep, clean low end.',
    voices: [
      voice('Clean', nam('svt-head'), nam('ir-ampeg-810')),
      voice(
        'Gritty',
        nam('drive-sansamp'),
        nam('svt-head'),
        nam('ir-ampeg-810'),
      ),
    ],
    scenes: [
      ['Clean', [0.8, 0], 1.3],
      ['Grit', [0, 0.65], 1.3],
      ['Solo', [0, 1], 1.4],
      ['Sub', [0.4, 0], 1.7],
    ],
  }),
  lite({
    id: 'A2L-13',
    name: 'Twang',
    description:
      'A snappy country clean: the amp alone, or a light overdrive pushing it for a little more twang.',
    categories: ['Country', 'Clean', 'TONE3000'],
    genres: ['Country', 'Clean'],
    techniques: ['Dual amp'],
    complexity: 'layered',
    inspiration:
      'Modern Nashville session cleans: bright, snappy and compressed under the pick, with a light push for fills and solos.',
    performance:
      'Clean is the amp for chicken-picked rhythm. Push adds the light overdrive for fills, Lead is the pushed path with the level lift, and Fat blends both for a rounder double-stop tone.' +
      dryNote,
    voices: [
      voice('Clean', nam('blackface-clean')),
      voice('Pushed', nam('drive-morning-glory'), nam('blackface-clean')),
    ],
    scenes: [
      ['Clean', [0.7, 0], 1.45],
      ['Push', [0, 0.55], 1.5],
      ['Lead', [0, 1], 1.4],
      ['Fat', [0.35, 0.4], 1.6],
    ],
  }),
  lite({
    id: 'A2L-14',
    name: 'Soft Hollow',
    description:
      'A warm, round solid-state jazz clean from one capture, with a bright scene for single-note lines.',
    categories: ['Jazz', 'Clean', 'TONE3000'],
    genres: ['Jazz', 'Clean'],
    complexity: 'simple',
    inspiration:
      'Intimate jazz chord playing of the 1950s and 1960s: a warm, round tone with a rolled-off top end.',
    performance:
      'Chords is the warm default for comping. Bright opens the input for single-note melody lines, Lead lifts the level for solos, and Hush tucks everything under a quiet trio.',
    voices: [voice('Warm', nam('polytone-jazz'))],
    scenes: [
      ['Chords', [0.55], 1.5],
      ['Bright', [0.8], 1.3],
      ['Lead', [1], 1.35],
      ['Hush', [0.25], 2.1],
    ],
  }),
  lite({
    id: 'A2L-15',
    name: 'Still Water',
    description:
      'A shimmering class-A-style combo for clean, spacious post-rock and ambient guitar, ready for your own effects.',
    categories: ['Ambient', 'Post-rock', 'TONE3000'],
    genres: ['Ambient', 'Post-rock'],
    complexity: 'simple',
    inspiration:
      'Post-rock and worship guitar of the 2000s: a shimmering clean combo that holds up under long delays and reverbs added after it.',
    performance:
      'Clean is the open bed for arpeggios. Warm leans the amp in for fuller chords, Lead lifts the level for a melody line, and Hush is a quiet, gentle voice for the start of a build.',
    voices: [voice('Combo', nam('match-brave'))],
    scenes: [
      ['Clean', [0.5], 1.5],
      ['Warm', [0.7], 1.35],
      ['Lead', [1], 1.4],
      ['Hush', [0.25], 2.1],
    ],
  }),

  // ---- A2 Full: up to two captures, fewer simultaneous instances. ----
  full({
    id: 'A2F-01',
    name: 'Grand Bell',
    description:
      'The bell-like studio clean at A2 Full: one capture, with scenes that change how hard it is pushed.',
    categories: ['Clean', 'Pop', 'TONE3000'],
    genres: ['Clean', 'Pop'],
    complexity: 'simple',
    inspiration:
      'Open, bell-like blackface-style cleans from 1960s studio sessions, at full A2 detail for a clearer top end.',
    performance:
      'Clean for chords and arpeggios, Push for fuller rhythm, Lead with the one deliberate level lift, and Hush for quiet passages.',
    voices: [voice('Bell', nam('blackface-clean'))],
    scenes: [
      ['Clean', [0.4], 1.7],
      ['Push', [0.65], 1.35],
      ['Lead', [1], 1.5],
      ['Hush', [0.22], 2.3],
    ],
  }),
  full({
    id: 'A2F-02',
    name: 'Open Glass',
    description:
      'A wide, glassy boutique clean with deep headroom, from one A2 Full capture.',
    categories: ['Clean', 'Pop', 'TONE3000'],
    genres: ['Clean', 'Blues'],
    complexity: 'simple',
    inspiration:
      '2000s boutique blues-pop cleans: wide, glassy and clear, with enough headroom that pedals stay in charge.',
    performance:
      'Clean is the default. Warm leans in for fuller chords, Lead adds the level lift for melodies, and Hush sits under a vocal.',
    voices: [voice('Glass', nam('two-rock-clean'))],
    scenes: [
      ['Clean', [0.5], 1.5],
      ['Warm', [0.7], 1.35],
      ['Lead', [1], 1.4],
      ['Hush', [0.25], 2.1],
    ],
  }),
  full({
    id: 'A2F-03',
    name: 'Muted Hands',
    description:
      'A flat, fast solid-state clean at A2 Full for muted sixteenths and scratchy chords.',
    categories: ['Funk', 'Pop', 'TONE3000'],
    genres: ['Funk', 'Pop'],
    complexity: 'simple',
    inspiration:
      '1970s funk and 1980s new wave rhythm guitar: a flat, bright clean that keeps every muted note short and clear.',
    performance:
      'Clean is the groove sound. Tight backs the input off for muted parts, Lead adds the level lift for single-note lines, and Soft sits under the band.',
    voices: [voice('Flat', nam('jc-clean'))],
    scenes: [
      ['Clean', [0.7], 1.2],
      ['Tight', [0.45], 1.6],
      ['Lead', [1], 1.35],
      ['Soft', [0.3], 2],
    ],
  }),
  full({
    id: 'A2F-04',
    name: 'Cobalt Edge',
    description:
      'A clean that barks when dug into, with a light boost in front. Two captures, both loaded, so scene changes never reload.',
    categories: ['Blues', 'Edge of breakup', 'TONE3000'],
    genres: ['Blues', 'Edge of breakup'],
    techniques: ['Dual amp'],
    complexity: 'layered',
    inspiration:
      'Texas blues of the 1980s: a clean four-by-ten that barks when played hard and sings when a light boost hits it.',
    performance:
      'Clean is the bare amp. Edge adds the boost for rhythm, Lead is the boosted path pushed harder with the level lift, and Fat blends both paths for thick comping.' +
      dryNote,
    voices: [
      voice('Clean', nam('super-reverb-65')),
      voice('Boosted', nam('drive-centaur'), nam('super-reverb-65')),
    ],
    scenes: [
      ['Clean', [0.75, 0], 1.4],
      ['Edge', [0, 0.55], 1.5],
      ['Lead', [0, 1], 1.4],
      ['Fat', [0.35, 0.4], 1.6],
    ],
  }),
  full({
    id: 'A2F-05',
    name: 'Vocal Crunch',
    description:
      'A thick, vocal combo crunch from one A2 Full capture, with scenes that change how hard it is driven.',
    categories: ['Blues', 'Classic rock', 'TONE3000'],
    genres: ['Blues', 'Classic rock'],
    complexity: 'simple',
    inspiration:
      'British blues of the mid-1960s: a thick, vocal combo crunch where the guitar tone sustains by itself.',
    performance:
      'Rhythm is a loose crunch for chords. Crunch leans in for riffs, Lead adds the level lift and the hardest drive, and Hush drops to a quiet clean-ish edge.',
    voices: [voice('Combo', nam('bluesbreaker-crunch'))],
    scenes: [
      ['Rhythm', [0.55], 1.5],
      ['Crunch', [0.75], 1.3],
      ['Lead', [1], 1.5],
      ['Hush', [0.28], 2],
    ],
  }),
  full({
    id: 'A2F-06',
    name: 'Stage Fifty',
    description:
      'A raw, open fifty-watt stack sound at A2 Full, with a dynamic response from one capture.',
    categories: ['Classic rock', 'TONE3000'],
    genres: ['Classic rock', 'Hard rock'],
    complexity: 'simple',
    inspiration:
      'Late-1960s and 1970s stadium rock: a loud, open and dynamic crunch that cleans up when you play softer.',
    performance:
      'Rhythm is open and loose. Crunch leans in for riffs, Lead adds the level lift for solos, and Roar drives the amp as hard as it goes.',
    voices: [voice('Stack', nam('plexi-crunch'))],
    scenes: [
      ['Rhythm', [0.5], 1.5],
      ['Crunch', [0.75], 1.3],
      ['Lead', [1], 1.5],
      ['Roar', [1], 1.2],
    ],
  }),
  full({
    id: 'A2F-07',
    name: 'Hot Wire',
    description:
      'A hot-rodded British-style stack with tight, modern gain, from one A2 Full capture.',
    categories: ['Hard rock', 'TONE3000'],
    genres: ['Hard rock', 'Modern metal'],
    complexity: 'simple',
    inspiration:
      'Modern hot-rodded British stacks from the 2000s: tight, articulate gain that stays clear in fast chords.',
    performance:
      'Rhythm is a tight chord sound. Tight backs the input off for muted riffs, Lead adds the level lift for solos, and Clean-up eases the drive for a cleaner section.',
    voices: [voice('Stack', nam('friedman-be100'))],
    scenes: [
      ['Rhythm', [0.75], 1.35],
      ['Tight', [0.55], 1.5],
      ['Lead', [1], 1.4],
      ['Clean-up', [0.25], 2.2],
    ],
  }),
  full({
    id: 'A2F-08',
    name: 'Tight Meridian',
    description:
      'A tight, mid-forward high-gain amp for progressive riffs, from one A2 Full capture.',
    categories: ['Progressive', 'Modern metal', 'TONE3000'],
    genres: ['Progressive', 'Modern metal'],
    complexity: 'simple',
    inspiration:
      'Progressive metal of the 2010s: tight, mid-forward gain with clear articulation in odd-meter riffs.',
    performance:
      'Rhythm is the full tight riff sound. Tight backs the input off for fast mutes, Lead adds the level lift for melodic lines, and Soft clean lowers the drive for a quiet passage.',
    voices: [voice('Amp', nam('vh4-high'))],
    scenes: [
      ['Rhythm', [0.8], 1.3],
      ['Tight', [0.55], 1.5],
      ['Lead', [1], 1.4],
      ['Soft clean', [0.2], 2.4],
    ],
  }),
  full({
    id: 'A2F-09',
    name: 'Steel Wall',
    description:
      'A three-channel modern metal rig with its own cabinet, from one A2 Full capture.',
    categories: ['Modern metal', 'TONE3000'],
    genres: ['Modern metal'],
    complexity: 'simple',
    inspiration:
      'Modern metal of the 2000s and 2010s: a hard, clear wall of gain with a controlled low end.',
    performance:
      'Rhythm is the full wall. Tight backs the input off to keep fast mutes clear, Lead adds the level lift for solos, and Chug drives the rig hardest for slow breakdowns.',
    voices: [voice('Rig', nam('stealth-5150-rig'))],
    scenes: [
      ['Rhythm', [0.8], 1.3],
      ['Tight', [0.55], 1.5],
      ['Lead', [1], 1.4],
      ['Chug', [1], 1.2],
    ],
  }),
  full({
    id: 'A2F-10',
    name: 'Clear Low',
    description:
      'A modern driven bass with a tight, clear low end, from one A2 Full capture.',
    categories: ['Bass', 'TONE3000'],
    genres: ['Bass', 'Modern metal'],
    complexity: 'simple',
    inspiration:
      'Modern rock and metal bass of the 2000s: a driven tone with a tight low end that stays clear under heavy guitars.',
    performance:
      'Clean is the base sound. Grit drives the amp for heavier parts, Solo adds the level lift for melodic lines, and Sub pulls the input back for a deep, clean low end.',
    voices: [voice('Rig', nam('darkglass-rig'))],
    scenes: [
      ['Clean', [0.5], 1.6],
      ['Grit', [0.8], 1.3],
      ['Solo', [1], 1.4],
      ['Sub', [0.3], 2],
    ],
  }),
];
