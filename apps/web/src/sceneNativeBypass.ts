import type { RigDocument } from './api';
import type {
  SceneNativeBypass,
  SceneNativeBypassKey,
} from './generated/contract';

export const nativeBypassKey = (target: SceneNativeBypassKey) =>
  JSON.stringify([target.node, target.block]);
export function canPreviewNativeBypass(
  edits: readonly SceneNativeBypass[] | undefined,
  armed: readonly SceneNativeBypassKey[] | null | undefined,
) {
  const keys = new Set(armed?.map(nativeBypassKey));
  return (edits ?? []).every((row) => keys.has(nativeBypassKey(row)));
}
type Scene = {
  id: string;
  bypass?: { node: string }[];
  native_bypass?: SceneNativeBypass[];
};
const validBlock = (block: string) =>
  block.length > 0 &&
  new TextEncoder().encode(block).length <= 128 &&
  !/[\p{Cc}]/u.test(block);

/** Complete warm inner-block targets from verified saved state, never the playing scene.
 * @see docs/presets/format.md
 */
export function applyNativeSceneBypass(
  manifest: RigDocument['manifest'],
  definition: { scenes: Scene[]; initial_scene?: string },
  drafted: Record<string, SceneNativeBypass[]>,
  defaults: readonly SceneNativeBypass[],
  start?: string,
) {
  const nodes = new Set(
    manifest.oxidal?.graph.nodes
      .filter((n) => n.kind === 'tone3000')
      .map((n) => n.id),
  );
  const baseline = new Map(
    defaults.map((row) => [nativeBypassKey(row), row.value]),
  );
  if (baseline.size !== defaults.length)
    throw new Error(
      'Saved capture block states are ambiguous. Refresh before editing scenes.',
    );
  const existing = new Set(
    definition.scenes.flatMap((scene) =>
      (scene.native_bypass ?? []).map(nativeBypassKey),
    ),
  );
  const targets = new Map<string, SceneNativeBypassKey>();
  for (const [scene, rows] of Object.entries(drafted)) {
    if (!definition.scenes.some((candidate) => candidate.id === scene))
      throw new Error('This preset cannot update that scene.');
    if (new Set(rows.map(nativeBypassKey)).size !== rows.length)
      throw new Error('A scene names a capture block twice.');
  }
  for (const rows of [
    ...definition.scenes.map((scene) => scene.native_bypass ?? []),
    ...Object.values(drafted),
  ]) {
    if (new Set(rows.map(nativeBypassKey)).size !== rows.length)
      throw new Error('A scene names a capture block twice.');
    for (const row of rows) {
      const key = nativeBypassKey(row);
      if (
        !nodes.has(row.node) ||
        !validBlock(row.block) ||
        typeof row.value !== 'boolean'
      )
        throw new Error('This scene has an invalid capture block.');
      if (!existing.has(key) && !baseline.has(key))
        throw new Error(
          'Saved capture block states are unavailable. Save and reopen before adding their scene switches.',
        );
      targets.set(key, { node: row.node, block: row.block });
    }
  }
  const outer = new Set(
    definition.scenes.flatMap(
      (scene) => scene.bypass?.map((row) => row.node) ?? [],
    ),
  );
  if (outer.size + targets.size > 128)
    throw new Error('Scenes can switch at most 128 outer and capture blocks.');
  if (!targets.size) return;
  if (
    start !== undefined &&
    !definition.scenes.some((scene) => scene.id === start)
  )
    throw new Error('That starting scene is not in this preset.');
  const completed = definition.scenes.map((scene) => {
    const saved = new Map(
      scene.native_bypass?.map((row) => [nativeBypassKey(row), row.value]),
    );
    const edits = new Map(
      drafted[scene.id]?.map((row) => [nativeBypassKey(row), row.value]),
    );
    return [...targets].map(([key, target]) => {
      const value = edits.get(key) ?? saved.get(key) ?? baseline.get(key);
      if (typeof value !== 'boolean')
        throw new Error(
          'Saved capture block states are unavailable. Save and reopen before adding their scene switches.',
        );
      return { ...target, value };
    });
  });
  definition.scenes.forEach((scene, index) => {
    scene.native_bypass = completed[index];
  });
  if (start !== undefined) definition.initial_scene = start;
}
