import type { Lv2Plugin, RigDocument } from './api';
import type { RigPublish, SceneControl } from './generated/contract';
import { controlLabel, scalePointLabel } from './lv2Control';
import { type DraftEffect, rigBuilder } from './rigDraft';
import { readScenes, sealScenes, writeScenes } from './sceneFormat';

/**
 * Effects on one scene of a preset with scenes. A scene is a whole TONE3000
 * chain, which cannot host effects, so an effect sits after it, still inside
 * that scene's branch, before the scene sum: only that scene sounds it, and a
 * scene change fades it with the rest of the branch. Built by editing the
 * manifest, so the scenes, their gates and the TONE3000 chains are untouched.
 * @see docs/interface.md
 */
type Manifest = RigDocument['manifest'];
type Graph = NonNullable<Manifest['oxidal']>['graph'];

/** The effects after a scene's TONE3000 chain, in order. */
export function branchEffects(graph: Graph, branch: string): string[] {
  const edges = graph.edges ?? [];
  const kind = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const found: string[] = [];
  let node = branch;
  for (let guard = 0; guard < 64; guard++) {
    const next = edges.find((e) => e.from.node === node && e.from.port === 0)
      ?.to.node;
    if (!next || next.startsWith('scene-')) break;
    if (kind.get(next) === 'lv2') found.push(next);
    node = next;
  }
  return found;
}

/** The preset as a publish request that keeps every TONE3000 resource. */
function publish(manifest: Manifest, revision: string): RigPublish {
  return {
    manifest_json: JSON.stringify(sealScenes(manifest)),
    resources: Object.fromEntries(
      manifest.resources.map((r) => [
        r.id,
        { kind: 'bundle', revision, resource: r.id },
      ]),
    ),
  };
}

/** The manifest with the effects' knobs at the values they have now. */
function clone(
  document: RigDocument,
  live: Record<string, Record<string, number>>,
  name?: string,
): Manifest {
  const manifest: Manifest = JSON.parse(JSON.stringify(document.manifest));
  if (name) manifest.name = name.trim();
  manifest.extensions['urn:oxidal:authoring'] = {
    ...(manifest.extensions['urn:oxidal:authoring'] ?? {}),
    origin: 'mine',
  };
  for (const effect of manifest.oxidal?.lv2 ?? [])
    Object.assign(effect.controls, live[effect.id]);
  return manifest;
}

/** Adds `effect` at the end of the scene whose TONE3000 chain is `branch`. */
export function addSceneEffect(
  document: RigDocument,
  branch: string,
  effect: DraftEffect,
  live: Record<string, Record<string, number>> = {},
  name?: string,
): RigPublish {
  if (effect.kind !== 'lv2') throw new Error('Only effects go after a scene.');
  const manifest = clone(document, live, name);
  const host = manifest.oxidal;
  const scenes = readScenes<{ branches: { id: string }[] }>(manifest);
  const port = scenes?.branches.findIndex((b) => b.id === branch) ?? -1;
  if (!host || port < 0) throw new Error('This scene cannot take an effect.');
  const sums = ['scene-left', 'scene-right'];
  const into = (sum: string) =>
    host.graph.edges.find((e) => e.to.node === sum && e.to.port === port);
  const [left, right] = [into(sums[0]!), into(sums[1]!)];
  if (!left || !right) throw new Error('This scene cannot take an effect.');
  host.graph.edges = host.graph.edges.filter((e) => e !== left && e !== right);
  const rig = rigBuilder(manifest.id, manifest.name, '', false, manifest);
  const end = rig.chain([effect], [left.from, right.from]);
  host.graph.edges.push(
    { from: end[0], to: { node: sums[0]!, port } },
    { from: end[1], to: { node: sums[1]!, port } },
  );
  return publish(manifest, document.revision);
}

