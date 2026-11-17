import { blocksOf, isSplit, type Step } from './route';
import type { BlockModel } from '../widgets/block-editor';
import type { SceneModel } from '../widgets/scene-editor';

type Route = Step<BlockModel>[];

function splitsOf(route: Route): Extract<Step<BlockModel>, { split: true }>[] {
  return route.flatMap((step) =>
    isSplit(step) ? [step, ...step.branches.flatMap(splitsOf)] : [],
  );
}

function mapRoute(
  route: Route,
  block: (b: BlockModel) => BlockModel,
  split: (levels: number[] | undefined, id: string) => number[] | undefined,
): Route {
  return route.map((step) =>
    isSplit(step)
      ? {
          ...step,
          levels: split(step.levels, step.id),
          branches: step.branches.map((b) => mapRoute(b, block, split)),
        }
      : block(step),
  );
}

/** The route as a scene plays it: its blocks on or off and its branch levels. */
export function applyScene(route: Route, scene: SceneModel | undefined): Route {
  if (!scene) return route;
  return mapRoute(
    route,
    (b) => {
      const values = scene.values?.[b.id];
      const on = b.id in scene.on ? scene.on[b.id]! : b.on;
      return values || on !== b.on
        ? {
            ...b,
            on,
            controls: values
              ? b.controls.map((c) =>
                  c.id in values ? { ...c, value: values[c.id]! } : c,
                )
              : b.controls,
          }
        : b;
    },
    (levels, id) => scene.levels[id] ?? levels,
  );
}

/** A scene with one control value set (or, with null, back to the preset's). */
export function setSceneValue(
  scene: SceneModel,
  block: string,
  control: string,
  value: number | null,
): SceneModel {
  const own = { ...scene.values?.[block] };
  if (value === null) delete own[control];
  else own[control] = value;
  const values = { ...scene.values, [block]: own };
  if (!Object.keys(own).length) delete values[block];
  return { ...scene, values, edited: true };
}

/** How many of a block's values this scene sets. */
export const sceneValueCount = (scene: SceneModel, block: string) =>
  Object.keys(scene.values?.[block] ?? {}).length;

/** Blocks whose on or off in this scene differs from the preset. */
export function sceneDifferences(route: Route, scene: SceneModel): string[] {
  return blocksOf(route)
    .filter(
      (b) =>
        (b.id in scene.on && scene.on[b.id] !== b.on) ||
        Boolean(scene.values?.[b.id]),
    )
    .map((b) => b.id);
}

/**
 * An edit made in the chain while a scene is being edited: on or off and
 * branch levels and control values go to the scene; the shape of the rig
 * (moves, new blocks, removals) goes to the preset.
 */
export function splitSceneEdit(
  next: Route,
  base: Route,
  scene: SceneModel,
): { route: Route; scene: SceneModel } {
  const baseBlocks = new Map(blocksOf(base).map((b) => [b.id, b]));
  const baseLevels = new Map(splitsOf(base).map((s) => [s.id, s.levels]));
  const on = { ...scene.on };
  const values: Record<string, Record<string, number>> = {};
  for (const b of blocksOf(next)) {
    const was = baseBlocks.get(b.id);
    if (!was) continue;
    if (b.on === was.on) delete on[b.id];
    else on[b.id] = b.on;
    for (const c of b.controls) {
      const from = was.controls.find((x) => x.id === c.id);
      if (from && from.value !== c.value) (values[b.id] ??= {})[c.id] = c.value;
    }
  }
  const levels = { ...scene.levels };
  for (const s of splitsOf(next)) {
    if (!baseLevels.has(s.id)) continue;
    const was = baseLevels.get(s.id);
    const same =
      (s.levels ?? []).length === (was ?? []).length &&
      (s.levels ?? []).every((v, i) => v === was?.[i]);
    if (same) delete levels[s.id];
    else if (s.levels) levels[s.id] = s.levels;
  }
  const route = mapRoute(
    next,
    (b) => {
      const was = baseBlocks.get(b.id);
      return was ? { ...b, on: was.on, controls: was.controls } : b;
    },
    (lv, id) => (baseLevels.has(id) ? baseLevels.get(id) : lv),
  );
  return { route, scene: { ...scene, on, levels, values, edited: true } };
}
