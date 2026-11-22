import type { RigDocument } from './api';
import type { RigPublish, Scene, VersionTarget } from './generated/contract';
import { chainRoute } from './rigChain';
import { applySceneBypass } from './sceneBypass';
import { blockLabel } from './sceneEdit';
import { readScenes, sealScenes } from './sceneFormat';

function serialPedal(document: RigDocument, id: string) {
  const host = document.manifest.oxidal;
  const graph = host?.graph;
  const node = graph?.nodes.find((candidate) => candidate.id === id);
  const effect = host?.lv2.find((candidate) => candidate.id === node?.instance);
  if (
    !graph ||
    !node ||
    node.kind !== 'lv2' ||
    !effect ||
    effect.state ||
    ![1, 2].includes(node.audioInputs) ||
    node.audioInputs !== node.audioOutputs
  )
    return;
  const outgoing = graph.edges.filter((edge) => edge.from.node === id);
  if (
    outgoing.length !== node.audioOutputs ||
    new Set(outgoing.map((edge) => edge.from.port)).size !== outgoing.length
  )
    return;
  return { node, effect, outgoing };
}

export function scenePedalCopies(document: RigDocument): Set<string> {
  const graph = document.manifest.oxidal?.graph;
  if (!graph) return new Set();
  return new Set(
    chainRoute(graph)?.filter(
      (step): step is string =>
        typeof step === 'string' && !!serialPedal(document, step),
    ),
  );
}

export function duplicateScenePedal(
  document: RigDocument,
  nodeId: string,
  source: string,
  destination: string,
  version: VersionTarget,
): RigPublish {
  if (version.expected_content !== document.revision)
    throw new Error('This saved version changed. Reopen the scene editor.');
  const manifest = structuredClone(document.manifest);
  const opened = { ...document, manifest };
  const found = scenePedalCopies(opened).has(nodeId)
    ? serialPedal(opened, nodeId)
    : undefined;
  const layout = readScenes<{ scenes: Scene[]; initial_scene?: string }>(
    manifest,
  );
  const sourceScene = layout?.scenes.find((scene) => scene.id === source);
  if (
    !found ||
    !layout ||
    !sourceScene ||
    !layout.scenes.some((scene) => scene.id === destination)
  )
    throw new Error(
      'This effect or scene is no longer available to duplicate.',
    );

  const { node, effect, outgoing } = found;
  // The request ID also fixes the new block identity on an identical retry.
  const id = `effect-${version.request_id}`;
  const host = manifest.oxidal!;
  const controls = { ...effect.controls };
  for (const control of sourceScene.controls ?? [])
    if (control.node === nodeId) controls[control.symbol] = control.value;
  const labels = (manifest.extensions['urn:oxidal:authoring'] ??= {});
  const names = (labels.labels ??= {}) as Record<string, string>;
  const name = [...blockLabel(manifest, nodeId)].slice(0, 115).join('');
  let index = 2;
  while (Object.values(names).includes(`${name} (${index})`)) index++;
  names[id] = `${name} (${index})`;
  host.lv2.push({ ...effect, id, controls });
  host.graph.nodes.push({
    ...node,
    id,
    instance: id,
    bypassed: (layout.initial_scene ?? layout.scenes[0]?.id) !== destination,
  });
  for (const edge of outgoing) {
    const input = edge.from.port;
    edge.from = { node: id, port: input };
    host.graph.edges.push({
      from: { node: nodeId, port: input },
      to: { node: id, port: input },
    });
  }
  applySceneBypass(
    document.manifest,
    manifest,
    layout.scenes,
    Object.fromEntries(
      layout.scenes.map((scene) => [
        scene.id,
        [{ node: id, value: scene.id !== destination }],
      ]),
    ),
    undefined,
  );
  return {
    manifest_json: JSON.stringify(sealScenes(manifest)),
    resources: Object.fromEntries(
      manifest.resources.map(({ id: resource }) => [
        resource,
        { kind: 'bundle', revision: document.revision, resource },
      ]),
    ),
    source: { kind: 'rig', id: document.revision },
    version_target: version,
  };
}