/** Takes an effect out of its scene, joining what was before it to what was after. */
export function removeSceneEffect(
  document: RigDocument,
  id: string,
  live: Record<string, Record<string, number>> = {},
  name?: string,
): RigPublish {
  const manifest = clone(document, live, name);
  const host = manifest.oxidal;
  if (!host?.lv2.some((l) => l.id === id))
    throw new Error('That effect is not in this preset.');
  const mine = new Set([id, `${id}-mono`, `${id}-stereo`]);
  const edges = host.graph.edges;
  // What feeds the effect (through its mono adapter, if any) and what it feeds.
  const entry = host.graph.nodes.some((n) => n.id === `${id}-mono`)
    ? `${id}-mono`
    : id;
  const exit = host.graph.nodes.some((n) => n.id === `${id}-stereo`)
    ? `${id}-stereo`
    : id;
  const before = [0, 1].map(
    (p) => edges.find((e) => e.to.node === entry && e.to.port === p)?.from,
  );
  const after = edges.filter(
    (e) => e.from.node === exit && !mine.has(e.to.node),
  );
  if (!before[0] || !before[1] || !after.length)
    throw new Error('That effect is not wired into a scene.');
  const rewired = after.map((e) => ({
    from: before[e.from.port === 1 ? 1 : 0]!,
    to: e.to,
  }));
  host.graph.edges = [
    ...edges.filter((e) => !mine.has(e.from.node) && !mine.has(e.to.node)),
    ...rewired,
  ];
  host.graph.nodes = host.graph.nodes.filter((n) => !mine.has(n.id));
  host.lv2 = host.lv2.filter((l) => l.id !== id);
  const labels = manifest.extensions['urn:oxidal:authoring']?.labels as
    Record<string, string> | undefined;
  for (const key of mine) if (labels) delete labels[key];
  return publish(manifest, document.revision);
}

type Gain = { node: string; port: number; value: number };
export type { SceneControl };
/** Save as new scene: a new stable id and the current mix, in the draft. */
export type NewScene = {
  id: string;
  name: string;
  gains: Gain[];
  controls?: SceneControl[];
};
type SceneDef = {
  id: string;
  name: string;
  gains: Gain[];
  controls?: SceneControl[];
};
type ScenesExtension = {
  fade_ms: number;
  scenes: SceneDef[];
  branches?: SceneDef[];
};
/** The daemon's limits (`scene_draft.rs`, `manifest/scenes.rs`). */
export const MAX_SCENES = 64;
export const MAX_SCENE_CONTROLS = 32;
/** Why the last scene cannot be deleted. */
export const LAST_SCENE = 'A preset needs one scene.';
const controlKey = (c: { node: string; symbol: string }) =>
  `${c.node}:${c.symbol}`;
const gainKey = (g: { node: string; port: number }) => `${g.node}:${g.port}`;

function scenesOf(manifest: Manifest): ScenesExtension {
  const extension = readScenes<ScenesExtension>(manifest);
  if (!extension?.scenes?.length || !manifest.oxidal)
    throw new Error('This preset has no scenes.');
  return extension;
}

/** A new scene id that this preset does not use yet. */
function newSceneId(taken: { id: string }[] = []): string {
  for (;;) {
    const id = `scene-${crypto.randomUUID().slice(0, 8)}`;
    if (!taken.some((scene) => scene.id === id)) return id;
  }
}

/** The graph starts where `scene` is: its mix and its effect settings. */
function startOn(manifest: Manifest, scene: SceneDef) {
  for (const gain of scene.gains) {
    const node = manifest.oxidal?.graph.nodes.find((n) => n.id === gain.node);
    if (node?.inputGains && gain.port < node.inputGains.length)
      node.inputGains[gain.port] = gain.value;
  }
  for (const control of scene.controls ?? []) {
    const effect = manifest.oxidal?.lv2.find((l) => l.id === control.node);
    if (effect) effect.controls[control.symbol] = control.value;
  }
}

/** A short name for a block or path in messages: its label, else its id. */
export function blockLabel(manifest: Manifest, node: string): string {
  const labels = (manifest.extensions['urn:oxidal:authoring']?.labels ??
    {}) as Record<string, string>;
  const base = node.replace(/-(left|right|mono|stereo)$/, '');
  return labels[node] ?? labels[base] ?? base;
}

function trimName(name: string): string {
  const label = name.trim();
  if (!label || [...label].length > 128)
    throw new Error('Give the scene a name of up to 128 characters.');
  return label;
}

/** Rename one scene; its id, mix, settings and MIDI binding stay. */
export function renameScene(
  document: RigDocument,
  sceneId: string,
  label: string,
  live: Record<string, Record<string, number>> = {},
  name?: string,
): RigPublish {
  const manifest = clone(document, live, name);
  const scene = scenesOf(manifest).scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error('That scene is not in this preset.');
  scene.name = trimName(label);
  return publish(manifest, document.revision);
}

