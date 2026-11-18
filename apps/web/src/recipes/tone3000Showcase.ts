import type { FactoryGenre } from '../factoryMetadata.ts';
import {
  type Effect,
  type FactoryRecipe,
  nam,
  type RoutedPath,
  type RoutedStep,
  type Voice,
  voice,
} from '../factoryRecipes.ts';

/**
 * TONE3000 showcase presets, captures only. Every preset names Oxidal voices
 * (see `factoryVoices.ts`) and never carries a capture, an IR or a model file:
 * the player installs the tones with their own TONE3000 account. No LV2 blocks
 * appear here, so a scene can only change how hard each preloaded capture is
 * driven and how loud the preset is. The send gains ahead of a capture act as
 * the drive control; the scene level is the output trim. Presets built from
 * `paths` instead keep every path playing and mix them after the captures, so
 * their scenes are true blends, with pan. Levels are provisional until the
 * owner's listening pass on the Pi.
 *
 * Capture budget at 96 frames, measured on a Pi 5 (docs/capacity.md): A2 Lite
 * up to 4 NAM instances, A2 Full up to 3. Each capture block is an instance,
 * even when two paths share a capture; cabinet IRs do not count.
 *
 * @see docs/factory-collection.md
 */

/** NAM instances a preset of each tier may keep loaded at 96 frames; the
 * Library's capture budget (docs/capacity.md). */
