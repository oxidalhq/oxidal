import type { Lv2Plugin, Preset, RigDocument } from './api';
import type { ResourceSource, RigPublish } from './generated/contract';

export type MonoInput = 'sum' | 'left' | 'right';
export type DraftEffect =
  | {
      id: string;
      kind: 'native';
      name: string;
      preset: Preset;
      source: ResourceSource;
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

/** Construct explicit scalar routing. No backend/plugin code runs in the browser. */
export function serialRig(
  id: string,
  name: string,
  effects: DraftEffect[],
  profile: string,
): RigPublish {
  const manifest: RigDocument['manifest'] = {
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
  const labels: Record<string, string> = {};
  const link = (from: string, fromPort: number, to: string, toPort: number) =>
    host.graph.edges.push({
      from: { node: from, port: fromPort },
      to: { node: to, port: toPort },
    });
  let previous = 'in';
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
      link(previous, 0, merge, 0);
      link(previous, 1, merge, 1);
      labels[merge] =
        effect.mono === 'sum'
          ? 'L + R → Mono'
          : `${effect.mono === 'left' ? 'L' : 'R'} → Mono`;
      previous = merge;
    }
    host.graph.nodes.push({
      id: effect.id,
      kind: effect.kind === 'native' ? 'tone3000' : 'lv2',
      audioInputs: mono ? 1 : 2,
      audioOutputs: mono ? 1 : 2,
      instance: effect.id,
      bypassed: false,
    });
    link(previous, 0, effect.id, 0);
    if (!mono) link(previous, 1, effect.id, 1);
    if (effect.kind === 'native') {
      const resource =
        manifest.resources.find((r) => r.sha256 === effect.preset.sha256)?.id ??
        `preset-${manifest.resources.length}`;
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
        processingRole: 'whole',
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
    previous = effect.id;
    if (mono) {
      const split = `${effect.id}-stereo`;
      host.graph.nodes.push({
        id: split,
        kind: 'split',
        audioInputs: 1,
        audioOutputs: 2,
      });
      link(previous, 0, split, 0);
      previous = split;
    }
  }
  host.graph.nodes.push({
    id: 'out',
    kind: 'output',
    audioInputs: 2,
    audioOutputs: 0,
  });
  link(previous, 0, 'out', 0);
  link(previous, 1, 'out', 1);
  manifest.extensions['urn:oxidal:authoring'] = { labels, draft: true };
  return { manifest_json: JSON.stringify(manifest), resources: sources };
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