/**
 * Move a scene one pad left or right. MIDI bindings name the scene, not its
 * position, so they follow it.
 */
export function moveScene(
  document: RigDocument,
  sceneId: string,
  step: -1 | 1,
  live: Record<string, Record<string, number>> = {},
  name?: string,
): RigPublish {
  const manifest = clone(document, live, name);
  const scenes = scenesOf(manifest).scenes;
  const from = scenes.findIndex((s) => s.id === sceneId);
  const to = from + step;
  if (from < 0) throw new Error('That scene is not in this preset.');
  if (to < 0 || to >= scenes.length)
    throw new Error(
      step < 0
        ? 'This is already the first scene.'
        : 'This is already the last scene.',
    );
  [scenes[from], scenes[to]] = [scenes[to]!, scenes[from]!];
  return publish(manifest, document.revision);
}

/**
 * Delete a scene and its MIDI binding. The last scene cannot go. When
 * the deleted scene is the one playing, the preset reopens on its neighbour.
 */
export function deleteScene(
  document: RigDocument,
  sceneId: string,
  playing: string | undefined,
  live: Record<string, Record<string, number>> = {},
  name?: string,
): RigPublish {
  const manifest = clone(document, live, name);
  const extension = scenesOf(manifest);
  const at = extension.scenes.findIndex((s) => s.id === sceneId);
  if (at < 0) throw new Error('That scene is not in this preset.');
  if (extension.scenes.length <= 1) throw new Error(LAST_SCENE);
  const [deleted] = extension.scenes.splice(at, 1);
  // The scene's own path goes with it, unless another scene still opens it.
  // A split needs two paths, so the last two stay.
  const used = new Set(
    extension.scenes.flatMap((s) => scenePaths(s, extension.branches ?? [])),
  );
  const own = scenePaths(deleted!, extension.branches ?? [])
    .filter((path) => !used.has(path))
    .reverse();
  for (const path of own)
    if ((extension.branches?.length ?? 0) > 2)
      removeScenePath(manifest, extension, path);
  const neighbour =
    extension.scenes[Math.min(at, extension.scenes.length - 1)]!;
  if (playing === sceneId || (own.length && startsSilent(manifest, extension)))
    startOn(manifest, neighbour);
  return publish(manifest, document.revision);
}

/**
 * The scene paths a scene opens, as indexes into `branches`: every path with
 * one of its levels above zero in the scene. A duplicated or copied scene has
 * a new id but opens the path of the scene it came from.
 */
export function scenePaths(
  scene: { gains: Gain[] },
  branches: { gains: Gain[] }[],
): number[] {
  const level = new Map(scene.gains.map((g) => [gainKey(g), g.value]));
  return branches.flatMap((branch, index) =>
    branch.gains.some((g) => (level.get(gainKey(g)) ?? 0) !== 0) ? [index] : [],
  );
}

/** No scene path is open in the graph's starting mix. */
function startsSilent(manifest: Manifest, extension: ScenesExtension) {
  const nodes = manifest.oxidal?.graph.nodes ?? [];
  return !(extension.branches ?? []).some((branch) =>
    branch.gains.some(
      (g) => nodes.find((n) => n.id === g.node)?.inputGains?.[g.port] !== 0,
    ),
  );
}

/**
 * Take one scene path out of a preset with scene lanes: its tone, its effects
 * and feed gates, its output of the scene split and its input of the scene
 * sum. Later paths move up one port, in the graph and in every scene.
 */
