import type { Lv2Plugin, Preset, RigDocument } from './api';
import type {
  PortableNativePartition,
  ResourceSource,
  RigPublish,
} from './generated/contract';

export type MonoInput = 'sum' | 'left' | 'right';
export type DraftEffect =
  | {
      id: string;
      kind: 'native';
      name: string;
      preset: Preset;
      source: ResourceSource;
      stage?: { role: 'amp' | 'cab'; recipe: PortableNativePartition };
    }
  | {
      id: string;
      kind: 'lv2';
      name: string;
      plugin: Lv2Plugin;
      mono: MonoInput;
      controls: Record<string, number>;
    };

export function lv2Effect(plugin: Lv2Plugin): DraftEffect {
  if (plugin.ports.some((port) => port.atom)) {
    throw new Error('Message and file controls are not available yet.');
  }
  if (plugin.unsupported) throw new Error(plugin.unsupported);
  const inputs = plugin.ports.filter((p) => p.audio && p.input).length;
  const outputs = plugin.ports.filter((p) => p.audio && p.output).length;
  if (![1, 2].includes(inputs) || inputs !== outputs)
    throw new Error(
      'This effect needs routing that is not available in the serial editor.',
    );
  const controls: Record<string, number> = {};
  for (const p of plugin.ports.filter((p) => p.control && p.input)) {
    if (p.default == null || !Number.isFinite(p.default))
      throw new Error('Effect has no valid initial value.');
    controls[p.symbol] = p.default;
  }
  return {
    id: `fx-${crypto.randomUUID()}`,
    kind: 'lv2',
    name: plugin.name,
    plugin,
    mono: 'sum',
    controls,
  };
}

export type NativeDraft = Extract<DraftEffect, { kind: 'native' }>;

/** Metadata identifies candidates only; the native loader rechecks every guard. */
export function splitNative(
  effect: NativeDraft,
  amp: string,
  cab: string,
  input: 'left' | 'right',
): [NativeDraft, NativeDraft] {
  if (effect.stage || !amp || !cab || amp === cab)
    throw new Error('Choose separate amp and cab blocks from a whole tone.');
  const pair = `pair-${crypto.randomUUID()}`;
  const make = (role: 'amp' | 'cab'): NativeDraft => ({
    ...effect,
    id: `${role}-${crypto.randomUUID()}`,
    name: `${role === 'amp' ? 'Amp' : 'Cab'} · ${effect.name}`,
    stage: {
      role,
      recipe: { version: 1, pair, amp, cab, input, controls: {} },
    },
  });
  return [make('amp'), make('cab')];
}

function stagePair(effect: DraftEffect) {
  return effect.kind === 'native' ? effect.stage?.recipe.pair : undefined;
}

/** Removal cannot strand a stage whose source/processing allocation has a peer. */
export function removeEffect(effects: DraftEffect[], id: string) {
  const effect = effects.find((e) => e.id === id);
  const pair = effect && stagePair(effect);
  return effects.filter((e) => e.id !== id && (!pair || stagePair(e) !== pair));
}

/** Keep each source's amp before its cab while allowing effects between them. */
export function canMoveEffect(
  effects: DraftEffect[],
  index: number,
  step: -1 | 1,
) {
  const next = index + step;
  if (
    index < 0 ||
    index >= effects.length ||
    next < 0 ||
    next >= effects.length
  )
    return false;
  const pair = stagePair(effects[index]!);
  return !pair || pair !== stagePair(effects[next]!);
}

function validateStages(effects: DraftEffect[]) {
  const pairs = new Map<string, NativeDraft[]>();
  for (const effect of effects) {
    if (effect.kind !== 'native' || !effect.stage) continue;
    const pair = effect.stage.recipe.pair;
    const members = pairs.get(pair) ?? [];
    members.push(effect);
    pairs.set(pair, members);
  }
  for (const members of pairs.values()) {
    const [amp, cab] = members;
    if (
      members.length !== 2 ||
      amp?.stage?.role !== 'amp' ||
      cab?.stage?.role !== 'cab' ||
      amp.preset.sha256 !== cab.preset.sha256 ||
      amp.stage.recipe.version !== cab.stage.recipe.version ||
      amp.stage.recipe.amp !== cab.stage.recipe.amp ||
      amp.stage.recipe.cab !== cab.stage.recipe.cab ||
      amp.stage.recipe.input !== cab.stage.recipe.input
    )
      throw new Error(
        'Keep each amp/cab pair together, with its amp before its cab.',
      );
  }
}

