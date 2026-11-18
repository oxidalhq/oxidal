import { Copy, DotsThree, Plus, Trash } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { sceneColour } from '../lib/scene-colours';
import { SceneStripe } from './scene-pad';
import {
  blocksOf,
  branchName,
  insertStep,
  isSplit,
  locate,
  removeStep,
  type Step,
} from '../lib/route';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Slider } from '../components/ui/slider';
import { Caption } from '../components/ui/text';
import type { BlockModel } from './block-editor';

/** A branch level this low is silent. */
export const SILENT = -60;

/** What a scene stores: which blocks are on and how loud each branch of each split is. */
export type SceneModel = {
  id: string;
  name: string;
  /** Block id → on. Blocks not listed keep the preset's setting. */
  on: Record<string, boolean>;
  /** Split id → level of each branch in dB; SILENT is off. */
  levels: Record<string, number[]>;
  /** Block id → control id → value this scene sets instead of the preset's. */
  values?: Record<string, Record<string, number>>;
  edited?: boolean;
};

type Row =
  | { type: 'block'; block: BlockModel; depth: number; branch?: string }
  | {
      type: 'branch';
      split: string;
      index: number;
      name: string;
      level: number;
      depth: number;
      key: string;
    };

function rowsOf(route: Step<BlockModel>[], depth = 0, branch?: string): Row[] {
  return route.flatMap((step): Row[] =>
    isSplit(step)
      ? step.branches.flatMap((list, index) => {
          const key = `${step.id}:${index}`;
          return [
            {
              type: 'branch' as const,
              split: step.id,
              index,
              name: branchName(step, index),
              level: step.levels?.[index] ?? 0,
              depth,
              key,
            },
            ...rowsOf(list, depth + 1, key),
          ];
        })
      : [{ type: 'block', block: step, depth, branch }],
  );
}

