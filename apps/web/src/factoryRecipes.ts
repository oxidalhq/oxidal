import type { Lv2Plugin, RigDocument } from './api';
import type { RigNativeSource } from './generated/contract';
import { rigBuilder, type DraftEffect } from './rigDraft.ts';

const pluginUris: Record<string, string> = {
  'GxZita_rev1-Stereo':
    'http://guitarix.sourceforge.net/plugins/gx_zita_rev1_stereo#_zita_rev1_stereo',
  'GxReverb-Stereo':
    'http://guitarix.sourceforge.net/plugins/gx_reverb_stereo#_reverb_stereo',
  GxAutoWah: 'http://guitarix.sourceforge.net/plugins/gxautowah#autowah',
  GxBigMuffPi: 'http://guitarix.sourceforge.net/plugins/gx_bmp_#_bmp_',
  'GxChorus-Stereo':
    'http://guitarix.sourceforge.net/plugins/gx_chorus_stereo#_chorus_stereo',
  GxCompressor:
    'http://guitarix.sourceforge.net/plugins/gx_compressor#_compressor',
  GxPhaser: 'http://guitarix.sourceforge.net/plugins/gx_phaser#_phaser',
  GxRat: 'http://guitarix.sourceforge.net/plugins/gx_aclipper_#_aclipper_',
  GxTremolo: 'http://guitarix.sourceforge.net/plugins/gx_tremolo#_tremolo',
  GxTubeScreamer: 'http://guitarix.sourceforge.net/plugins/gxts9#ts9sim',
  'Invada High Pass Filter (stereo)':
    'http://invadarecords.com/plugins/lv2/filter/hpf/stereo',
  'Invada Low Pass Filter (stereo)':
    'http://invadarecords.com/plugins/lv2/filter/lpf/stereo',
  'MDA DubDelay': 'http://drobilla.net/plugins/mda/DubDelay',
  'MDA RezFilter': 'http://drobilla.net/plugins/mda/RezFilter',
  'MDA Tracker': 'http://drobilla.net/plugins/mda/Tracker',
  'Oxidal Hold (Stereo)': 'urn:oxidal:plugin:hold#stereo',
};

export type FactoryRole = 'clean' | 'crunch' | 'heavy' | 'bass';
type Effect =
  | { plugin: string; controls?: Record<string, number> }
  | { native: FactoryRole };
type Voice = { name: string; effects: Effect[] };
export type FactoryRecipe = {
  id: string;
  name: string;
  description: string;
  categories: string[];
  before: Effect[];
  voices: Voice[];
  after: Effect[];
  scenes: { name: string; mix: number[]; level?: number }[];
};
const fx = (plugin: string, controls: Record<string, number> = {}): Effect => ({
  plugin,
  controls,
});
const nam = (native: FactoryRole): Effect => ({ native });
const room = () =>
  fx('GxReverb-Stereo', { dry_wet: 12, roomsize: 0.35, damp: 0.55 });
const hall = (dry = 100, decay = 3) =>
  fx('GxZita_rev1-Stereo', {
    DRY_WET_MIX: dry ? -0.65 : 1,
    MID_RT60: decay,
    LOW_RT60: Math.min(8, decay * 0.8),
    HF_DAMPING: 6500,
    LF_X: 180,
    IN_DELAY: 25,
  });
const compressor = () =>
  fx('GxCompressor', {
    THRESHOLD: -22,
    RATIO: 2.5,
    ATTACK: 0.012,
    RELEASE: 0.15,
  });
const chorus = () =>
  fx('GxChorus-Stereo', { level: 0.25, depth: 0.012, freq: 0.7 });
const drive = () => fx('GxTubeScreamer', { fslider0_: -12, fslider2_: 0.2 });
const echo = (wet = 0.25) =>
  fx('MDA DubDelay', {
    delay: 0.32,
    feedback: 0.45,
    fx_mix: wet,
    lfo_depth: 0.03,
  });