type Port = { node: string; port: number };
/** The two sides of a stereo signal at one point of the graph. */
type Stereo = [Port, Port];

/** A preset manifest under construction: blocks are chained from stereo points.
 * `base` continues an existing manifest, such as a preset with scenes. */
export function rigBuilder(
  id: string,
  name: string,
  profile: string,
  draft: boolean,
  base?: RigDocument['manifest'],
) {
  const manifest: RigDocument['manifest'] = base ?? {
    format: 'oxidal.preset',
    formatVersion: 1,
    id,
    name: name.trim(),
    tone3000: { instances: [] },
    oxidal: {
      graph: {
        nodes: [{ id: 'in', kind: 'input', audioInputs: 0, audioOutputs: 2 }],
        edges: [],
      },
      lv2: [],
      recall: { tails: 'cut' },
    },
    resources: [],
    extensions: {},
    requiredExtensions: [],
  };
  const host = manifest.oxidal!;
  const sources: RigPublish['resources'] = {};
  const labels = (base?.extensions['urn:oxidal:authoring']?.labels ??
    {}) as Record<string, string>;
  const link = (from: Port, to: string, toPort: number) =>
    host.graph.edges.push({ from, to: { node: to, port: toPort } });
  /** Chains `effects` after `from` and returns the stereo point after them. */
  function chain(effects: DraftEffect[], from: Stereo): Stereo {
    let previous = from;
    for (const effect of effects) {
      labels[effect.id] = effect.name;
      const mono =
        effect.kind === 'lv2' &&
        effect.plugin.ports.filter((p) => p.audio && p.input).length === 1;
      if (mono && effect.kind === 'lv2') {
        const merge = `${effect.id}-mono`;
        host.graph.nodes.push({
          id: merge,
          kind: 'merge',
          audioInputs: 2,
          audioOutputs: 1,
          inputGains:
            effect.mono === 'left'
              ? [1, 0]
              : effect.mono === 'right'
                ? [0, 1]
                : [0.5, 0.5],
        });
        link(previous[0], merge, 0);
        link(previous[1], merge, 1);
        labels[merge] =
          effect.mono === 'sum'
            ? 'L + R → Mono'
            : `${effect.mono === 'left' ? 'L' : 'R'} → Mono`;
        previous = [
          { node: merge, port: 0 },
          { node: merge, port: 0 },
        ];
      }
      host.graph.nodes.push({
        id: effect.id,
        kind: effect.kind === 'native' ? 'tone3000' : 'lv2',
        audioInputs: mono ? 1 : 2,
        audioOutputs: mono ? 1 : 2,
        instance: effect.id,
        bypassed: false,
      });
      link(previous[0], effect.id, 0);
      if (!mono) link(previous[1], effect.id, 1);
      if (effect.kind === 'native') {
        const resource =
          manifest.resources.find((r) => r.sha256 === effect.preset.sha256)
            ?.id ?? `preset-${manifest.resources.length}`;
        if (!sources[resource]) {
          manifest.resources.push({
            id: resource,
            path: `tone3000/${effect.preset.sha256}.t3kpreset`,
            kind: 'tone3000-preset',
            sha256: effect.preset.sha256,
            bytes: effect.preset.size_bytes,
          });
          sources[resource] = effect.source;
        }
        manifest.tone3000.instances.push({
          id: effect.id,
          preset: resource,
          profile,
          processingRole: effect.stage?.role ?? 'whole',
          ...(effect.stage ? { partition: effect.stage.recipe } : {}),
        });
      } else {
        host.lv2.push({
          id: effect.id,
          pluginUri: effect.plugin.uri,
          controls: { ...effect.controls },
          assets: [],
          requiredFeatures: [],
        });
      }
      previous = [
        { node: effect.id, port: 0 },
        { node: effect.id, port: mono ? 0 : 1 },
      ];
      if (mono) {
        const split = `${effect.id}-stereo`;
        host.graph.nodes.push({
          id: split,
          kind: 'split',
          audioInputs: 1,
          audioOutputs: 2,
        });
        link({ node: effect.id, port: 0 }, split, 0);
        previous = [
          { node: split, port: 0 },
          { node: split, port: 1 },
        ];
      }
    }
    return previous;
  }
  function finish(last: Stereo): RigPublish {
    host.graph.nodes.push({
      id: 'out',
      kind: 'output',
      audioInputs: 2,
      audioOutputs: 0,
    });
    link(last[0], 'out', 0);
    link(last[1], 'out', 1);
    manifest.extensions['urn:oxidal:authoring'] = { labels, draft };
    return { manifest_json: JSON.stringify(manifest), resources: sources };
  }
  const input: Stereo = [
    { node: 'in', port: 0 },
    { node: 'in', port: 1 },
  ];
  return { host, labels, chain, finish, input };
}