export const tone3000CaptureBudget = {
  'tone3000-a2-lite': 4,
  'tone3000-a2-full': 3,
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
  /** Voices driven by scene sends, or `paths` mixed after their captures. */
  voices?: Voice[];
  paths?: RoutedPath[];
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
    voices: spec.voices ?? [],
    after: [],
    ...(spec.paths
      ? { topology: 'routed' as const, route: [{ paths: spec.paths }] }
      : {}),
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

/** One panned path of captures. */
const lane = (name: string, pan: number, ...steps: Effect[]): RoutedPath => ({
  name,
  ...(pan ? { pan } : {}),
  steps,
});
/** A head's output through a four-by-twelve impulse on the left and a combo
 * impulse on the right. */
const twoCabinets = (): RoutedStep => ({
  paths: [
    lane('Four-by-twelve', -0.8, nam('ir-mesa-os')),
    lane('Combo cabinet', 0.8, nam('ir-deluxe')),
  ],
});
/** Scenes for a `paths` preset from relative weights: every scene is scaled to
 * the same summed power, and the third (the lead) sits about 2 dB above. The
 * captures run at full input here, so one output trim brings these presets in
 * line with the fully driven scenes of the send-driven ones (provisional). */
const blendTrim = 1.5;
const blend = (rows: [name: string, weights: number[]][]): Scene[] =>
  rows.map(([name, weights], index) => {
    const power = index === 2 ? 1 : 0.64;
    const scale = Math.sqrt(power / weights.reduce((s, w) => s + w * w, 0));
    return [
      name,
      weights.map((w) => Math.round(w * scale * 1000) / 1000),
      blendTrim,
    ];
  });

const blendNote =
  ' Scenes change the blend only; add effects in the rig if you want space.';
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
      'Open, bell-like American combo cleans from 1960s studio sessions, with a soft top end and plenty of headroom.',
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
      'Rhythm is a loose, open chord sound. Crunch leans in for riffs, Lead drives the amp as hard as it goes with the level lift, and Clean-up backs the input right off, like rolling the guitar volume down, for a jangly verse.',
    voices: [voice('Stack', nam('plexi-crunch'))],
    scenes: [
      ['Rhythm', [0.5], 1.5],
      ['Crunch', [0.75], 1.3],
      ['Lead', [1], 1.5],
      ['Clean-up', [0.18], 2.4],
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
      'Rhythm is the full wall of gain. Tight backs off the input to keep fast palm mutes clear, Lead is the hardest-driven setting with the level lift, and Break backs the input far off for a gritty, half-clean interlude.',
    voices: [voice('Rig', nam('peavey-5150-rig'))],
    scenes: [
      ['Rhythm', [0.8], 1.3],
      ['Tight', [0.55], 1.5],
      ['Lead', [1], 1.45],
      ['Break', [0.15], 2.5],
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

  lite({
    id: 'A2L-16',
    name: 'Wide Stage',
    description:
      'Two different rock stacks panned left and right with a flat clean amp in the centre. Three captures stay loaded; scenes re-balance them.',
    categories: ['Hard rock', 'Classic rock', 'TONE3000'],
    genres: ['Hard rock', 'Classic rock'],
    techniques: ['Parallel routing', 'Dual amp', 'Stereo'],
    complexity: 'complex',
    inspiration:
      'Two-guitar hard rock of the 1980s as it sounds from the audience: a different stack on each side of the stage and a clean amp for the quiet parts.',
    performance:
      'Clean is the centre clean amp alone. Rhythm is both stacks, wide. Lead leans on the hotter right-hand stack with a little clean for note definition and the level lift. Layered puts the clean amp under both stacks so chords stay clear. Verse is the left-hand stack with some clean, drier and narrower.' +
      blendNote,
    paths: [
      lane('Left stack', -0.8, nam('jcm800-v30')),
      lane('Right stack', 0.8, nam('friedman-be100')),
      lane('Centre clean', 0, nam('jc-clean')),
    ],
    scenes: blend([
      ['Clean', [0, 0, 1]],
      ['Rhythm', [1, 1, 0]],
      ['Lead', [0.5, 1, 0.25]],
      ['Layered', [0.7, 0.7, 0.7]],
      ['Verse', [1, 0, 0.4]],
    ]),
  }),
  lite({
    id: 'A2L-17',
    name: 'Two Combos',
    description:
      'A raw small combo on the left, a barking four-by-ten on the right and a boosted small combo in the centre. Three captures; scenes move between them.',
    categories: ['Blues', 'Edge of breakup', 'TONE3000'],
    genres: ['Blues', 'Edge of breakup'],
    techniques: ['Parallel routing', 'Dual amp', 'Stereo'],
    complexity: 'complex',
    inspiration:
      'Electric blues recording from the 1950s onward: two small combos miked side by side, one raw and one cleaner, with a boost for the solo.',
    performance:
      'Four-ten is the cleaner combo alone. Pair plays both combos across the stereo field for rhythm. Lead brings the boosted small combo up the middle over the pair, with the level lift. Small combo is the raw one alone for a rougher verse. All three is the thickest sound for the last chorus.' +
      blendNote,
    paths: [
      lane('Small combo', -0.5, nam('tweed-crunch')),
      lane('Four-ten', 0.5, nam('super-reverb-65')),
      lane('Boosted', 0, nam('drive-centaur'), nam('tweed-crunch')),
    ],
    scenes: blend([
      ['Four-ten', [0, 1, 0]],
      ['Pair', [1, 1, 0]],
      ['Lead', [0.3, 0.5, 1]],
      ['Small combo', [1, 0, 0]],
      ['All three', [0.7, 0.7, 0.6]],
    ]),
  }),
  lite({
    id: 'A2L-18',
    name: 'Wide Twang',
    description:
      'A bell-like clean on the left, a flat solid-state clean on the right and a lightly pushed clean in the centre, for wide country rhythm and snappy leads.',
    categories: ['Country', 'Clean', 'TONE3000'],
    genres: ['Country', 'Clean'],
    techniques: ['Parallel routing', 'Dual amp', 'Stereo'],
    complexity: 'complex',
    inspiration:
      'Modern country session guitar: two contrasting clean amps recorded together for width, and a light overdrive pushing one of them for fills.',
    performance:
      'Bell is the left-hand clean alone for picked rhythm. Pair adds the flat clean on the right for a wide strum. Lead puts the pushed amp up the middle with a little of the bell clean and the level lift. Snap is the flat clean with the pushed amp for biting double-stops. Full blends all three for the biggest chorus.' +
      blendNote,
    paths: [
      lane('Bell', -0.5, nam('blackface-clean')),
      lane('Flat', 0.5, nam('jc-clean')),
      lane('Pushed', 0, nam('drive-morning-glory'), nam('blackface-clean')),
    ],
    scenes: blend([
      ['Bell', [1, 0, 0]],
      ['Pair', [1, 1, 0]],
      ['Lead', [0.3, 0, 1]],
      ['Snap', [0, 1, 0.5]],
      ['Full', [0.7, 0.7, 0.7]],
    ]),
  }),

  // ---- A2 Full: up to two captures, fewer simultaneous instances. ----
  full({
    id: 'A2F-01',
    name: 'Grand Bell',
    description:
      'A bell-like studio clean at A2 Full with a transparent overdrive in front for a singing lead. Both paths stay loaded.',
    categories: ['Clean', 'Pop', 'TONE3000'],
    genres: ['Clean', 'Pop'],
    techniques: ['Dual amp'],
    complexity: 'layered',
    inspiration:
      'Open, bell-like American combo cleans from 1960s studio sessions, with the kind of transparent overdrive session players added later for a lead that still sounds like the amp.',
    performance:
      'Clean is the bare amp for chords and arpeggios. Drive plays rhythm through the overdriven path, lightly, so the amp still sounds like itself. Lead drives that path harder with the level lift. Bloom blends a little of the overdriven path under the clean one for a thicker, sustaining chord sound.' +
      dryNote,
    voices: [
      voice('Bell', nam('blackface-clean')),
      voice('Sing', nam('drive-kot'), nam('blackface-clean')),
    ],
    scenes: [
      ['Clean', [0.5, 0], 1.5],
      ['Drive', [0, 0.45], 1.5],
      ['Lead', [0, 0.9], 1.4],
      ['Bloom', [0.3, 0.35], 1.6],
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
      'A flat, fast solid-state clean on the left and a bell-like combo clean on the right at A2 Full, for wide muted sixteenths and scratchy chords.',
    categories: ['Funk', 'Pop', 'TONE3000'],
    genres: ['Funk', 'Pop'],
    techniques: ['Parallel routing', 'Dual amp', 'Stereo'],
    complexity: 'layered',
    inspiration:
      '1970s funk and 1980s new wave rhythm guitar: two contrasting clean amps recorded together, one flat and fast, one round and bell-like.',
    performance:
      'Pair is both amps, one on each side, for a wide groove. Flat leans on the solid-state clean, with only a touch of the combo, for the tightest muted parts. Lead leans on the bell-like combo with the level lift for single-note lines. Bell is the combo alone for rounder chords.' +
      blendNote,
    paths: [
      lane('Flat', -0.5, nam('jc-clean')),
      lane('Bell', 0.5, nam('blackface-clean')),
    ],
    scenes: blend([
      ['Pair', [1, 1]],
      ['Flat', [1, 0.2]],
      ['Lead', [0.5, 1]],
      ['Bell', [0, 1]],
    ]),
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
      'A raw, open fifty-watt stack sound at A2 Full, with a mid-pushed overdrive in front for the solo. Both paths stay loaded.',
    categories: ['Classic rock', 'TONE3000'],
    genres: ['Classic rock', 'Hard rock'],
    techniques: ['Dual amp'],
    complexity: 'layered',
    inspiration:
      'Late-1970s and early-1980s stadium rock: a loud, open stack that cleans up when you play softer, pushed by an overdrive when the solo comes.',
    performance:
      'Open is the plain stack played softly, so it cleans up. Pushed plays riffs through the overdriven path. Lead drives that path as hard as it goes with the level lift. Thick blends the plain and overdriven paths into the fattest rhythm sound.' +
      dryNote,
    voices: [
      voice('Stack', nam('plexi-crunch')),
      voice('Pushed', nam('drive-ts9'), nam('plexi-crunch')),
    ],
    scenes: [
      ['Open', [0.35, 0], 1.65],
      ['Pushed', [0, 0.6], 1.35],
      ['Lead', [0, 1], 1.4],
      ['Thick', [0.4, 0.45], 1.45],
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
      'A modern metal rig with its own cabinet at A2 Full, with a tight boost in front for fast riffs and leads. Both paths stay loaded.',
    categories: ['Modern metal', 'TONE3000'],
    genres: ['Modern metal'],
    techniques: ['Dual amp'],
    complexity: 'layered',
    inspiration:
      'Modern metal of the 2000s and 2010s: a hard, clear wall of gain with a controlled low end, tightened by a boost for the fastest parts.',
    performance:
      'Rhythm is the rig on its own, the full wall. Tight adds the boost to keep fast mutes focused. Lead is the boosted path driven hardest with the level lift. Break backs the input far off for a gritty, half-clean interlude.' +
      dryNote,
    voices: [
      voice('Rig', nam('stealth-5150-rig')),
      voice('Boosted', nam('drive-fortin'), nam('stealth-5150-rig')),
    ],
    scenes: [
      ['Rhythm', [0.8, 0], 1.3],
      ['Tight', [0, 0.6], 1.35],
      ['Lead', [0, 1], 1.4],
      ['Break', [0.15, 0], 2.5],
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
  full({
    id: 'A2F-11',
    name: 'Channel Switch',
    description:
      'A clean amp and a scooped high-gain head kept loaded side by side, the head through two different cabinet impulses panned left and right. Scenes switch and blend like an amp footswitch, with no gap.',
    categories: ['Hard rock', 'Modern metal', 'TONE3000'],
    genres: ['Hard rock', 'Modern metal'],
    techniques: ['Parallel routing', 'Dual amp', 'Stereo'],
    complexity: 'complex',
    inspiration:
      'Channel-switching amps of the 1990s and 2000s: a glassy clean channel and a heavy, scooped gain channel under one footswitch.',
    performance:
      'Clean is the clean amp alone. Rhythm is the head through both cabinets, wide. Lead keeps the head, leans on the four-by-twelve side and leaves a little clean in for attack, with the level lift. Layer sets the clean amp over a quieter head for big open chords. Tight is the four-by-twelve side with less of the combo cabinet, for focused riffs.' +
      blendNote,
    paths: [
      lane('Clean', 0, nam('two-rock-clean')),
      lane('Gain left', -0.8, nam('rectifier-2025'), nam('ir-mesa-os')),
      lane('Gain right', 0.8, nam('rectifier-2025'), nam('ir-deluxe')),
    ],
    scenes: blend([
      ['Clean', [1, 0, 0]],
      ['Rhythm', [0, 1, 1]],
      ['Lead', [0.3, 1, 0.8]],
      ['Layer', [0.8, 0.5, 0.5]],
      ['Tight', [0, 1, 0.4]],
    ]),
  }),
  full({
    id: 'A2F-12',
    name: 'Two Cabinets',
    description:
      'One tight low-tuned head, open and boosted, each through a four-by-twelve impulse on the left and a combo impulse on the right. Two captures; the width comes from the cabinets.',
    categories: ['Progressive', 'Modern metal', 'TONE3000'],
    genres: ['Progressive', 'Modern metal'],
    techniques: ['Parallel routing', 'Dual cabinet', 'Stereo'],
    complexity: 'complex',
    inspiration:
      'Progressive metal production of the 2010s: one tight head recorded through two different cabinets, with a boost in front for the fastest parts.',
    performance:
      'Rhythm is the head on its own through both cabinets for open riffs. Tight is the boosted head alone for fast palm mutes. Lead is the boosted head with some of the open head under it and the level lift. Wall sets both level for the thickest chords.' +
      blendNote,
    paths: [
      { name: 'Open', steps: [nam('badlander-head'), twoCabinets()] },
      {
        name: 'Boosted',
        steps: [nam('drive-fortin'), nam('badlander-head'), twoCabinets()],
      },
    ],
    scenes: blend([
      ['Rhythm', [1, 0]],
      ['Tight', [0, 1]],
      ['Lead', [0.35, 1]],
      ['Wall', [1, 1]],
    ]),
  }),
  full({
    id: 'A2F-13',
    name: 'Double Low',
    description:
      'A bi-amp bass: a round tube head through an eight-by-ten impulse, the same head driven by a gritty driver, and the dry bass straight into the cabinet impulse for a clear top. Two captures; scenes blend the three.',
    categories: ['Bass', 'TONE3000'],
    genres: ['Bass', 'Hard rock'],
    techniques: ['Parallel routing', 'Bi-amp'],
    complexity: 'complex',
    inspiration:
      'Bi-amped rock bass from the 1970s onward: a clean, round low end with a driven signal blended over it, so the grit never eats the fundamental.',
    performance:
      'Clean is the tube head alone for fingerstyle lines. Grit blends the driven head over it for rock parts. Solo is the driven head with the direct cabinet on top and the level lift. Bi-amp keeps the clean head for the lows and adds the direct cabinet for a clear, defined top.' +
      blendNote,
    paths: [
      lane('Clean', 0, nam('svt-head'), nam('ir-ampeg-810')),
      lane(
        'Driven',
        0.25,
        nam('drive-sansamp'),
        nam('svt-head'),
        nam('ir-ampeg-810'),
      ),
      lane('Direct', -0.25, nam('ir-ampeg-810')),
    ],
    scenes: blend([
      ['Clean', [1, 0, 0]],
      ['Grit', [0.6, 0.8, 0]],
      ['Solo', [0, 1, 0.4]],
      ['Bi-amp', [0.8, 0, 0.6]],
    ]),
  }),
  full({
    id: 'A2F-14',
    name: 'Open Range',
    description:
      'A wide, glassy clean on the left and the same amp lightly pushed on the right, for country rhythm and snappy leads at A2 Full.',
    categories: ['Country', 'Clean', 'TONE3000'],
    genres: ['Country', 'Clean'],
    techniques: ['Parallel routing', 'Dual amp', 'Stereo'],
    complexity: 'layered',
    inspiration:
      'Modern country session cleans: bright and snappy under the pick, with a light overdrive that adds bite without hiding the note.',
    performance:
      'Clean is the bare amp for picked rhythm. Pair adds the pushed amp on the other side for a wide strum. Lead puts the pushed amp forward with the level lift. Snap is the pushed amp alone for biting double-stops.' +
      blendNote,
    paths: [
      lane('Glass', -0.4, nam('two-rock-clean')),
      lane('Pushed', 0.4, nam('drive-morning-glory'), nam('two-rock-clean')),
    ],
    scenes: blend([
      ['Clean', [1, 0]],
      ['Pair', [0.8, 0.6]],
      ['Lead', [0.25, 1]],
      ['Snap', [0, 1]],
    ]),
  }),
  full({
    id: 'A2F-15',
    name: 'Blue Lamp',
    description:
      'A warm, round jazz combo beside a smooth overdrive amp through a combo cabinet impulse, for comping and singing fusion lines.',
    categories: ['Jazz', 'Blues', 'TONE3000'],
    genres: ['Jazz', 'Blues'],
    techniques: ['Parallel routing', 'Dual amp', 'Stereo'],
    complexity: 'layered',
    inspiration:
      'Jazz-fusion guitar of the 1970s and 1980s: a dark, round comping tone and a smooth, vocal overdrive for the solo.',
    performance:
      'Warm is the jazz combo alone for chords. Comp adds a trace of the overdrive amp so lines speak a little sooner. Lead moves to the overdrive amp with a little of the warm combo under it and the level lift. Blend sets both level for thick chord-melody playing.' +
      blendNote,
    paths: [
      lane('Warm', -0.35, nam('polytone-jazz')),
      lane('Sing', 0.35, nam('dumble-ods'), nam('ir-deluxe')),
    ],
    scenes: blend([
      ['Warm', [1, 0]],
      ['Comp', [1, 0.35]],
      ['Lead', [0.2, 1]],
      ['Blend', [0.8, 0.8]],
    ]),
  }),
  full({
    id: 'A2F-16',
    name: 'Wide Water',
    description:
      'A shimmering clean combo on the left and a chiming combo at the edge of breakup on the right: a wide, clean bed for post-rock and ambient guitar, ready for your own effects.',
    categories: ['Ambient', 'Post-rock', 'TONE3000'],
    genres: ['Ambient', 'Post-rock'],
    techniques: ['Parallel routing', 'Dual amp', 'Stereo'],
    complexity: 'layered',
    inspiration:
      'Post-rock guitar of the 2000s: two bright combos spread wide, clean for the quiet figure and just breaking up when the part builds.',
    performance:
      'Clean is the shimmering combo alone for the opening figure. Wide adds the chiming combo on the other side. Lead leans on the chiming combo, a little gritty, with the level lift. Edge is the chiming combo alone for the loud section.' +
      blendNote,
    paths: [
      lane('Shimmer', -0.6, nam('match-brave')),
      lane('Chime', 0.6, nam('ac30-chime')),
    ],
    scenes: blend([
      ['Clean', [1, 0]],
      ['Wide', [0.8, 0.8]],
      ['Lead', [0.4, 1]],
      ['Edge', [0, 1]],
    ]),
  }),
];