const db = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)} dB`;

/**
 * Edit scenes as a grid: your scenes across the top, every block and every
 * branch of every split down the side. Each square says whether that block
 * (or branch) plays in that scene; a branch that plays also has its level.
 *
 * - **Tap a scene name** to hear it; the column stays highlighted.
 * - **Tap a square** to turn the block or branch on or off in that scene.
 *   A block inside a silent branch is greyed: it is not heard there.
 * - **Duplicate** a block (its ⋯) to keep the same pedal or NAM capture
 *   twice with different settings; the copy starts off in every scene, so
 *   nothing you hear changes until you choose which scenes use it.
 * - Off blocks and silent branches keep running, so switching scenes has
 *   no gap and trails carry over.
 */
export function SceneEditor({
  route,
  onRoute,
  scenes,
  onScenes,
  active,
  onSelect,
  className,
}: {
  route: Step<BlockModel>[];
  onRoute: (route: Step<BlockModel>[]) => void;
  scenes: SceneModel[];
  onScenes: (scenes: SceneModel[]) => void;
  active: string | null;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const rows = rowsOf(route);
  const branchLevel = (scene: SceneModel, split: string, index: number) => {
    const row = rows.find(
      (r) => r.type === 'branch' && r.split === split && r.index === index,
    );
    return (
      scene.levels[split]?.[index] ?? (row?.type === 'branch' ? row.level : 0)
    );
  };
  const heard = (scene: SceneModel, key?: string) => {
    if (!key) return true;
    const [split, index] = key.split(':');
    return branchLevel(scene, split!, Number(index)) > SILENT;
  };
  const blockOn = (scene: SceneModel, block: BlockModel) =>
    scene.on[block.id] ?? block.on;

  const change = (id: string, edit: (scene: SceneModel) => SceneModel) =>
    onScenes(
      scenes.map((s) => (s.id === id ? { ...edit(s), edited: true } : s)),
    );
  const setLevel = (
    scene: SceneModel,
    split: string,
    index: number,
    level: number,
  ) =>
    change(scene.id, (s) => {
      const count = rows.filter(
        (r) => r.type === 'branch' && r.split === split,
      ).length;
      const levels = Array.from({ length: count }, (_, i) =>
        branchLevel(s, split, i),
      );
      levels[index] = level;
      return { ...s, levels: { ...s.levels, [split]: levels } };
    });

  const duplicate = (block: BlockModel) => {
    const at = locate(route, block.id);
    if (!at) return;
    const taken = new Set(blocksOf(route).map((b) => b.label));
    let n = 2;
    while (taken.has(`${block.label} (${n})`)) n++;
    const copy: BlockModel = {
      ...structuredClone(block),
      id: `${block.id}-${n}`,
      label: `${block.label} (${n})`,
    };
    onRoute(insertStep(route, at.path, at.index + 1, copy));
    onScenes(scenes.map((s) => ({ ...s, on: { ...s.on, [copy.id]: false } })));
  };
  const remove = (block: BlockModel) => {
    onRoute(removeStep(route, block.id));
    onScenes(
      scenes.map((s) => {
        const on = { ...s.on };
        delete on[block.id];
        return { ...s, on };
      }),
    );
  };
  const addScene = () => {
    const from = scenes.find((s) => s.id === active) ?? scenes[0];
    const id = `scene-${scenes.length + 1}`;
    onScenes([
      ...scenes,
      {
        id,
        name: `Scene ${scenes.length + 1}`,
        on: { ...(from?.on ?? {}) },
        levels: structuredClone(from?.levels ?? {}),
      },
    ]);
    onSelect(id);
  };

  return (
    <div className={cn('grid min-w-0 gap-2', className)}>
      <div
        data-slot="scene-editor"
        className="max-w-full overflow-x-auto rounded-lg border border-border bg-card"
      >
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Which blocks and branches play in each scene
          </caption>
          <thead>
            <tr className="border-b border-border">
              <th
                scope="col"
                className="sticky left-0 z-10 bg-card px-3 py-2 text-left"
              >
                <Caption as="span" className="small-caps text-xs">
                  Block or branch
                </Caption>
              </th>
              {scenes.map((scene, i) => (
                <th key={scene.id} scope="col" className="p-1">
                  <button
                    type="button"
                    aria-pressed={scene.id === active}
                    onClick={() => onSelect(scene.id)}
                    className={cn(
                      'relative grid min-h-touch w-full min-w-[4.5rem] content-center overflow-hidden rounded-md px-2 text-center hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring',
                      scene.id === active &&
                        'bg-foreground text-background hover:bg-foreground',
                    )}
                  >
                    <SceneStripe colour={sceneColour(i)} />
                    <span className="small-caps text-xs opacity-70">
                      {i + 1}
                    </span>
                    <span className="truncate text-sm font-semibold">
                      {scene.name}
                    </span>
                  </button>
                </th>
              ))}
              <th scope="col" className="p-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={addScene}
                  aria-label="Add a scene"
                >
                  <Plus />
                </Button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) =>
              row.type === 'branch' ? (
                <tr
                  key={row.key}
                  data-row="branch"
                  className="border-t border-border bg-muted/40"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-muted px-3 py-1 text-left"
                    style={{ paddingLeft: `${0.75 + row.depth}rem` }}
                  >
                    <span className="grid">
                      <span className="small-caps text-xs text-muted-foreground">
                        Branch
                      </span>
                      <span className="truncate font-semibold">{row.name}</span>
                    </span>
                  </th>
                  {scenes.map((scene) => {
                    const level = branchLevel(scene, row.split, row.index);
                    const on = level > SILENT;
                    return (
                      <td
                        key={scene.id}
                        className={cn(
                          'p-1 text-center',
                          scene.id === active && 'bg-accent',
                        )}
                      >
                        <span className="inline-flex flex-col items-center gap-0.5">
                          <Square
                            on={on}
                            label={`${row.name} branch in ${scene.name}`}
                            onChange={(next) =>
                              setLevel(
                                scene,
                                row.split,
                                row.index,
                                next ? 0 : SILENT,
                              )
                            }
                          />
                          {on && (
                            <LevelButton
                              level={level}
                              name={`${row.name} level in ${scene.name}`}
                              onLevel={(v) =>
                                setLevel(scene, row.split, row.index, v)
                              }
                            />
                          )}
                        </span>
                      </td>
                    );
                  })}
                  <td />
                </tr>
              ) : (
                <tr
                  key={row.block.id}
                  data-row="block"
                  className="border-t border-border"
                >
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-card px-3 py-1 text-left font-normal"
                    style={{ paddingLeft: `${0.75 + row.depth}rem` }}
                  >
                    <span className="grid">
                      <span className="truncate font-semibold">
                        {row.block.label}
                      </span>
                      <Caption as="span" className="truncate text-xs">
                        {row.block.caption ?? row.block.kind}
                      </Caption>
                    </span>
                  </th>
                  {scenes.map((scene) => (
                    <td
                      key={scene.id}
                      className={cn(
                        'p-1 text-center',
                        scene.id === active && 'bg-accent',
                        !heard(scene, row.branch) && 'opacity-40',
                      )}
                    >
                      <Square
                        on={blockOn(scene, row.block)}
                        label={`${row.block.label} in ${scene.name}`}
                        onChange={(on) =>
                          change(scene.id, (s) => ({
                            ...s,
                            on: { ...s.on, [row.block.id]: on },
                          }))
                        }
                      />
                      {Object.keys(scene.values?.[row.block.id] ?? {}).length >
                        0 && (
                        <span className="block font-mono text-2xs text-muted-foreground">
                          {
                            Object.keys(scene.values?.[row.block.id] ?? {})
                              .length
                          }{' '}
                          set
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="p-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`More for ${row.block.label}`}
                        >
                          <DotsThree />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => duplicate(row.block)}>
                          <Copy /> Duplicate with its settings
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => remove(row.block)}>
                          <Trash /> Remove from the preset
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      <Caption className="text-xs">
        Filled squares play in that scene; "2 set" means the scene sets two of
        that block's values (choose This scene in the chain and change them
        there). Nothing here stops: an off block is bypassed and a silent branch
        is muted, but both keep running, so a scene change has no gap. To use
        the same pedal or capture with other settings, duplicate it: the copy
        starts off everywhere.
      </Caption>
    </div>
  );
}

function Square({
  on,
  label,
  onChange,
}: {
  on: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="group inline-grid size-touch place-items-center rounded-md hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-5 rounded-[5px] border-2',
          on
            ? 'border-foreground bg-foreground'
            : 'border-dashed border-muted-foreground bg-transparent',
        )}
      />
    </button>
  );
}

function LevelButton({
  level,
  name,
  onLevel,
}: {
  level: number;
  name: string;
  onLevel: (level: number) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${db(level)} · ${name}`}
          className="rounded px-1 font-mono text-xs text-muted-foreground tabular-nums hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {db(level)}
        </button>
      </PopoverTrigger>
      <PopoverContent aria-label={name}>
        <Slider
          label={name}
          min={-24}
          max={6}
          step={1}
          value={[level]}
          onValueChange={([v]) => v !== undefined && onLevel(v)}
          readout={db(level)}
        />
      </PopoverContent>
    </Popover>
  );
}