/** Construct explicit scalar routing. No backend/plugin code runs in the browser.
 * `draft` presets are working copies; a finished one appears in the library. */
export function serialRig(
  id: string,
  name: string,
  effects: DraftEffect[],
  profile: string,
  draft = true,
): RigPublish {
  validateStages(effects);
  const rig = rigBuilder(id, name, profile, draft);
  return rig.finish(rig.chain(effects, rig.input));
}

/** Shared blocks, then two lanes side by side that sum before OUT: a split.
 * The graph aligns the lanes' latencies, so a pitch lane stays in time. */
export function parallelRig(
  id: string,
  name: string,
  shared: DraftEffect[],
  lanes: [DraftEffect[], DraftEffect[]],
  profile: string,
  draft = true,
): RigPublish {
  validateStages([...shared, ...lanes[0], ...lanes[1]]);
  if (!lanes[0].length || !lanes[1].length)
    throw new Error('Each side of a split needs at least one block.');
  const rig = rigBuilder(id, name, profile, draft);
  const before = rig.chain(shared, rig.input);
  const splits = (['left', 'right'] as const).map((side, port): Port => {
    const node = `split-${side}`;
    rig.host.graph.nodes.push({
      id: node,
      kind: 'split',
      audioInputs: 1,
      audioOutputs: 2,
    });
    rig.host.graph.edges.push({ from: before[port]!, to: { node, port: 0 } });
    rig.labels[node] = `Split · ${side === 'left' ? 'L' : 'R'}`;
    return { node, port: 0 };
  });
  const ends = lanes.map((lane, index) =>
    rig.chain(lane, [
      { node: splits[0]!.node, port: index },
      { node: splits[1]!.node, port: index },
    ]),
  );
  const merges = (['left', 'right'] as const).map((side, port): Port => {
    const node = `merge-${side}`;
    rig.host.graph.nodes.push({
      id: node,
      kind: 'merge',
      audioInputs: 2,
      audioOutputs: 1,
      inputGains: [1, 1],
    });
    ends.forEach((end, index) =>
      rig.host.graph.edges.push({
        from: end[port]!,
        to: { node, port: index },
      }),
    );
    rig.labels[node] = `Merge · ${side === 'left' ? 'L' : 'R'}`;
    return { node, port: 0 };
  });
  return rig.finish([merges[0]!, merges[1]!]);
}

/** Simple scenes: each saved native tone runs in parallel; scalar LV2 effects
 * are shared downstream. This builds explicit routing without a branch editor. */
