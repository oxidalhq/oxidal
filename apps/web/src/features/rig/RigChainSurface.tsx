import { Button } from '@oxidal/design-system/components/button';
import { ActionRow } from '@oxidal/design-system/components/form-layout';
import { Caption } from '@oxidal/design-system/components/text';
import type { ChainCanvasControl } from '@oxidal/design-system/lib/chain-canvas-control';
import { sceneColour } from '@oxidal/design-system/lib/scene-colours';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';
import { PanZoom } from '@oxidal/design-system/widgets/pan-zoom';

import { RouteMap } from '../../components/RouteMap';
import {
  type MoveKey,
  RouteTree,
  type RouteTreeProps,
} from '../../components/RouteTree';
import { useEpaper } from '../../components/RouteTree.display';
import { type IdStep, routeSpot } from '../../rigChain';
import { pathMix, type RouteAt } from '../../rigRoute';
import { useChainView } from './chainView';
import { laneBlockId, rigLocked } from './mixedRigViewModel';
import { RigChainSurfaceChooser } from './RigChainSurfaceChooser';
import { effectControls, shortValue, useLv2Catalog } from './useLv2Controls';
import type { RigViewProps } from './useMixedRigSession';

const KIND_LABEL = {
  amp: 'Amp',
  cab: 'Cabinet',
  pedal: 'Pedal',
  time: 'Delay · Reverb',
  mod: 'Modulation',
  lv2: 'Effect',
  other: 'Effect',
} as const;

/**
 * The chain: one renderer (RouteTree) for every preset shape — a straight
 * chain, a routing tree with nested splits, and scene lanes with effects ahead
 * of, inside and after them — and the split row with each split's path
 * levels. A shape the route editor cannot read is drawn folded into paths and
 * cannot be rearranged. Every drag has a key and a button path. In the Rig's
 * work area the chain bar holds Map or Tree and the map's tools (`view`,
 * `control`); without them the map keeps its own floating tools.
 * @see docs/interface.md
 */
/** Drawing-only names for a stereo TONE3000 chain's split and lanes. */
const STEREO = '~stereo';
const LEFT = '~L';
const RIGHT = '~R';

