import type { Lv2Plugin, RigDocument } from './api';
import { sceneControlPort } from './features/rig/SceneEditorSettings';
import type { SceneControl, Scenes, VersionTarget } from './generated/contract';
import { controlLabel, lv2Control } from './lv2Control';
import { blockLabel, MAX_SCENE_CONTROLS, updateScenes } from './sceneEdit';
import { readScenes } from './sceneFormat';

type Selection = {
  sourceBlock: string;
  destinationScene: string;
  destinationBlock: string;
};

type ReadyCopy = {
  revision: string;
  destinationScene: string;
  controls: SceneControl[];
  rows: { id: string; label: string; before: string; after: string }[];
};

type Plan = ReadyCopy | { refusal: string };

export function sceneBlockChoices(document: RigDocument, sourceId: string) {
  const scenes = readScenes<Scenes>(document.manifest)?.scenes ?? [];
  const source = scenes.find((scene) => scene.id === sourceId);
  const nodes = document.manifest.oxidal?.graph.nodes ?? [];
  const blocks = nodes
    .filter((node) => node.kind === 'lv2' || node.kind === 'tone3000')
    .map((node) => ({
      id: node.id,
      name: blockLabel(document.manifest, node.id),
    }));
  return {
    sourceBlocks: blocks.filter((block) =>
      source?.controls?.some((setting) => setting.node === block.id),
    ),
    destinationBlocks: blocks,
    destinationScenes: scenes.filter((scene) => scene.id !== sourceId),
  };
}

/** Preview only saved scene overrides from the selected block. */
export function planSceneBlockCopy(
  document: RigDocument,
  sourceId: string,
  selection: Selection,
  plugins: readonly Lv2Plugin[],
): Plan {
  const { sourceBlock, destinationScene, destinationBlock } = selection;
  const scenes = readScenes<Scenes>(document.manifest)?.scenes ?? [];
  const source = scenes.find((scene) => scene.id === sourceId);
  const target = scenes.find((scene) => scene.id === destinationScene);
  if (!source || !target || source.id === target.id)
    return { refusal: 'Choose a different destination scene.' };

  const host = document.manifest.oxidal;
  const effect = (nodeId: string) => {
    const node = host?.graph.nodes.find((node) => node.id === nodeId);
    if (node?.kind === 'lv2')
      return host?.lv2.find((item) => item.id === node.instance);
  };
  const from = effect(sourceBlock);
  const to = effect(destinationBlock);
  if (!from || !to || from.pluginUri !== to.pluginUri)
    return {
      refusal: 'Choose a destination block that uses the same effect plugin.',
    };
  const plugin = plugins.find(
    (item) => item.uri === from.pluginUri && !item.unsupported,
  );
  if (!plugin)
    return {
      refusal: 'The effect’s installed control information is unavailable.',
    };
  const settings = (source.controls ?? []).filter(
    (row) => row.node === sourceBlock,
  );
  if (!settings.length)
    return {
      refusal: 'The source scene has no saved settings for that block.',
    };

  const controls: ReadyCopy['controls'] = [];
  const rows: ReadyCopy['rows'] = [];
  let added = 0;
  for (const row of settings) {
    const port = sceneControlPort(plugin, row.symbol);
    const scale = port && lv2Control(port);
    if (!port || !scale)
      return {
        refusal: `${controlLabel(row.symbol)} is unavailable as a scene setting on the destination block.`,
      };
    const previous = target.controls?.find(
      (item) => item.node === destinationBlock && item.symbol === row.symbol,
    );
    const baseline = to.controls[row.symbol];
    const before = previous?.value ?? baseline;
    if (before === undefined || !Number.isFinite(before))
      return {
        refusal: `The destination has no saved value for ${controlLabel(row.symbol)}.`,
      };
    const accepts = (value: number) =>
      value >= scale.min &&
      value <= scale.max &&
      Math.abs(scale.native(scale.normalized(value)) - value) < 1e-6 &&
      (!port.enumeration ||
        !!port.scale_points?.some((point) => point.value === value));
    if (!accepts(row.value) || !accepts(before))
      return {
        refusal: `${controlLabel(row.symbol)} has a value outside the destination port’s supported range or steps.`,
      };
    if (before === row.value) continue;
    if (!previous) added++;
    const display = (value: number) =>
      port.unit
        ? `${scale.format(scale.normalized(value))} ${port.unit}`
        : scale.format(scale.normalized(value));
    rows.push({
      id: row.symbol,
      label: port.name ?? controlLabel(row.symbol),
      before: display(before),
      after: display(row.value),
    });
    controls.push({
      node: destinationBlock,
      symbol: row.symbol,
      value: row.value,
    });
  }
  if (
    (target.controls?.length ?? 0) +
      (target.native_controls?.length ?? 0) +
      added >
    MAX_SCENE_CONTROLS
  )
    return {
      refusal: `Scenes can store up to ${MAX_SCENE_CONTROLS} effect and capture control settings in this preset.`,
    };
  if (!controls.length)
    return { refusal: 'The destination already has these settings.' };
  return { revision: document.revision, destinationScene, controls, rows };
}

/** Advance one version using the exact content and catalog revision reviewed. */
export function publishSceneBlockCopy(
  document: RigDocument,
  plan: ReadyCopy,
  version: VersionTarget,
) {
  if (
    plan.revision !== document.revision ||
    version.expected_content !== document.revision
  )
    throw new Error(
      'The destination changed. Reopen the saved version and review the settings again.',
    );
  return {
    ...updateScenes(document, {}, undefined, {}, undefined, [], {
      [plan.destinationScene]: plan.controls,
    }),
    source: { kind: 'rig' as const, id: document.revision },
    version_target: version,
  };
}