export function sceneRig(
  id: string,
  name: string,
  effects: DraftEffect[],
  profile: string,
  tails: 'cut' | 'preserve' = 'cut',
): RigPublish {
  const tones = effects.filter((e): e is NativeDraft => e.kind === 'native');
  if (tones.some((e) => e.stage))
    throw new Error('Use whole saved tones for scene branches.');
  if (tones.length < 2 || tones.length > 64)
    throw new Error('Choose 2–64 saved tones for this scene layout.');
  const post = effects.filter((e) => e.kind === 'lv2');
  const result = serialRig(id, name, [...tones, ...post], profile);
  const manifest: RigDocument['manifest'] = JSON.parse(result.manifest_json);
  const host = manifest.oxidal!;
  const ids = new Set(tones.map((t) => t.id));
  const last = tones.at(-1)!.id;
  host.graph.edges = host.graph.edges
    .filter(
      (e) =>
        !ids.has(e.to.node) && (!ids.has(e.from.node) || e.from.node === last),
    )
    .map((e) =>
      e.from.node === last
        ? {
            ...e,
            from: {
              node: e.from.port === 0 ? 'scene-left' : 'scene-right',
              port: 0,
            },
          }
        : e,
    );
  const labels = manifest.extensions['urn:oxidal:authoring']!.labels as Record<
    string,
    string
  >;
  for (const [port, side] of ['left', 'right'].entries()) {
    const split = `scene-input-${side}`;
    const merge = `scene-${side}`;
    host.graph.nodes.push(
      { id: split, kind: 'split', audioInputs: 1, audioOutputs: tones.length },
      {
        id: merge,
        kind: 'merge',
        audioInputs: tones.length,
        audioOutputs: 1,
        inputGains: tones.map((_, i) => (i === 0 ? 1 : 0)),
      },
    );
    labels[merge] = `Scenes · ${side === 'left' ? 'L' : 'R'}`;
    labels[split] = `Parallel · ${side === 'left' ? 'L' : 'R'}`;
    host.graph.edges.push({
      from: { node: 'in', port },
      to: { node: split, port: 0 },
    });
    tones.forEach((tone, index) =>
      host.graph.edges.push(
        { from: { node: split, port: index }, to: { node: tone.id, port } },
        { from: { node: tone.id, port }, to: { node: merge, port: index } },
      ),
    );
  }
  if (tails === 'preserve') {
    manifest.requiredExtensions.push('urn:oxidal:gain:1');
    manifest.extensions['urn:oxidal:gain:1'] = {};
    // Gate each branch's input rather than its output. Every prepared branch
    // keeps running and drains into the unity output sum after deselection.
    for (const side of ['left', 'right']) {
      host.graph.nodes.find((n) => n.id === `scene-${side}`)!.inputGains =
        tones.map(() => 1);
      tones.forEach((tone, index) => {
        const gate = `scene-feed-${side}-${index}`;
        host.graph.nodes.push({
          id: gate,
          kind: 'gain',
          audioInputs: 1,
          audioOutputs: 1,
          inputGains: [index === 0 ? 1 : 0],
        });
        const incoming = host.graph.edges.find(
          (e) => e.from.node === `scene-input-${side}` && e.to.node === tone.id,
        )!;
        const port = incoming.to.port;
        incoming.to = { node: gate, port: 0 };
        host.graph.edges.push({
          from: { node: gate, port: 0 },
          to: { node: tone.id, port },
        });
      });
    }
  }
  manifest.extensions['urn:oxidal:authoring']!.scene_tails = tails;
  manifest.extensions['urn:oxidal:authoring']!.internal_nodes = [
    ...host.graph.nodes
      .filter((n) => n.id.startsWith('scene-'))
      .map((n) => n.id),
  ];
  const selection = (side: string, port: number) =>
    tails === 'preserve'
      ? { node: `scene-feed-${side}-${port}`, port: 0 }
      : { node: `scene-${side}`, port };
  manifest.requiredExtensions.push('urn:oxidal:scenes:1');
  manifest.extensions['urn:oxidal:scenes:1'] = {
    fade_ms: 10,
    branches: tones.map((tone, port) => ({
      id: tone.id,
      name: tone.name,
      gains: ['left', 'right'].map((side) => ({
        ...selection(side, port),
        value: 1,
      })),
    })),
    scenes: tones.map((tone, index) => ({
      id: tone.id,
      name: tone.name,
      gains: ['left', 'right'].flatMap((side) =>
        tones.map((_, port) => ({
          ...selection(side, port),
          value: port === index ? 1 : 0,
        })),
      ),
    })),
  };
  return { ...result, manifest_json: JSON.stringify(manifest) };
}

export function rigNodeLabel(
  document: RigDocument | null,
  id: string,
): string | undefined {
  const labels: unknown =
    document?.manifest.extensions['urn:oxidal:authoring']?.labels;
  if (!labels || typeof labels !== 'object' || !(id in labels))
    return undefined;
  const value: unknown = (labels as Record<string, unknown>)[id];
  return typeof value === 'string' ? value : undefined;
}