const voice = (name: string, ...effects: Effect[]): Voice => ({
  name,
  effects,
});
const selections = (names: [string, string, string, string]) =>
  names.map((name, i) => ({
    name,
    mix: [i === 0 ? 1 : 0, i === 1 || i === 3 ? 1 : 0, i === 2 ? 1 : 0],
    level: i === 3 ? 1.12 : 1,
  }));

/** Original recipes contain settings and roles, never third-party model payloads.
 * @see docs/factory-collection.md */
export const factoryRecipes: FactoryRecipe[] = [
  {
    id: 'C01',
    name: 'Clear Current',
    description:
      'Inspired by articulate studio cleans. A shared clean NAM voice with compression, gentle width and an intentional lead lift.',
    categories: ['Clean', 'Pop', 'Country'],
    before: [nam('clean')],
    voices: [
      voice('Dry'),
      voice('Soft compression', compressor()),
      voice('Wide', chorus()),
    ],
    after: [room()],
    scenes: selections(['Dry', 'Soft compression', 'Wide', 'Lead']).map(
      (scene, index) => ({
        ...scene,
        level: index === 1 ? 2 : index === 3 ? 2.24 : 1,
      }),
    ),
  },
  {
    id: 'C02',
    name: 'Velvet Room',
    description:
      'Inspired by intimate jazz and neo-soul chord sounds. Warm top end, gentle movement and a small shared room.',
    categories: ['Jazz', 'Neo-soul', 'Clean'],
    before: [
      nam('clean'),
      fx('Invada Low Pass Filter (stereo)', { freq: 6200 }),
    ],
    voices: [
      voice('Intimate'),
      voice('Open', chorus()),
      voice('Motion', fx('GxTremolo', { depth: 0.25, freq: 2.4, dry_wet: 60 })),
    ],
    after: [room()],
    scenes: selections(['Intimate', 'Open', 'Gentle motion', 'Solo']).map(
      (scene, index) => ({ ...scene, level: index === 2 ? 1.55 : scene.level }),
    ),
  },
  {
    id: 'C03',
    name: 'Pocket Wire',
    description:
      'Inspired by percussive funk and disco rhythm. Play short muted strokes; the envelope responds to your picking level.',
    categories: ['Funk', 'Disco', 'Pop'],
    before: [nam('clean')],
    voices: [
      voice('Tight', compressor()),
      voice('Envelope', fx('GxAutoWah')),
      voice('Phaser', fx('GxPhaser', { dry_wet: 35, speed: 0.7 })),
    ],
    after: [room()],
    scenes: selections(['Tight', 'Envelope', 'Phaser', 'Accent']),
  },
  {
    id: 'R01',
    name: 'Copper Edge',
    description:
      'Inspired by roots and blues touch response. Drives feed one shared crunch NAM voice; echo history remains downstream.',
    categories: ['Blues', 'Roots', 'Indie'],
    before: [],
    voices: [
      voice('Touch'),
      voice('Push', drive()),
      voice('Grain', fx('GxRat')),
    ],
    after: [nam('crunch'), echo(0.12), room()],
    scenes: selections(['Touch', 'Push', 'Grain', 'Lead']),
  },
  {
    id: 'R04',
    name: 'Offbeat',
    description:
      'Inspired by clean offbeat chops and dub echoes. Scene sends leave the old repeats ringing; feedback is deliberately restrained.',
    categories: ['Reggae', 'Ska', 'Dub'],
    before: [nam('clean')],
    voices: [
      voice('Chop'),
      voice('Echo', echo(1)),
      voice('Space', hall(0, 3.5)),
    ],
    after: [],
    scenes: [
      { name: 'Dry chop', mix: [0.8, 0, 0] },
      { name: 'Short echo', mix: [0.8, 0.16, 0] },
      { name: 'Dub', mix: [0.8, 0.3, 0.08] },
      { name: 'Space', mix: [0.8, 0.12, 0.25] },
    ],
  },
  {
    id: 'K01',
    name: 'Open Circuit',
    description:
      'Inspired by open classic-rock crunch. Three drive colours feed the same NAM chain and shared room.',
    categories: ['Classic rock', 'Garage', 'Power pop'],
    before: [],
    voices: [
      voice('Edge'),
      voice('Rhythm', drive()),
      voice('Grain', fx('GxRat')),
    ],
    after: [nam('crunch'), room()],
    scenes: selections(['Edge', 'Rhythm', 'Grain', 'Lead']),
  },
  {
    id: 'H01',
    name: 'Iron Pulse',
    description:
      'Inspired by articulate modern-metal rhythm. Tightening happens before the shared high-gain NAM voice; use its lead scene for a small level lift.',
    categories: ['Modern metal', 'Progressive metal'],
    before: [],
    voices: [
      voice('Rhythm'),
      voice(
        'Tight',
        fx('Invada High Pass Filter (stereo)', { freq: 90 }),
        drive(),
      ),
      voice('Attack', fx('Invada High Pass Filter (stereo)', { freq: 130 })),
    ],
    after: [nam('heavy'), echo(0.09)],
    scenes: selections(['Rhythm', 'Tight', 'Attack', 'Lead']),
  },
  {
    id: 'B02',
    name: 'Split Rail',
    description:
      'Inspired by split-band bass production: compressed lows under an independently driven upper voice. Check the crossover with your bass in mono.',
    categories: ['Bass', 'Rock', 'Metal'],
    before: [],
    voices: [
      voice(
        'Foundation',
        fx('Invada Low Pass Filter (stereo)', { freq: 180 }),
        compressor(),
      ),
      voice(
        'Grit',
        fx('Invada High Pass Filter (stereo)', { freq: 180 }),
        nam('bass'),
      ),
      voice(
        'Fuzz',
        fx('Invada High Pass Filter (stereo)', { freq: 220 }),
        fx('GxBigMuffPi'),
      ),
    ],
    after: [],
    scenes: [
      { name: 'Foundation', mix: [0.8, 0.22, 0] },
      { name: 'Edge', mix: [0.8, 0.35, 0] },
      { name: 'Grind', mix: [0.8, 0.5, 0] },
      { name: 'Fuzz', mix: [0.8, 0.2, 0.2] },
    ],
  },
  {
    id: 'A01',
    name: 'Afterlight',
    description:
      'Inspired by post-rock and ambient clean textures. Effect-only: clear dry attack, a rhythmic echo send and a persistent long hall.',
    categories: ['Ambient', 'Post-rock', 'Worship'],
    before: [compressor()],
    voices: [
      voice('Near'),
      voice('Echo', echo(1)),
      voice('Bloom', hall(0, 5.5)),
    ],
    after: [],
    scenes: [
      { name: 'Near', mix: [0.85, 0.05, 0.08] },
      { name: 'Echo', mix: [0.85, 0.25, 0.12] },
      { name: 'Bloom', mix: [0.85, 0.1, 0.45] },
      { name: 'Wide', mix: [0.75, 0.3, 0.55] },
    ],
  },
  {
    id: 'A04',
    name: 'Slow Weather',
    description:
      'Inspired by an accompaniment you can play over. Open the Hold block and turn Hold on while a chord rings, then off to release. Scenes mix that captured layer; they do not capture automatically.',
    categories: ['Ambient', 'Hold', 'Soundtrack'],
    before: [],
    voices: [
      voice('Live'),
      voice(
        'Held layer',
        fx('Oxidal Hold (Stereo)', {
          dry: 0,
          level: -6,
          attack: 600,
          release: 3000,
          focus: 85,
          width: 70,
        }),
        chorus(),
      ),
    ],
    after: [hall(100, 4)],
    scenes: [
      { name: 'Live', mix: [0.8, 0] },
      { name: 'Companion', mix: [0.8, 0.45] },
      { name: 'Wide', mix: [0.8, 0.8] },
      { name: 'Held foreground', mix: [0.4, 1] },
    ],
  },
  {
    id: 'S01',
    name: 'Reed Circuit',
    description:
      'Inspired by monophonic electronic lead instruments. Play one clean note at a time; Tracker does not track chords. The dry blend preserves some pick articulation.',
    categories: ['Guitar synth', 'Electronic', 'Fusion'],
    before: [],
    voices: [
      voice('Dry'),
      voice('Reed', fx('MDA Tracker', { mix: 1, glide: 0.85 })),
      voice(
        'Filter',
        fx('MDA Tracker', { mix: 1, glide: 0.92 }),
        fx('MDA RezFilter', {
          freq: 0.65,
          res: 0.4,
          lfo_vcf: 0.5,
          env_vcf: 0.5,
          output: 0.6,
        }),
      ),
    ],
    after: [echo(0.15), room()],
    scenes: [
      { name: 'Rounded', mix: [0.2, 0.65, 0] },
      { name: 'Articulate', mix: [0.45, 0.5, 0] },
      { name: 'Filtered', mix: [0.3, 0, 0.65] },
      { name: 'Lead', mix: [0.2, 0.65, 0], level: 1.12 },
    ],
  },
  {
    id: 'X03',
    name: 'Two Horizons',
    description:
      'Inspired by complementary studio amp blends. Two NAM voices share one wet chain. This blends audio, not model weights; check phase and mono compatibility with your chosen captures.',
    categories: ['Experimental', 'Alternative rock', 'Dual amp'],
    before: [],
    voices: [voice('Clear', nam('clean')), voice('Edge', nam('crunch'))],
    after: [echo(0.12), hall(100, 1.8)],
    scenes: [
      { name: 'Clear', mix: [0.8, 0] },
      { name: 'Edge', mix: [0, 0.8], level: 1.65 },
      { name: 'Blend', mix: [0.45, 0.45] },
      { name: 'Lead', mix: [0.3, 0.65] },
    ],
  },
];