function removeScenePath(
  manifest: Manifest,
  extension: ScenesExtension,
  path: number,
) {
  const host = manifest.oxidal!;
  const kind = new Map(host.graph.nodes.map((n) => [n.id, n.kind]));
  const splits = ['scene-input-left', 'scene-input-right'];
  const sums = ['scene-left', 'scene-right'];
  const gone = new Set<string>();
  const queue = host.graph.edges
    .filter((e) => splits.includes(e.from.node) && e.from.port === path)
    .map((e) => e.to.node);
  if (
    queue.length !== 2 ||
    !sums.every((sum) => kind.get(sum) === 'merge') ||
    !extension.branches?.[path]
  )
    throw new Error('This preset’s scene paths cannot be changed here.');
  while (queue.length) {
    const id = queue.shift()!;
    if (sums.includes(id) || gone.has(id)) continue;
    gone.add(id);
    for (const e of host.graph.edges)
      if (e.from.node === id) queue.push(e.to.node);
  }
  const instances = new Set(
    host.graph.nodes.flatMap((n) =>
      gone.has(n.id) && n.instance ? [n.instance] : [],
    ),
  );
  const up = (end: { node: string; port: number }, ends: string[]) =>
    ends.includes(end.node) && end.port > path
      ? { ...end, port: end.port - 1 }
      : end;
  host.graph.edges = host.graph.edges
    .filter(
      (e) =>
        !gone.has(e.from.node) &&
        !gone.has(e.to.node) &&
        !(splits.includes(e.from.node) && e.from.port === path),
    )
    .map((e) => ({ from: up(e.from, splits), to: up(e.to, sums) }));
  host.graph.nodes = host.graph.nodes.filter((n) => !gone.has(n.id));
  for (const node of host.graph.nodes) {
    if (splits.includes(node.id)) node.audioOutputs -= 1;
    if (sums.includes(node.id)) {
      node.audioInputs -= 1;
      node.inputGains?.splice(path, 1);
    }
  }
  host.lv2 = host.lv2.filter((l) => !instances.has(l.id));
  manifest.tone3000.instances = manifest.tone3000.instances.filter(
    (i) => !instances.has(i.id),
  );
  // A resource only the removed blocks used is not kept.
  const { resources, ...rest } = manifest;
  const text = JSON.stringify(rest);
  manifest.resources = resources.filter((r) =>
    text.includes(JSON.stringify(r.id)),
  );
  const authoring = manifest.extensions['urn:oxidal:authoring'];
  const labels = authoring?.labels as Record<string, string> | undefined;
  for (const id of gone) if (labels) delete labels[id];
  if (Array.isArray(authoring?.internal_nodes))
    authoring.internal_nodes = (authoring.internal_nodes as string[]).filter(
      (id) => !gone.has(id),
    );
  extension.branches.splice(path, 1);
  for (const scene of [...extension.scenes, ...extension.branches]) {
    scene.gains = scene.gains
      .filter(
        (g) => !gone.has(g.node) && !(sums.includes(g.node) && g.port === path),
      )
      .map((g) => up(g, sums) as Gain);
    if (scene.controls) {
      scene.controls = scene.controls.filter((c) => !instances.has(c.node));
      if (!scene.controls.length) delete scene.controls;
    }
  }
}

/** Duplicate a scene as "Name copy" right after it, with a new id. */
export function duplicateScene(
  document: RigDocument,
  sceneId: string,
  live: Record<string, Record<string, number>> = {},
  name?: string,
): { publish: RigPublish; id: string } {
  const manifest = clone(document, live, name);
  const scenes = scenesOf(manifest).scenes;
  const at = scenes.findIndex((s) => s.id === sceneId);
  if (at < 0) throw new Error('That scene is not in this preset.');
  if (scenes.length >= MAX_SCENES)
    throw new Error(`A preset has at most ${MAX_SCENES} scenes.`);
  const source = scenes[at]!;
  const id = newSceneId(scenes);
  const label = [...`${source.name} copy`].slice(0, 128).join('').trim();
  scenes.splice(at + 1, 0, {
    ...(JSON.parse(JSON.stringify(source)) as SceneDef),
    id,
    name: label,
  });
  return { publish: publish(manifest, document.revision), id };
}

/** What Copy to preset… will do, shown before anything is copied. */
export type SceneCopyPlan = {
  /** Same blocks and paths: every setting copies exactly. */
  exact: boolean;
  /** Settings of the scene the other preset has no place for. */
  skipped: string[];
  /** Settings the other preset has that the scene does not set. */
  kept: string[];
  /** Why nothing can be copied: the presets have nothing in common. */
  refused?: string;
};

/** What a block is: the plugin of an effect, the tone of a capture. */
function blockIdentity(manifest: Manifest, id: string): string | null {
  const node = manifest.oxidal?.graph.nodes.find((n) => n.id === id);
  const instance = node?.instance ?? id;
  if (node?.kind === 'lv2')
    return `effect:${manifest.oxidal?.lv2.find((l) => l.id === instance)?.pluginUri ?? ''}`;
  if (node?.kind === 'tone3000') {
    const preset = manifest.tone3000.instances.find(
      (i) => i.id === instance,
    )?.preset;
    const tone = manifest.resources.find((r) => r.id === preset);
    return `tone:${tone?.sha256 ?? preset ?? ''}`;
  }
  return null;
}

