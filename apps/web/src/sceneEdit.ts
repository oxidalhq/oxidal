import type { RigDocument } from './api';
import type { RigPublish } from './generated/contract';
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
