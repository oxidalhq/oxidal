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
    (b) => (b.id in scene.on ? { ...b, on: scene.on[b.id]! } : b),
    (levels, id) => scene.levels[id] ?? levels,
  );
}

/** Blocks whose on or off in this scene differs from the preset. */
export function sceneDifferences(route: Route, scene: SceneModel): string[] {
  return blocksOf(route)
    .filter((b) => b.id in scene.on && scene.on[b.id] !== b.on)
    .map((b) => b.id);
}

/**
 * An edit made in the chain while a scene is being edited: on or off and
 * branch levels go to the scene; everything else (settings, moves, new
 * blocks) goes to the preset.
 */
export function splitSceneEdit(
  next: Route,
  base: Route,
  scene: SceneModel,
): { route: Route; scene: SceneModel } {
  const baseBlocks = new Map(blocksOf(base).map((b) => [b.id, b]));
  const baseLevels = new Map(splitsOf(base).map((s) => [s.id, s.levels]));
  const on = { ...scene.on };
  for (const b of blocksOf(next)) {
    const was = baseBlocks.get(b.id);
    if (!was) continue;
    if (b.on === was.on) delete on[b.id];
    else on[b.id] = b.on;
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
      return was ? { ...b, on: was.on } : b;
    },
    (lv, id) => (baseLevels.has(id) ? baseLevels.get(id) : lv),
  );
  return { route, scene: { ...scene, on, levels, edited: true } };
}