/**
 * What the path behind one scene level is, so two presets are compared by
 * their sounds and not by node names, which scene-lane presets share. A level
 * stage in a chain is `level`. A path is its tones, or its effects when it
 * has no tone, or `dry`: read back from a merge input to the split, or
 * forward from a feed gate to the merge.
 */
function pathIdentity(manifest: Manifest, gain: Gain): string {
  const graph = manifest.oxidal?.graph;
  if (!graph) return '';
  const kind = (id: string) => graph.nodes.find((n) => n.id === id)?.kind;
  const adapter = (id: string) => /-(mono|stereo)$/.test(id);
  const before = (id: string, port: number) =>
    graph.edges.find((e) => e.to.node === id && e.to.port === port)?.from.node;
  const after = (id: string) =>
    graph.edges.find((e) => e.from.node === id && e.from.port === 0)?.to.node;
  const feed = before(gain.node, gain.port);
  const gate =
    kind(gain.node) === 'gain' &&
    !!feed &&
    kind(feed) === 'split' &&
    !adapter(feed);
  if (kind(gain.node) === 'gain' && !gate) return 'level';
  const [opens, closes, end] = gate
    ? ['split', 'merge', 'output']
    : ['merge', 'split', 'input'];
  const found: string[] = [];
  let depth = 0;
  let at = gate ? gain.node : feed;
  for (let guard = 0; at && guard < 256; guard++) {
    const what = kind(at);
    if (what === end) break;
    if (!adapter(at)) {
      if (what === opens) depth++;
      if (what === closes && depth-- === 0) break;
    }
    const block = blockIdentity(manifest, at);
    if (block) found.push(block);
    at = gate ? after(at) : before(at, 0);
  }
  const tones = found.filter((block) => block.startsWith('tone:'));
  return (tones.length ? tones : found).join('|') || 'dry';
}

/** A block's display name, never its id. */
function shownBlock(manifest: Manifest, node: string): string {
  const labels = (manifest.extensions['urn:oxidal:authoring']?.labels ??
    {}) as Record<string, string>;
  const label = labels[node] ?? labels[node.replace(/-(mono|stereo)$/, '')];
  return label ? `'${label}'` : 'An unnamed effect';
}

