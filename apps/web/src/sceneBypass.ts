import type { RigDocument } from './api';

/** A scene's host bypass; true passes the latency-aligned dry signal. */
export type SceneBypass = { node: string; value: boolean };

type Scene = { id: string; bypass?: SceneBypass[] };

/** Complete each scene's bypass targets from saved defaults, never the last scene. */
export function applySceneBypass(
  original: RigDocument['manifest'],
  manifest: RigDocument['manifest'],
  scenes: Scene[],
  drafted: Record<string, SceneBypass[]>,
  start: string | undefined,
) {
  const nodes = manifest.oxidal?.graph.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const defaults = new Map(
    original.oxidal?.graph.nodes.map((n) => [n.id, n.bypassed ?? false]),
  );
  const targets = new Set<string>();
  for (const [id, list] of Object.entries(drafted)) {
    if (!scenes.some((s) => s.id === id))
      throw new Error('This preset cannot update that scene.');
    const seen = new Set<string>();
    for (const item of list) {
      if (seen.has(item.node)) throw new Error('A scene names a block twice.');
      seen.add(item.node);
    }
  }
  for (const list of [
    ...scenes.map((s) => s.bypass ?? []),
    ...Object.values(drafted),
  ]) {
    for (const item of list) {
      const node = byId.get(item.node);
      if (
        !node ||
        !['tone3000', 'lv2'].includes(node.kind) ||
        typeof item.value !== 'boolean'
      )
        throw new Error('This scene has an invalid bypass target.');
      targets.add(item.node);
    }
  }
  if (targets.size > 128)
    throw new Error('Scenes can bypass at most 128 blocks.');
  if (!targets.size) return;
  for (const scene of scenes) {
    const saved = new Map(scene.bypass?.map((b) => [b.node, b.value]));
    const edits = new Map(drafted[scene.id]?.map((b) => [b.node, b.value]));
    scene.bypass = [...targets].map((node) => ({
      node,
      value: edits.get(node) ?? saved.get(node) ?? defaults.get(node) ?? false,
    }));
    if (scene.id === start)
      for (const item of scene.bypass)
        byId.get(item.node)!.bypassed = item.value;
  }
}
