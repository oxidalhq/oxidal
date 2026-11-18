import { Button } from '@oxidal/design-system/components/button';

import { type MoveKey, RouteTree } from '../../components/RouteTree';
import { useEpaper } from '../../components/RouteTree.display';
import { routeSpot } from '../../rigChain';
import { pathMix, type RouteAt } from '../../rigRoute';
import { laneBlockId, rigLocked } from './mixedRigViewModel';
import { RigChainSurfaceChooser } from './RigChainSurfaceChooser';
import type { RigViewProps } from './useMixedRigSession';

/**
 * The chain: one renderer (RouteTree) for every preset shape — a straight
 * chain, a routing tree with nested splits, and scene lanes with effects ahead
 * of, inside and after them — and the split row with each split's path
 * levels. A shape the route editor cannot read is drawn folded into paths and
 * cannot be rearranged. Every drag has a key and a button path.
 * @see docs/interface.md
 */
export function RigChainSurface({ rig, vm }: RigViewProps) {
  const {
    dropBlock,
    selectLaneTile,
    setCanvasChoice,
    setLaneSlot,
    setRoutingSplit,
    shift,
    shiftPath,
  } = rig;
  const {
    canvasRoute,
    describeNode,
    editable,
    fullRoute,
    laneTarget,
    nativeTiles,
    nodes,
    routeSplits,
    running,
    sceneCanvas,
    selected,
    selectedLaneTile,
  } = vm;
  const epaper = useEpaper();
  const locked = rigLocked(rig);
  if (!canvasRoute) return <RigChainSurfaceChooser rig={rig} vm={vm} />;
  const editing = editable && !!fullRoute;
  /** Blocks go anywhere but ahead of a scene's tone. */
  const gaps = (at: RouteAt) =>
    !sceneCanvas || at.split !== sceneCanvas.split || at.index > 0;
  const movable = (id: string) =>
    nodes.find((n) => n.id === id)?.kind === 'lv2';
  /** Alt+arrow keys: the keyboard path for every drag. Left and right step
   * through splits (next to a scene's tone, out ahead of the scenes); up and
   * down change path. */
  const onKey = (id: string, key: MoveKey) => {
    const spot = routeSpot(fullRoute, id);
    if (!spot) return;
    const owner = spot.owners.at(-1);
    if (key === 'left' || key === 'right') {
      const step = key === 'left' ? -1 : 1;
      const top = !owner;
      if (step < 0 && top && spot.index === 0) return;
      if (step > 0 && top && spot.index === spot.length - 1) return;
      void shift(id, step);
      return;
    }
    const step = key === 'up' ? -1 : 1;
    if (!owner || owner.path + step < 0 || owner.path + step >= owner.paths)
      return;
    void shiftPath(id, step);
  };
  const open = editing && running && !locked;
  return (
    <>
      <div className="space-y-2">
        <RouteTree
          route={canvasRoute}
          // E-paper edits a chain as a list with buttons; a drawing that
          // cannot be rearranged has nothing to press but its blocks.
          list={epaper && editing}
          plain={!fullRoute}
          scenes={sceneCanvas}
          tiles={(id) => {
            const n = nodes.find((node) => node.id === id);
            if (!n) return [];
            // A TONE3000 block draws its own blocks once they are known.
            const inner = n.kind === 'tone3000' ? nativeTiles(n) : [];
            return inner.length
              ? inner
              : [{ ...describeNode(n).block, id: laneBlockId(n.id, '') }];
          }}
          selected={
            selectedLaneTile ??
            (selected ? laneBlockId(selected.id, '') : undefined)
          }
          onSelect={selectLaneTile}
          onSlot={(tile) => {
            const at = laneTarget(tile);
            if (at?.block) setLaneSlot({ node: at.node, target: at.block });
          }}
          gaps={editing ? gaps : undefined}
          onGap={
            open ? (at) => setCanvasChoice({ kind: 'gap', at }) : undefined
          }
          onAdd={
            open ? (at) => setCanvasChoice({ kind: 'add', at }) : undefined
          }
          movable={editing && running ? movable : undefined}
          onMove={editing && running ? dropBlock : undefined}
          onKey={editing && running ? onKey : undefined}
          disabled={locked}
        />
        <p className="caption">
          {!editing
            ? 'Select a block to edit it. This preset’s routing is shown here but cannot be rearranged.'
            : !selected
              ? 'Select a block to edit it. Tap + between blocks to add an effect or split the chain there.'
              : epaper
                ? 'Select a block, then use Move and Path to move it.'
                : 'Tap + to add an effect or split there. Drag a block to move it, within or across paths, or press Alt and an arrow key.'}
        </p>
      </div>
      {running && routeSplits.length > 0 && (
        <div className="action-row" role="group" aria-label="Splits">
          {routeSplits.map((split, index) => (
            <Button
              key={split.split}
              variant="ghost"
              aria-label={`Split ${index + 1} · ${split.branches.length} paths: path levels`}
              onClick={() => setRoutingSplit(split.split)}
            >
              ◆ {routeSplits.length > 1 ? `Split ${index + 1}: ` : ''}
              {split.branches
                .map((_, path) => {
                  const mix = pathMix(
                    split.gains[path] ?? 1,
                    split.rightGains?.[path],
                  );
                  const pan =
                    mix.pan === 0
                      ? 'C'
                      : `${mix.pan < 0 ? 'L' : 'R'} ${Math.round(Math.abs(mix.pan) * 100)}`;
                  return `Path ${path + 1} ${Math.round(mix.level * 100)}% ${pan}`;
                })
                .join(' · ')}{' '}
              ›
            </Button>
          ))}
        </div>
      )}
      <RigChainSurfaceChooser rig={rig} vm={vm} />
    </>
  );
}
