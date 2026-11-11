import { Button } from '../../components/ui/button';
import { ChainView, RigTile } from '../../ChainView';
import { RigTopology } from '../../RigTopology';
import { RouteTree } from '../../components/RouteTree';
import type { RigViewProps } from './useMixedRigSession';
import { PATH, laneBlockId } from './mixedRigViewModel';

/**
 * The chain: scene lanes or effect lanes (ChainView), the phone route tree
 * (RouteTree), the routing view for other shapes (RigTopology) and the split row.
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
    setLaneSlot,
    setRoutingSplit,
    setSelection,
  } = rig;
  const {
    describeNode,
    editable,
    effectLanes,
    laneTarget,
    lanedNodes,
    nativeTiles,
    nodes,
    routeSplits,
    routeTree,
    running,
    sceneLanes,
    selected,
    selectedLaneTile,
  } = vm;
  return (
    <>
      {(sceneLanes.length > 0 || effectLanes.length > 0) &&
        (routeTree ? (
          <RouteTree
            route={routeTree}
            tiles={(id) => {
              const n = nodes.find((node) => node.id === id);
              if (!n) return null;
              const blocks =
                n.kind === 'tone3000'
                  ? nativeTiles(n)
                  : [{ ...describeNode(n).block, id: laneBlockId(n.id, '') }];
              return blocks.map((b) => (
                <RigTile
                  key={b.id}
                  block={b}
                  selected={b.id === selectedLaneTile}
                  disabled={!!edit || !!picker}
                  onSelect={() => selectLaneTile(b.id)}
                />
              ));
            }}
            onSplit={
              running ? (split) => setRoutingSplit(split.split) : undefined
            }
            onAddToPath={
              editable && !editing
                ? (split, index) =>
                    setLaneSlot({
                      node: PATH,
                      target: `${split.split}:${index}`,
                    })
                : undefined
            }
          />
        ) : (
          <ChainView
            label={sceneLanes.length ? 'Scene branches' : 'Chain'}
            parallel={sceneLanes.length > 0 || effectLanes.length > 1}
            onAdd={(laneBlock) => {
              const at = laneTarget(laneBlock);
              if (at?.block) setLaneSlot({ node: at.node, target: at.block });
            }}
            lanes={sceneLanes.length ? sceneLanes : effectLanes}
            movable={
              editable && !editing
                ? (tile) =>
                    nodes.find((n) => n.id === laneTarget(tile)?.node)?.kind ===
                    'lv2'
                : undefined
            }
            onMove={editable ? dropBlock : undefined}
            selected={selectedLaneTile}
            disabled={!!edit || !!picker}
            onSelect={selectLaneTile}
          />
        ))}
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
                onSelect={() => {
                  if (!revision) return;
                  const selected = { revision, node: n.id };
                  setSelection(selected);
                  try {
                    sessionStorage.setItem(
                      'oxidal.mixed.selection',
                      JSON.stringify(selected),
                    );
                  } catch {
                    /* browsing preferences are optional */
                  }
                }}
              />
            </div>
          );
        }}
      </RigTopology>
      {!routeTree && running && routeSplits.length > 0 && (
        <div className="action-row" role="group" aria-label="Splits">
          {routeSplits.map((split, index) => (
            <Button
              key={split.split}
              variant="ghost"
              aria-label={`Split ${index + 1} · ${split.branches.length} paths: path levels`}
              onClick={() => setRoutingSplit(split.split)}
            >
              ◆ Split {routeSplits.length > 1 ? `${index + 1} ` : ''}·{' '}
              {split.branches.length} paths ›
            </Button>
          ))}
        </div>
      )}
    </>
  );
}
