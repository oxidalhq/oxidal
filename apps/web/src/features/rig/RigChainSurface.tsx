import { Button } from '../../components/ui/button';
import { RigTile } from '../../ChainView';
import { RigTopology } from '../../RigTopology';
import { RouteTree, type MoveKey } from '../../components/RouteTree';
import { useEpaper } from '../../components/RouteTree.display';
import { pathMix, type RouteAt } from '../../rigRoute';
import { routeSpot } from '../../rigChain';
import type { RigViewProps } from './useMixedRigSession';
import { laneBlockId } from './mixedRigViewModel';
import { RigChainSurfaceChooser } from './RigChainSurfaceChooser';

/**
 * The chain: one renderer for a straight chain, a routing tree and scene lanes
 * (RouteTree), the routing view for other shapes (RigTopology), and the split
 * row with each split's path levels. Every drag has a key and a button path.
 * @see docs/interface.md
 */
export function RigChainSurface({ rig, vm }: RigViewProps) {
  const {
    dropBlock,
    edit,
    editing,
    matching,
    picker,
    revision,
    selectLaneTile,
    setCanvasChoice,
    setLaneSlot,
    setRoutingSplit,
    setSelection,
    shift,
    shiftPath,
  } = rig;
  const {
    describeNode,
    editable,
    fullRoute,
    laneTarget,
    lanedNodes,
    nativeTiles,
    nodes,
    routeSplits,
    running,
    sceneCanvas,
    selected,
    selectedLaneTile,
  } = vm;
  const epaper = useEpaper();
  const locked = !!edit || !!picker || editing;
  /** Blocks go after a scene's tone and after the scenes, never before. */
  const gaps = (at: RouteAt) =>
    !sceneCanvas ||
    (at.split === null
      ? at.index > 0
      : at.split !== sceneCanvas.split || at.index > 0);
  const movable = (id: string) =>
    nodes.find((n) => n.id === id)?.kind === 'lv2';
  /** Alt+arrow keys: the keyboard path for every drag. */
  const onKey = (id: string, key: MoveKey) => {
    const spot = routeSpot(fullRoute, id);
    if (!spot) return;
    const owner = spot.owners.at(-1);
    const inScene = !!sceneCanvas && owner?.split === sceneCanvas.split;
    if (key === 'left' || key === 'right') {
      const step = key === 'left' ? -1 : 1;
      const top = !owner;
      if (
        step < 0 &&
        ((top && spot.index === 0) || (inScene && spot.index <= 1))
      )
        return;
      if (step > 0 && top && spot.index === spot.length - 1) return;
      void shift(id, step);
      return;
    }
    const step = key === 'up' ? -1 : 1;
    if (!owner || owner.path + step < 0 || owner.path + step >= owner.paths)
      return;
    void shiftPath(id, step);
  };
  const select = (id: string) => {
    if (!revision) return;
    const chosen = { revision, node: id };
    setSelection(chosen);
    try {
      sessionStorage.setItem('oxidal.mixed.selection', JSON.stringify(chosen));
    } catch {
      /* browsing preferences are optional */
    }
  };
  return (
    <>
      {editable && fullRoute && (
        <div className="space-y-2">
          <RouteTree
            route={fullRoute}
            list={epaper}
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
            selected={selectedLaneTile}
            onSelect={selectLaneTile}
            onSlot={(tile) => {
              const at = laneTarget(tile);
              if (at?.block) setLaneSlot({ node: at.node, target: at.block });
            }}
            gaps={gaps}
            onGap={
              running && !locked
                ? (at) => setCanvasChoice({ kind: 'gap', at })
                : undefined
            }
            onAdd={
              running && !locked
                ? (at) => setCanvasChoice({ kind: 'add', at })
                : undefined
            }
            movable={running ? movable : undefined}
            onMove={running ? dropBlock : undefined}
            onKey={running ? onKey : undefined}
            disabled={locked}
          />
          <p className="caption">
            {!selected
              ? 'Select a block to edit it. Tap + between blocks to add an effect or split the chain there.'
              : epaper
                ? 'Select a block, then use Move and Path to move it.'
                : 'Tap + to add an effect or split there. Drag a block to move it, within or across paths, or press Alt and an arrow key.'}
          </p>
        </div>
      )}
      <RigTopology
        graph={matching?.manifest.oxidal?.graph ?? { nodes: [], edges: [] }}
        visible={nodes.filter((n) => !lanedNodes.has(n.id)).map((n) => n.id)}
        selected={selected?.id}
      >
        {(id) => {
          const n = nodes.find((node) => node.id === id)!;
          const view = describeNode(n);
          return (
            <div key={n.id} data-node={n.id} className="mixed-node">
              <RigTile
                block={view.block}
                selected={n.id === selected?.id}
                disabled={!!edit || !!picker}
                onSelect={() => select(n.id)}
              />
            </div>
          );
        }}
      </RigTopology>
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
