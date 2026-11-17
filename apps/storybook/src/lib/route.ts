/**
 * The signal route as the engine stores it (`apps/web/src/rigRoute.ts`): a
 * list of steps where a step is a block or a split. A split fans the signal
 * into branches, each a list of steps that may split again, and joins them
 * after the last branch block. An empty branch is a dry path.
 *
 * Everything here is immutable: each edit returns a new route.
 */
export type Split<B> = {
  split: true;
  id: string;
  branches: Step<B>[][];
  /** Level of each branch at the join, in dB. */
  levels?: number[];
  /** The player's name for each branch ("Clean", "Lead"); unnamed branches use letters. */
  names?: string[];
};

/** A branch's name, or its letter: A, B … Z, then 27, 28. */
export function branchName<B>(split: Split<B>, branch: number): string {
  const name = split.names?.[branch]?.trim();
  if (name) return name;
  return branch < 26 ? String.fromCharCode(65 + branch) : String(branch + 1);
}

export type Step<B> = B | Split<B>;

/**
 * Where a list of steps sits: [] is the main line; [i, b] is branch b of the
 * split at step i of the main line; [i, b, j, c] goes one split deeper.
 */
export type ListPath = number[];

export const isSplit = <B>(step: Step<B>): step is Split<B> =>
  typeof step === 'object' &&
  step !== null &&
  'split' in step &&
  (step as Split<B>).split === true;

type Keyed = { id: string };

export function getList<B>(route: Step<B>[], path: ListPath): Step<B>[] {
  let list = route;
  for (let i = 0; i < path.length; i += 2) {
    const step = list[path[i]!];
    if (!step || !isSplit(step)) return [];
    list = step.branches[path[i + 1]!] ?? [];
  }
  return list;
}

function setList<B>(
  route: Step<B>[],
  path: ListPath,
  next: Step<B>[],
): Step<B>[] {
  if (!path.length) return next;
  const [i, b, ...rest] = path as [number, number, ...number[]];
  return route.map((step, index) => {
    if (index !== i || !isSplit(step)) return step;
    const branches = step.branches.map((branch, at) =>
      at === b ? setList(branch, rest, next) : branch,
    );
    return { ...step, branches };
  });
}

/** Every block in signal order (branches in order). */
export function blocksOf<B extends Keyed>(route: Step<B>[]): B[] {
  return route.flatMap((step) =>
    isSplit(step)
      ? step.branches.flatMap((branch) => blocksOf(branch))
      : [step],
  );
}

/** The list and index of a step by id. */
export function locate<B extends Keyed>(
  route: Step<B>[],
  id: string,
  path: ListPath = [],
): { path: ListPath; index: number } | null {
  const list = getList(route, path);
  for (let index = 0; index < list.length; index++) {
    const step = list[index]!;
    if (step.id === id) return { path, index };
    if (isSplit(step))
      for (let b = 0; b < step.branches.length; b++) {
        const found = locate(route, id, [...path, index, b]);
        if (found) return found;
      }
  }
  return null;
}

/** Tidy after an edit: a split with no blocks in any branch disappears; a split with one branch flattens into its list. */
export function tidy<B extends Keyed>(list: Step<B>[]): Step<B>[] {
  return list.flatMap((step) => {
    if (!isSplit(step)) return [step];
    const branches = step.branches.map((branch) => tidy(branch));
    if (branches.every((branch) => branch.length === 0)) return [];
    if (branches.length === 1) return branches[0]!;
    return [{ ...step, branches }];
  });
}

export function updateBlock<B extends Keyed>(
  route: Step<B>[],
  id: string,
  change: (block: B) => B,
): Step<B>[] {
  return route.map((step) =>
    isSplit(step)
      ? {
          ...step,
          branches: step.branches.map((branch) =>
            updateBlock(branch, id, change),
          ),
        }
      : step.id === id
        ? change(step)
        : step,
  );
}

export function removeStep<B extends Keyed>(
  route: Step<B>[],
  id: string,
): Step<B>[] {
  const at = locate(route, id);
  if (!at) return route;
  const list = getList(route, at.path);
  return tidy(
    setList(
      route,
      at.path,
      list.filter((_, i) => i !== at.index),
    ),
  );
}

export function insertStep<B extends Keyed>(
  route: Step<B>[],
  path: ListPath,
  index: number,
  step: Step<B>,
): Step<B>[] {
  const list = getList(route, path);
  const next = [...list.slice(0, index), step, ...list.slice(index)];
  return setList(route, path, next);
}

/**
 * Move a block to `index` in the list at `path`. `index` counts positions in
 * the target list as it is before the move, as a drop target sees it.
 */
