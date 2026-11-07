import type { ReactNode } from 'react';
import type { IdStep } from '../rigChain';

type Split = Exclude<IdStep, string>;

/**
 * A preset's routing as an indented tree read top to bottom (7.28): serial
 * blocks wrap onto new lines, each split lists its paths with their level into
 * the merge, and nested splits indent again. Phones use it because a sideways
 * chain with nested splits is unreadable at that width.
 * @see docs/interface.md
 */
export function RouteTree({
  route,
  tiles,
  onSplit,
  onAddToPath,
  label = 'Signal chain',
}: {
  route: IdStep[];
  /** The tiles for one block id (a TONE3000 block may draw several). */
  tiles: (id: string) => ReactNode;
  /** Opens the routing controls of a split, when the preset can be edited. */
  onSplit?: (split: Split) => void;
  /** Adds a block at the end of path `index` of `split` (7.28). */
  onAddToPath?: (split: Split, index: number) => void;
  label?: string;
}) {
  return (
    <div className="route-tree" role="group" aria-label={label}>
      <span className="route-port">IN</span>
      <Steps
        steps={route}
        tiles={tiles}
        onSplit={onSplit}
        onAddToPath={onAddToPath}
        prefix=""
      />
      <span className="route-port">OUT</span>
    </div>
  );
}

type Actions = {
  onSplit?: (split: Split) => void;
  onAddToPath?: (split: Split, index: number) => void;
};

function Steps({
  steps,
  tiles,
  onSplit,
  onAddToPath,
  prefix,
}: {
  steps: IdStep[];
  tiles: (id: string) => ReactNode;
  prefix: string;
} & Actions) {
  // Consecutive blocks share one wrapping row; each split is its own group.
  const groups: (string[] | Split)[] = [];
  for (const step of steps) {
    const last = groups.at(-1);
    if (typeof step === 'string') {
      if (Array.isArray(last)) last.push(step);
      else groups.push([step]);
    } else groups.push(step);
  }
  return (
    <>
      {groups.map((group) =>
        Array.isArray(group) ? (
          <div key={group.join('|')} className="route-blocks">
            {group.map((id) => tiles(id))}
          </div>
        ) : (
          <SplitGroup
            key={group.split}
            split={group}
            tiles={tiles}
            onSplit={onSplit}
            onAddToPath={onAddToPath}
            prefix={prefix}
          />
        ),
      )}
    </>
  );
}

function SplitGroup({
  split,
  tiles,
  onSplit,
  onAddToPath,
  prefix,
}: {
  split: Split;
  tiles: (id: string) => ReactNode;
  prefix: string;
} & Actions) {
  const name = (i: number) =>
    prefix ? `${prefix}${String.fromCharCode(97 + i)}` : String(i + 1);
  const title = `Split · ${split.branches.length} paths`;
  return (
    <div className="route-split">
      {onSplit ? (
        <button
          type="button"
          className="route-node"
          aria-label={`${title}: path levels`}
          onClick={() => onSplit(split)}
        >
          <span aria-hidden="true">◆</span> {title}
          <span className="route-node-open" aria-hidden="true">
            ›
          </span>
        </button>
      ) : (
        <div className="route-node">
          <span aria-hidden="true">◆</span> {title}
        </div>
      )}
      <ol className="route-paths">
        {split.branches.map((branch, i) => (
          <li key={`${split.split}-${i}`} className="route-path">
            <div className="route-path-head">
              <span>Path {name(i)}</span>
              <span className="route-path-level">
                {Math.round((split.gains[i] ?? 1) * 100)}%
              </span>
            </div>
            {branch.length ? (
              <Steps
                steps={branch}
                tiles={tiles}
                onSplit={onSplit}
                onAddToPath={onAddToPath}
                prefix={name(i)}
              />
            ) : (
              <span className="route-dry">dry</span>
            )}
            {onAddToPath && (
              <button
                type="button"
                className="route-add"
                aria-label={`Add a block to path ${name(i)}`}
                onClick={() => onAddToPath(split, i)}
              >
                +
              </button>
            )}
          </li>
        ))}
      </ol>
      <div className="route-node" aria-hidden="true">
        ◆ Merge
      </div>
    </div>
  );
}
