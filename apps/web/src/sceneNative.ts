import type { RigDocument } from './api';
import type { SceneNativeControl } from './generated/contract';

export type NativeScene = {
  id: string;
  controls?: unknown[];
  native_controls?: SceneNativeControl[];
};
export const nativeSceneKey = (c: { node: string; parameter: string }) =>
  JSON.stringify([c.node, c.parameter]);

/** Match the backend's final-colon split; inner block IDs may contain colons. */
export const isCaptureParameter = (parameter: string) =>
  parameter.length <= 200 &&
  !Array.from(parameter).some((c) => {
    const value = c.codePointAt(0)!;
    return value < 32 || (value >= 127 && value <= 159);
  }) &&
  /^block:.+:(inputGain|outputGain|mix)$/.test(parameter);

/** Native capture settings use exact control IDs and verified immutable defaults. */
export function applyNativeSceneControls(
  manifest: RigDocument['manifest'],
  definition: { scenes: NativeScene[]; initial_scene?: string },
  drafted: Record<string, SceneNativeControl[]>,
  defaults: readonly SceneNativeControl[],
  start?: string,
) {
  const nodes = new Set(
    manifest.oxidal?.graph.nodes
      .filter((n) => n.kind === 'tone3000')
      .map((n) => n.id),
  );
  const baseline = new Map(defaults.map((c) => [nativeSceneKey(c), c.value]));
  const targets = new Map<string, SceneNativeControl>();
  for (const [id, list] of Object.entries(drafted)) {
    if (!definition.scenes.some((s) => s.id === id))
      throw new Error('This preset cannot update that scene.');
    if (new Set(list.map(nativeSceneKey)).size !== list.length)
      throw new Error('A scene names a capture setting twice.');
  }
  for (const list of [
    ...definition.scenes.map((s) => s.native_controls ?? []),
    ...Object.values(drafted),
  ]) {
    for (const c of list) {
      if (
        !nodes.has(c.node) ||
        !isCaptureParameter(c.parameter) ||
        !Number.isFinite(c.value) ||
        c.value < 0 ||
        c.value > 1
      )
        throw new Error('This scene has an invalid capture setting.');
      targets.set(nativeSceneKey(c), c);
    }
  }
  if (!targets.size) return;
  if (start !== undefined && !definition.scenes.some((s) => s.id === start))
    throw new Error('That starting scene is not in this preset.');
  if (
    targets.size +
      Math.max(0, ...definition.scenes.map((s) => s.controls?.length ?? 0)) >
    32
  )
    throw new Error(
      'Scenes can change at most 32 effect and capture settings in one preset.',
    );
  const completed = definition.scenes.map((scene) => {
    const own = new Map(
      scene.native_controls?.map((c) => [nativeSceneKey(c), c.value]),
    );
    const edits = new Map(
      drafted[scene.id]?.map((c) => [nativeSceneKey(c), c.value]),
    );
    return [...targets].map(([key, c]) => {
      const value = edits.get(key) ?? own.get(key) ?? baseline.get(key);
      if (
        value === undefined ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1
      )
        throw new Error(
          'Saved capture values are unavailable. Save and reopen this capture before adding its scene settings.',
        );
      return { node: c.node, parameter: c.parameter, value };
    });
  });
  definition.scenes.forEach((scene, i) => {
    scene.native_controls = completed[i];
  });
  if (start !== undefined) {
    definition.initial_scene = start;
  }
}
