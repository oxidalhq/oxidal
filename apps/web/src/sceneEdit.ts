import type { RigDocument } from './api';
import type { RigPublish, SceneControl } from './generated/contract';
import { rigBuilder, type DraftEffect } from './rigDraft';

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
    manifest_json: JSON.stringify(manifest),
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
  const scenes = manifest.extensions['urn:oxidal:scenes:1'] as
    { branches: { id: string }[] } | undefined;
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
/** Why the last scene cannot be deleted (S-12). */
export const LAST_SCENE = 'A preset needs one scene.';
const controlKey = (c: { node: string; symbol: string }) =>
  `${c.node}:${c.symbol}`;
const gainKey = (g: { node: string; port: number }) => `${g.node}:${g.port}`;

function scenesOf(manifest: Manifest): ScenesExtension {
  const extension = manifest.extensions['urn:oxidal:scenes:1'] as
    ScenesExtension | undefined;
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
 * position, so they follow it (S-13).
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
 * Delete a scene and its MIDI binding. The last scene cannot go (S-12). When
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
  extension.scenes.splice(at, 1);
  if (playing === sceneId)
    startOn(
      manifest,
      extension.scenes[Math.min(at, extension.scenes.length - 1)]!,
    );
  return publish(manifest, document.revision);
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

/** What Copy to preset… will do, shown before anything is copied (S-11). */
export type SceneCopyPlan = {
  /** Same blocks and paths: every setting copies exactly. */
  exact: boolean;
  /** Settings of the scene the other preset has no place for. */
  skipped: string[];
  /** Settings the other preset has that the scene does not set. */
  kept: string[];
};

function sceneTargets(scene: SceneDef) {
  return {
    gains: new Set(scene.gains.map(gainKey)),
    controls: new Set((scene.controls ?? []).map(controlKey)),
  };
}

/** Compare a scene with the scenes of another preset. */
export function sceneCopyPlan(
  source: RigDocument,
  sceneId: string,
  target: RigDocument,
): SceneCopyPlan {
  const scene = scenesOf(source.manifest).scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error('That scene is not in this preset.');
  const into = scenesOf(target.manifest).scenes[0]!;
  const from = sceneTargets(scene);
  const to = sceneTargets(into);
  const targetName = target.manifest.name;
  const skipped = new Set<string>();
  const kept = new Set<string>();
  for (const gain of scene.gains)
    if (!to.gains.has(gainKey(gain)))
      skipped.add(
        `${targetName} has no path ${gain.port + 1} at '${blockLabel(source.manifest, gain.node)}': its level is skipped.`,
      );
  for (const control of scene.controls ?? [])
    if (!to.controls.has(controlKey(control)))
      skipped.add(
        `${targetName} has no '${blockLabel(source.manifest, control.node)}' block: its ${control.symbol} setting is skipped.`,
      );
  for (const gain of into.gains)
    if (!from.gains.has(gainKey(gain)))
      kept.add(
        `Path ${gain.port + 1} at '${blockLabel(target.manifest, gain.node)}' keeps ${targetName}'s own level.`,
      );
  for (const control of into.controls ?? [])
    if (!from.controls.has(controlKey(control)))
      kept.add(
        `'${blockLabel(target.manifest, control.node)}' keeps ${targetName}'s own ${control.symbol} setting.`,
      );
  return {
    exact: !skipped.size && !kept.size,
    skipped: [...skipped],
    kept: [...kept],
  };
}

/**
 * Copy one scene to the end of another preset in Mine. Settings the other
 * preset has no place for are skipped; settings it has that the scene does
 * not set keep that preset's own values. Saved as a new version of the other
 * preset, which keeps its place, name and MIDI.
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
  const gains = new Map(scene.gains.map((g) => [gainKey(g), g.value]));
  const controls = new Map(
    (scene.controls ?? []).map((c) => [controlKey(c), c.value]),
  );
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
  const extension = manifest.extensions['urn:oxidal:scenes:1'] as
    { scenes?: SceneDef[] } | undefined;
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
 * Effect settings in scenes (D-6). Every scene sets the same controls, so a
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
  const before = document.manifest.extensions['urn:oxidal:scenes:1'] as
    { branches?: unknown[]; scenes?: { gains: Gain[] }[] } | undefined;
  if (!before) return request;
  if (before.branches?.length)
    throw new Error('Change the routing of scene branches in the scene lanes.');
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
      'A preset with scenes needs a split. Keep at least one parallel path.',
    );
  manifest.extensions['urn:oxidal:scenes:1'] = scenes;
  if (!manifest.requiredExtensions.includes('urn:oxidal:scenes:1'))
    manifest.requiredExtensions.push('urn:oxidal:scenes:1');
  return { ...request, manifest_json: JSON.stringify(manifest) };
}