export function moveStep<B extends Keyed>(
  route: Step<B>[],
  id: string,
  path: ListPath,
  index: number,
): Step<B>[] {
  const from = locate(route, id);
  if (!from) return route;
  const step = getList(route, from.path)[from.index]!;
  const sameList =
    from.path.length === path.length &&
    from.path.every((v, i) => v === path[i]);
  const target = sameList && from.index < index ? index - 1 : index;
  if (sameList && target === from.index) return route;
  // Insert first with a placeholder so list paths stay valid, then remove the original.
  const marker = { ...step, id: `${step.id}\u0000moving` } as Step<B>;
  let next = insertStep(
    route,
    path,
    sameList ? (from.index < index ? index : index) : index,
    marker,
  );
  next = removeStep(next, id);
  return tidy(
    updateBlock(next, `${step.id}\u0000moving`, (b) => ({ ...b, id: step.id })),
  );
}

let splitCounter = 0;
const newSplitId = () => `split-${Date.now().toString(36)}-${++splitCounter}`;

/**
 * Run `moved` in parallel with `target`: the target is wrapped in a split
 * whose second branch holds the moved block (QC's "drag below to make a
 * second row"). If the target already sits in a branch, a branch is added
 * to that split instead.
 */
export function branchWith<B extends Keyed>(
  route: Step<B>[],
  targetId: string,
  movedId: string,
): Step<B>[] {
  if (targetId === movedId) return route;
  const moved = blocksOf(route).find((b) => b.id === movedId);
  if (!moved) return route;
  let next = removeStep(route, movedId);
  const at = locate(next, targetId);
  if (!at) return route;
  const target = getList(next, at.path)[at.index]!;
  const split: Split<B> = {
    split: true,
    id: newSplitId(),
    branches: [[target], [moved]],
    levels: [0, 0],
  };
  next = setList(
    next,
    at.path,
    getList(next, at.path).map((step, i) => (i === at.index ? split : step)),
  );
  return next;
}

/** Start a parallel dry path around a block: a split with the block and an empty branch. */
export function startBranch<B extends Keyed>(
  route: Step<B>[],
  id: string,
): Step<B>[] {
  const at = locate(route, id);
  if (!at) return route;
  const list = getList(route, at.path);
  const split: Split<B> = {
    split: true,
    id: newSplitId(),
    branches: [[list[at.index]!], []],
    levels: [0, 0],
  };
  return setList(
    route,
    at.path,
    list.map((step, i) => (i === at.index ? split : step)),
  );
}

export function addBranch<B extends Keyed>(
  route: Step<B>[],
  splitId: string,
): Step<B>[] {
  return mapSplit(route, splitId, (split) => ({
    ...split,
    branches: [...split.branches, []],
    levels: [...(split.levels ?? split.branches.map(() => 0)), 0],
    names: split.names && [...split.names, ''],
  }));
}

/** Name a branch; an empty name goes back to its letter. */
export function nameBranch<B extends Keyed>(
  route: Step<B>[],
  splitId: string,
  branch: number,
  name: string,
): Step<B>[] {
  return mapSplit(route, splitId, (split) => {
    const names = split.branches.map((_, b) => split.names?.[b] ?? '');
    names[branch] = name;
    return { ...split, names };
  });
}

export function setBranchLevel<B extends Keyed>(
  route: Step<B>[],
  splitId: string,
  branch: number,
  level: number,
): Step<B>[] {
  return mapSplit(route, splitId, (split) => {
    const levels = [...(split.levels ?? split.branches.map(() => 0))];
    levels[branch] = level;
    return { ...split, levels };
  });
}

/** Join a split back into one path: its branches' blocks in order, one after another. */
export function joinSplit<B extends Keyed>(
  route: Step<B>[],
  splitId: string,
): Step<B>[] {
  const at = locate(route, splitId);
  if (!at) return route;
  const list = getList(route, at.path);
  const split = list[at.index] as Split<B>;
  const flat = split.branches.flat();
  return tidy(
    setList(route, at.path, [
      ...list.slice(0, at.index),
      ...flat,
      ...list.slice(at.index + 1),
    ]),
  );
}

function mapSplit<B extends Keyed>(
  route: Step<B>[],
  id: string,
  change: (split: Split<B>) => Split<B>,
): Step<B>[] {
  return route.map((step) => {
    if (!isSplit(step)) return step;
    const inner = {
      ...step,
      branches: step.branches.map((branch) => mapSplit(branch, id, change)),
    };
    return step.id === id ? change(inner) : inner;
  });
}

/** Every list a block can sit in: the main line, then each branch of each split, in order. */
export function placesOf<B extends Keyed>(
  route: Step<B>[],
  path: ListPath = [],
  prefix = '',
): { path: ListPath; label: string }[] {
  const here = path.length ? [] : [{ path, label: 'Main line' }];
  return [
    ...here,
    ...getList(route, path).flatMap((step, index) =>
      isSplit(step)
        ? step.branches.flatMap((_, b) => {
            const label = `${prefix}${branchName(step, b)}`;
            const at = [...path, index, b];
            return [{ path: at, label }, ...placesOf(route, at, `${label} › `)];
          })
        : [],
    ),
  ];
}