export function factoryRoles(recipe: FactoryRecipe): FactoryRole[] {
  return [
    ...new Set(
      [
        ...recipe.before,
        ...recipe.voices.flatMap((v) => v.effects),
        ...recipe.after,
      ].flatMap((e) => ('native' in e ? [e.native] : [])),
    ),
  ];
}

/** Missing dependencies are reported before publication. */
export function factoryMissingPlugins(
  recipe: FactoryRecipe,
  plugins: Lv2Plugin[],
) {
  return [
    ...new Set(
      [
        ...recipe.before,
        ...recipe.voices.flatMap((v) => v.effects),
        ...recipe.after,
      ]
        .filter((e): e is Extract<Effect, { plugin: string }> => 'plugin' in e)
        .filter(
          (e) =>
            !plugins.some(
              (p) =>
                p.uri === pluginUris[e.plugin] &&
                !p.unsupported &&
                !p.ports.some((port) => port.atom),
            ),
        )
        .map((e) => e.plugin),
    ),
  ];
}

/** Build from explicit local bindings; never match captures by a guessed name.
 * Input gates retain branch histories; shared NAM and wet blocks are instantiated once.
 * @see docs/factory-collection.md */
export function buildFactoryRecipe(
  recipe: FactoryRecipe,
  plugins: Lv2Plugin[],
  bindings: Partial<Record<FactoryRole, RigNativeSource>>,
  profile: string,
  id = crypto.randomUUID(),
) {
  const rig = rigBuilder(id, `Oxidal · ${recipe.name}`, profile, false);
  let sequence = 0;
  const effect = (e: Effect): DraftEffect => {
    const id = `fx-${++sequence}`;
    if ('native' in e) {
      const source = bindings[e.native];
      if (!source)
        throw new Error(`Choose a ${e.native} NAM preset for ${recipe.name}.`);
      return {
        id,
        kind: 'native',
        name: `${e.native} · ${source.preset.name}`,
        ...source,
      };
    }
    const plugin = plugins.find((p) => p.uri === pluginUris[e.plugin]);
    if (!plugin || plugin.unsupported || plugin.ports.some((p) => p.atom))
      throw new Error(`Install ${e.plugin} before building ${recipe.name}.`);
    const controls = Object.fromEntries(
      plugin.ports
        .filter((p) => p.control && p.input)
        .map((p) => [p.symbol, p.default]),
    );
    for (const [key, value] of Object.entries(e.controls ?? {})) {
      const port = plugin.ports.find(
        (p) => p.symbol === key && p.control && p.input,
      );
      if (
        !port ||
        !Number.isFinite(value) ||
        (port.minimum != null && value < port.minimum) ||
        (port.maximum != null && value > port.maximum)
      )
        throw new Error(`${plugin.name}: incompatible control ${key}.`);
      controls[key] = value;
    }
    if (Object.values(controls).some((v) => v == null || !Number.isFinite(v)))
      throw new Error(`${plugin.name}: missing control defaults.`);
    return {
      id,
      kind: 'lv2',
      name: plugin.name,
      plugin,
      mono: 'sum',
      controls: controls as Record<string, number>,
    };
  };
  const common = rig.chain(recipe.before.map(effect), rig.input);
  const split = common.map((from, side) => {
    const id = `scene-input-${side}`;
    rig.host.graph.nodes.push({
      id,
      kind: 'split',
      audioInputs: 1,
      audioOutputs: recipe.voices.length,
    });
    rig.host.graph.edges.push({ from, to: { node: id, port: 0 } });
    return id;
  });
  const ends = recipe.voices.map((v, index) => {
    const feed = split.map((node, side) => {
      const id = `scene-feed-${index}-${side}`;
      rig.host.graph.nodes.push({
        id,
        kind: 'gain',
        audioInputs: 1,
        audioOutputs: 1,
        inputGains: [recipe.scenes[0]!.mix[index]!],
      });
      rig.host.graph.edges.push({
        from: { node, port: index },
        to: { node: id, port: 0 },
      });
      rig.labels[id] = `${v.name} send`;
      return { node: id, port: 0 };
    });
    return rig.chain(v.effects.map(effect), [feed[0]!, feed[1]!]);
  });
  const sum = [0, 1].map((side) => {
    const id = `scene-return-${side}`;
    rig.host.graph.nodes.push({
      id,
      kind: 'merge',
      audioInputs: ends.length,
      audioOutputs: 1,
      inputGains: ends.map(() => 1),
    });
    ends.forEach((ports, index) =>
      rig.host.graph.edges.push({
        from: ports[side]!,
        to: { node: id, port: index },
      }),
    );
    return { node: id, port: 0 };
  });
  const wet = rig.chain(recipe.after.map(effect), [sum[0]!, sum[1]!]);
  const output = wet.map((from, side) => {
    const id = `scene-level-${side}`;
    rig.host.graph.nodes.push({
      id,
      kind: 'gain',
      audioInputs: 1,
      audioOutputs: 1,
      inputGains: [recipe.scenes[0]!.level ?? 1],
    });
    rig.host.graph.edges.push({ from, to: { node: id, port: 0 } });
    return { node: id, port: 0 };
  });
  const result = rig.finish([output[0]!, output[1]!]);
  const manifest: RigDocument['manifest'] = JSON.parse(result.manifest_json);
  manifest.oxidal!.recall.tails = 'preserve';
  manifest.requiredExtensions.push('urn:oxidal:gain:1', 'urn:oxidal:scenes:1');
  manifest.extensions['urn:oxidal:gain:1'] = {};
  manifest.extensions['urn:oxidal:scenes:1'] = {
    fade_ms: 15,
    scenes: recipe.scenes.map((scene, index) => ({
      id: `scene-${index + 1}`,
      name: scene.name,
      gains: [
        ...scene.mix.flatMap((value, voice) =>
          [0, 1].map((side) => ({
            node: `scene-feed-${voice}-${side}`,
            port: 0,
            value,
          })),
        ),
        ...[0, 1].map((side) => ({
          node: `scene-level-${side}`,
          port: 0,
          value: scene.level ?? 1,
        })),
      ],
    })),
  };
  Object.assign(manifest.extensions['urn:oxidal:authoring']!, {
    origin: 'oxidal_example',
    scene_tails: 'preserve',
    factory_recipe: recipe.id,
    factory_version: 1,
    internal_nodes: rig.host.graph.nodes
      .filter((n) => n.id.startsWith('scene-'))
      .map((n) => n.id),
  });
  return { ...result, manifest_json: JSON.stringify(manifest) };
}