/** A scene level's path by its display name, never a node id. */
function shownPath(manifest: Manifest, gain: Gain): string {
  const extension = readScenes<ScenesExtension>(manifest);
  const branch = extension?.branches?.find((b) =>
    b.gains.some((g) => gainKey(g) === gainKey(gain)),
  );
  const labels = (manifest.extensions['urn:oxidal:authoring']?.labels ??
    {}) as Record<string, string>;
  const label = labels[gain.node];
  const name =
    branch?.name ??
    (label?.endsWith(' send') ? label.slice(0, -' send'.length) : undefined);
  if (name) return `the '${name}' path`;
  if (pathIdentity(manifest, gain) === 'level') return 'the scene level';
  return `path ${gain.port + 1}`;
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * A scene setting by its control's label, never its symbol: "Delay time".
 * With the effects catalog, a named or on/off value is added: "Mode (Hall)".
 */
function shownSetting(
  manifest: Manifest,
  control: SceneControl,
  plugins: readonly Lv2Plugin[] = [],
): string {
  const label = controlLabel(control.symbol);
  const uri = manifest.oxidal?.lv2.find(
    (l) => l.id === control.node,
  )?.pluginUri;
  const port = plugins
    .find((p) => p.uri === uri)
    ?.ports.find((p) => p.symbol === control.symbol);
  const named =
    scalePointLabel(port?.scale_points, control.value) ??
    (port?.toggled
      ? control.value > (port.minimum ?? 0)
        ? 'On'
        : 'Off'
      : undefined);
  return named ? `${label} (${named})` : label;
}

/**
 * Which settings of `scene` have the same place in `target`: a level whose
 * path is the same sound there, a setting whose effect is the same plugin.
 */
function sceneMatch(
  source: Manifest,
  scene: SceneDef,
  target: Manifest,
  plugins: readonly Lv2Plugin[] = [],
) {
  const shape = scenesOf(target).scenes[0]!;
  const targetName = target.name;
  const gainKeys = new Set(shape.gains.map(gainKey));
  const controlKeys = new Set((shape.controls ?? []).map(controlKey));
  const plugin = (manifest: Manifest, node: string) =>
    manifest.oxidal?.lv2.find((l) => l.id === node)?.pluginUri;
  const gains = new Map<string, number>();
  const controls = new Map<string, number>();
  const skipped = new Set<string>();
  const kept = new Set<string>();
  for (const gain of scene.gains) {
    const path = shownPath(source, gain);
    if (!gainKeys.has(gainKey(gain)))
      skipped.add(
        `${targetName} has no ${path.replace(/^the /, '')}: its level is skipped.`,
      );
    else if (pathIdentity(source, gain) !== pathIdentity(target, gain))
      skipped.add(
        `${sentence(path)} is a different sound in ${targetName}: its level is skipped.`,
      );
    else gains.set(gainKey(gain), gain.value);
  }
  for (const control of scene.controls ?? []) {
    const block = shownBlock(source, control.node);
    const theirs = plugin(target, control.node);
    const setting = shownSetting(source, control, plugins);
    if (theirs === undefined)
      skipped.add(
        `${targetName} has no ${block.replace(/^An /, 'an ')} block: its ${setting} setting is skipped.`,
      );
    else if (theirs !== plugin(source, control.node))
      skipped.add(
        `${block} is a different effect in ${targetName}: its ${setting} setting is skipped.`,
      );
    else if (!controlKeys.has(controlKey(control)))
      skipped.add(
        `${targetName}'s scenes do not change ${block.replace(/^An /, 'an ')} ${setting}: it is skipped.`,
      );
    else controls.set(controlKey(control), control.value);
  }
  for (const gain of shape.gains)
    if (!gains.has(gainKey(gain)))
      kept.add(
        `${sentence(shownPath(target, gain))} keeps ${targetName}'s own level.`,
      );
  for (const control of shape.controls ?? [])
    if (!controls.has(controlKey(control)))
      kept.add(
        `${shownBlock(target, control.node)} keeps ${targetName}'s own ${controlLabel(control.symbol)} setting.`,
      );
  const refused =
    gains.size || controls.size
      ? undefined
      : `'${scene.name}' cannot be copied to ${targetName}: the two presets have no paths or effects in common.`;
  return { gains, controls, skipped, kept, refused };
}

/**
 * Compare a scene with the scenes of another preset. With the effects
 * catalog, skipped settings also name a named or on/off value.
 */
export function sceneCopyPlan(
  source: RigDocument,
  sceneId: string,
  target: RigDocument,
  plugins: readonly Lv2Plugin[] = [],
): SceneCopyPlan {
  const scene = scenesOf(source.manifest).scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error('That scene is not in this preset.');
  const { skipped, kept, refused } = sceneMatch(
    source.manifest,
    scene,
    target.manifest,
    plugins,
  );
  return {
    exact: !skipped.size && !kept.size && !refused,
    skipped: [...skipped],
    kept: [...kept],
    ...(refused ? { refused } : {}),
  };
}

/**
 * Copy one scene to the end of another preset in Mine. Settings the other
 * preset has no place for are skipped; settings it has that the scene does
 * not set keep that preset's own values. Saved as a new version of the other
 * preset, which keeps its place, name and MIDI. Refused when the two presets
 * have nothing in common.
 */
export function copySceneTo(
  source: RigDocument,
  sceneId: string,
  target: RigDocument,
): RigPublish {
  const scene = scenesOf(source.manifest).scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error('That scene is not in this preset.');
  const manifest = clone(target, {});
  const extension = scenesOf(manifest);
  if (extension.scenes.length >= MAX_SCENES)
    throw new Error(`${manifest.name} already has ${MAX_SCENES} scenes.`);
  const shape = extension.scenes[0]!;
  const { gains, controls, refused } = sceneMatch(
    source.manifest,
    scene,
    target.manifest,
  );
  if (refused) throw new Error(refused);
  const graphGain = (g: Gain) =>
    manifest.oxidal!.graph.nodes.find((n) => n.id === g.node)?.inputGains?.[
      g.port
    ] ?? g.value;
  const graphControl = (c: SceneControl) =>
    manifest.oxidal!.lv2.find((l) => l.id === c.node)?.controls[c.symbol] ??
    c.value;
  const copy: SceneDef = {
    id: extension.scenes.some((s) => s.id === scene.id)
      ? newSceneId(extension.scenes)
      : scene.id,
    name: scene.name,
    gains: shape.gains.map((g) => ({
      ...g,
      value: gains.get(gainKey(g)) ?? graphGain(g),
    })),
  };
  if (shape.controls?.length)
    copy.controls = shape.controls.map((c) => ({
      ...c,
      value: controls.get(controlKey(c)) ?? graphControl(c),
    }));
  extension.scenes.push(copy);
  return {
    ...publish(manifest, target.revision),
    source: { kind: 'rig', id: target.revision },
  };
}

/**
 * Writes scene updates held in the editor draft into one publish request
 * (7.7: Update scene changes the draft, Save persists). Each listed scene's
 * snapshot takes its drafted gains; the graph's starting mix only follows the
 * scene named `start`, so the preset reopens where the player left it without
 * a different scene silently becoming the starting one.
 * @see docs/interface.md
 */
export function updateScenes(
  document: RigDocument,
  updates: Record<string, Gain[]>,
  start: string | undefined,
  live: Record<string, Record<string, number>> = {},
  name?: string,
  added: NewScene[] = [],
  controls: Record<string, SceneControl[]> = {},
): RigPublish {
  const manifest = clone(document, live, name);
  const extension = readScenes<{ scenes?: SceneDef[] }>(manifest);
  if (
    !manifest.oxidal ||
    (!Object.keys(updates).length &&
      !added.length &&
      !Object.keys(controls).length)
  )
    throw new Error('There are no scene updates to save.');
  for (const scene of added) {
    const label = scene.name.trim();
    if (!extension?.scenes || !label || [...label].length > 128)
      throw new Error('Give the new scene a name.');
    if (extension.scenes.some((s) => s.id === scene.id))
      throw new Error('That scene already exists.');
    extension.scenes.push({
      id: scene.id,
      name: label,
      gains: scene.gains.map((g) => ({ ...g })),
      ...(scene.controls?.length
        ? { controls: scene.controls.map((c) => ({ ...c })) }
        : {}),
    });
  }
  for (const [sceneId, gains] of Object.entries(updates)) {
    const scene = extension?.scenes?.find((s) => s.id === sceneId);
    if (!scene) throw new Error('This preset cannot update that scene.');
    const values = new Map(gains.map((g) => [`${g.node}:${g.port}`, g.value]));
    scene.gains = scene.gains.map((gain) => ({
      ...gain,
      value: values.get(`${gain.node}:${gain.port}`) ?? gain.value,
    }));
    for (const gain of scene.gains) {
      const node = manifest.oxidal.graph.nodes.find((n) => n.id === gain.node);
      if (!node?.inputGains || gain.port >= node.inputGains.length)
        throw new Error('This scene has an invalid routing target.');
      if (sceneId === start) node.inputGains[gain.port] = gain.value;
    }
  }
  sceneControls(
    document,
    manifest,
    extension?.scenes ?? [],
    controls,
    added,
    start,
    live,
  );
  return publish(manifest, document.revision);
}

/**
 * Effect settings in scenes. Every scene sets the same controls, so a
 * control drafted for one scene is added to all of them: the others keep the
 * value the preset has now. Added scenes get the whole set too. The effect
 * itself starts at the starting scene's value.
 */
function sceneControls(
  document: RigDocument,
  manifest: Manifest,
  scenes: SceneDef[],
  drafted: Record<string, SceneControl[]>,
  added: NewScene[],
  start: string | undefined,
  live: Record<string, Record<string, number>>,
) {
  const keys: SceneControl[] = [];
  const seen = new Set<string>();
  const offer = (c: SceneControl) => {
    if (seen.has(controlKey(c))) return;
    seen.add(controlKey(c));
    keys.push({ ...c });
  };
  for (const scene of scenes) for (const c of scene.controls ?? []) offer(c);
  for (const list of Object.values(drafted)) for (const c of list) offer(c);
  for (const scene of added) for (const c of scene.controls ?? []) offer(c);
  if (!keys.length) return;
  if (keys.length > MAX_SCENE_CONTROLS)
    throw new Error(
      `Scenes can change at most ${MAX_SCENE_CONTROLS} effect settings in one preset.`,
    );
  for (const key of keys) {
    if (!manifest.oxidal?.lv2.some((l) => l.id === key.node))
      throw new Error('A scene sets an effect that is not in this preset.');
    if (!Number.isFinite(key.value))
      throw new Error('A scene setting must be a number.');
  }
  // What a scene that never set this control sounds like: the saved value.
  const saved = (c: SceneControl) =>
    document.manifest.oxidal?.lv2.find((l) => l.id === c.node)?.controls[
      c.symbol
    ] ??
    live[c.node]?.[c.symbol] ??
    c.value;
  const draftedFor = (sceneId: string) =>
    new Map(
      (
        drafted[sceneId] ??
        added.find((scene) => scene.id === sceneId)?.controls ??
        []
      ).map((c) => [controlKey(c), c.value]),
    );
  for (const scene of scenes) {
    const own = new Map(
      (scene.controls ?? []).map((c) => [controlKey(c), c.value]),
    );
    const mine = draftedFor(scene.id);
    scene.controls = keys.map((key) => ({
      node: key.node,
      symbol: key.symbol,
      value:
        mine.get(controlKey(key)) ?? own.get(controlKey(key)) ?? saved(key),
    }));
    if (scene.id === start)
      for (const c of scene.controls) {
        const effect = manifest.oxidal!.lv2.find((l) => l.id === c.node)!;
        effect.controls[c.symbol] = c.value;
      }
  }
  // Without a starting scene the effects keep the saved values.
  if (!scenes.some((scene) => scene.id === start))
    for (const key of keys) {
      const effect = manifest.oxidal!.lv2.find((l) => l.id === key.node)!;
      const value = document.manifest.oxidal?.lv2.find((l) => l.id === key.node)
        ?.controls[key.symbol];
      if (value !== undefined) effect.controls[key.symbol] = value;
    }
}

/** One scene's update, starting on that scene when reopened. */
export function updateScene(
  document: RigDocument,
  sceneId: string,
  gains: Gain[],
  live: Record<string, Record<string, number>> = {},
  name?: string,
): RigPublish {
  return updateScenes(document, { [sceneId]: gains }, sceneId, live, name);
}

/**
 * A routing change rebuilt from the route keeps the preset's scenes (7.26).
 * Levels for merges that no longer exist are dropped, and every merge input
 * that no scene names yet (a new split or path) is added to each scene at the
 * level the rebuilt graph gives it, so a scene change sets the whole mix.
 * Presets whose scenes are separate TONE3000 branches are not rebuilt this way.
 * @see docs/interface.md
 */
export function keepScenes(
  document: RigDocument,
  request: RigPublish,
): RigPublish {
  const before = readScenes<{
    branches?: unknown[];
    scenes?: { gains: Gain[] }[];
  }>(document.manifest);
  if (!before) return request;
  if (before.branches?.length)
    throw new Error(
      'Each scene of this preset has its own path. Change a path inside its scene.',
    );
  const manifest = JSON.parse(request.manifest_json) as Manifest;
  const nodes = manifest.oxidal?.graph.nodes ?? [];
  const inputs = nodes.flatMap((node) =>
    node.kind === 'merge' && node.inputGains
      ? node.inputGains.map((value, port) => ({ node: node.id, port, value }))
      : [],
  );
  const valid = new Set(
    nodes.flatMap((node) =>
      (node.kind === 'merge' || node.kind === 'gain') && node.inputGains
        ? node.inputGains.map((_, port) => `${node.id}:${port}`)
        : [],
    ),
  );
  const effects = new Set(
    nodes.filter((node) => node.kind === 'lv2').map((node) => node.id),
  );
  const scenes = JSON.parse(JSON.stringify(before)) as typeof before & {
    scenes?: { gains: Gain[]; controls?: SceneControl[] }[];
  };
  for (const scene of scenes.scenes ?? []) {
    // Settings of effects the rebuilt chain no longer has go with them.
    if (scene.controls) {
      scene.controls = scene.controls.filter((c) => effects.has(c.node));
      if (!scene.controls.length) delete scene.controls;
    }
    const kept = scene.gains.filter((g) => valid.has(`${g.node}:${g.port}`));
    const named = new Set(kept.map((g) => `${g.node}:${g.port}`));
    scene.gains = [
      ...kept,
      ...inputs.filter((g) => !named.has(`${g.node}:${g.port}`)),
    ];
  }
  // Scenes switch levels; with no split left there is nothing to switch.
  if (scenes.scenes?.some((scene) => !scene.gains.length))
    throw new Error(
      'A preset with scenes needs a split. Keep at least one split with two paths.',
    );
  writeScenes(manifest, scenes);
  return { ...request, manifest_json: JSON.stringify(manifest) };
}