export function RigChainSurface({
  rig,
  vm,
  view: viewIn,
  onView,
  control,
  insetSide,
}: RigViewProps & {
  view?: 'map' | 'tree';
  onView?: (view: 'map' | 'tree') => void;
  /** The chain bar's control for the map. */
  control?: ChainCanvasControl;
  /** Room the map keeps clear at each side, for the edge lanes. */
  insetSide?: number;
}) {
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
  const plugins = useLv2Catalog({ rig, vm });
  // The chain graph (map) is how the chain is drawn; the tree is second.
  const [ownView, setOwnView] = useChainView();
  const vertical = useVerticalRig();
  const view = viewIn ?? ownView;
  const setView = onView ?? setOwnView;
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
  const sceneIndex =
    vm.state.control?.scenes?.scenes.findIndex(
      (s) => s.id === vm.state.control?.scene,
    ) ?? -1;
  const map = view === 'map' && !epaper;
  // A stereo TONE3000 chain draws as its two lanes, Left and Right, as the
  // TONE3000-only Rig draws it; the split is for drawing only.
  const stereo = new Set(
    nodes
      .filter(
        (n) =>
          n.kind === 'tone3000' &&
          nativeTiles(n).some((t) => t.stereoLane === 'right'),
      )
      .map((n) => n.id),
  );
  const expand = (steps: IdStep[]): IdStep[] =>
    steps.map((step) =>
      typeof step === 'string'
        ? stereo.has(step)
          ? {
              split: `${step}${STEREO}`,
              merge: `${step}${STEREO}`,
              gains: [1, 1],
              branches: [[`${step}${LEFT}`], [`${step}${RIGHT}`]],
            }
          : step
        : { ...step, branches: step.branches.map(expand) },
    );
  const drawnRoute = stereo.size ? expand(canvasRoute) : canvasRoute;
  const inStereo = (at: RouteAt) => !!at.split?.endsWith(STEREO);
  // In the work area the tree pans and zooms like the map (not on a phone,
  // where it runs down the page, nor on E-paper, which edits a list).
  const drawn = map || (!!control && !epaper && !vertical);
  const audible = new Set(
    vm.stageLanes.flatMap((lane) =>
      lane.blocks.filter((b) => b.on).map((b) => b.id),
    ),
  );
  return (
    <>
      <div
        className={
          control
            ? // In the work area a tall tree or list scrolls inside the chain's room.
              `relative flex h-full min-h-0 min-w-0 flex-col gap-1 ${drawn ? '' : 'overflow-y-auto overscroll-contain px-page pt-2 pb-3'}`
            : 'relative flex min-h-0 min-w-0 flex-1 flex-col gap-1'
        }
        // The tree keeps clear of the edge lanes, as the map does.
        style={
          control && !drawn && insetSide
            ? { paddingLeft: insetSide, paddingRight: insetSide }
            : undefined
        }
      >
        <ChainDrawing
          map={map}
          control={control}
          insetSide={insetSide}
          toolbarExtra={
            epaper || control ? undefined : (
              <div
                role="group"
                aria-label="Chain view"
                className="flex gap-0.5"
              >
                {(['map', 'tree'] as const).map((v) => (
                  <Button
                    key={v}
                    size="sm"
                    variant={view === v ? 'secondary' : 'ghost'}
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                  >
                    {v === 'tree' ? 'Tree' : 'Map'}
                  </Button>
                ))}
              </div>
            )
          }
          route={drawnRoute}
          // E-paper edits a chain as a list with buttons; a drawing that
          // cannot be rearranged has nothing to press but its blocks.
          list={epaper && editing}
          plain={!fullRoute}
          scenes={sceneCanvas}
          tiles={(drawnId) => {
            // One lane of a stereo TONE3000 chain: that lane's blocks only.
            const lane = drawnId.endsWith(LEFT)
              ? 'left'
              : drawnId.endsWith(RIGHT)
                ? 'right'
                : null;
            const id = lane ? drawnId.slice(0, -LEFT.length) : drawnId;
            const n = nodes.find((node) => node.id === id);
            if (!n) return [];
            // A TONE3000 block draws its own blocks once they are known.
            const inner = n.kind === 'tone3000' ? nativeTiles(n) : [];
            const tiles = (
              inner.length
                ? inner
                : [{ ...describeNode(n).block, id: laneBlockId(n.id, '') }]
            ).filter(
              (t) => !lane || ('stereoLane' in t && t.stereoLane === lane),
            );
            // The map shows each block as a card: its type and main values.
            const card = view === 'map' && !epaper;
            const host = rig.matching?.manifest.oxidal;
            const uri =
              card && n.kind === 'lv2'
                ? host?.lv2.find((p) => p.id === n.instance)?.pluginUri
                : undefined;
            const fx = uri
              ? effectControls(
                  plugins,
                  uri,
                  n.id,
                  vm.state.control?.controls ?? [],
                )
              : undefined;
            const values = fx?.main.slice(0, 2).map(shortValue).join(' · ');
            return tiles.map((b) => ({
              ...b,
              ...(card
                ? {
                    caption: b.caption ?? fx?.category ?? KIND_LABEL[b.kind],
                    preview: values || undefined,
                  }
                : {}),
              tint:
                sceneIndex >= 0 && b.on && audible.has(b.id)
                  ? sceneColour(sceneIndex)
                  : undefined,
            }));
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
          gaps={editing ? (at) => !inStereo(at) && gaps(at) : undefined}
          onGap={
            open ? (at) => setCanvasChoice({ kind: 'gap', at }) : undefined
          }
          onAdd={
            open ? (at) => setCanvasChoice({ kind: 'add', at }) : undefined
          }
          movable={
            editing && running
              ? (id) => !id.endsWith(LEFT) && !id.endsWith(RIGHT) && movable(id)
              : undefined
          }
          onMove={
            editing && running
              ? (id, at) => {
                  if (!inStereo(at)) dropBlock(id, at);
                }
              : undefined
          }
          onAddBefore={
            running && !locked ? (tile) => void rig.addBefore(tile) : undefined
          }
          onKey={editing && running ? onKey : undefined}
          disabled={locked}
        />
        {(!drawn || !running) && (
          <Caption>
            {!running
              ? 'Resume audio to hear this chain and edit its blocks.'
              : !editing
                ? 'Select a block to edit it. This preset’s routing is shown here but cannot be rearranged.'
                : !selected
                  ? 'Select a block to edit it. Tap + between blocks to add an effect or split the chain there.'
                  : epaper
                    ? 'Select a block, then use Move and Path to move it.'
                    : 'Tap + to add an effect or split there. Drag a block to move it, within or across paths, or press Alt and an arrow key.'}
          </Caption>
        )}
      </div>
      {running && routeSplits.length > 0 && (
        <ActionRow role="group" aria-label="Splits">
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
        </ActionRow>
      )}
      <RigChainSurfaceChooser rig={rig} vm={vm} />
    </>
  );
}

/**
 * The map, or the tree (also E-paper's list), from the same props. With the
 * chain bar's control the tree pans, zooms and centres as the map does; a
 * phone's tree stays in the page's own scrolling.
 */
export function ChainDrawing({
  map,
  control,
  insetSide,
  ...props
}: RouteTreeProps & {
  map: boolean;
  control?: ChainCanvasControl;
  insetSide?: number;
}) {
  const vertical = useVerticalRig();
  if (map)
    return <RouteMap {...props} control={control} insetSide={insetSide} />;
  if (!control || props.list) return <RouteTree {...props} />;
  return (
    <PanZoom
      control={control}
      selected={props.selected}
      insetSide={insetSide}
      still={vertical}
      className={vertical ? 'px-page pt-2 pb-3' : undefined}
    >
      <div className="p-4">
        <RouteTree {...props} />
      </div>
    </PanZoom>
  );
}
