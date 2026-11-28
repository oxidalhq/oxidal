import { Plus } from '@phosphor-icons/react';
import { useState } from 'react';

import type { ChainCanvasControl } from '@oxidal/design-system/lib/chain-canvas-control';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';
import { ChainCanvas } from '@oxidal/design-system/widgets/chain-canvas';
import { SilentBranchesToggle } from '@oxidal/design-system/widgets/silent-branches-toggle';

import { edgeKey, routeGraph } from '../features/rig/routeGraph';
import type { RouteTreeProps } from './RouteTree';

/**
 * The chain drawn as a map you can pan and zoom, from the same route, tiles
 * and callbacks as the tree view. Where the tree puts a + in a gap, the map
 * puts one on the connection; a block dropped on a connection goes to the
 * same place in the route. E-paper keeps the numbered list. Given the chain
 * bar's `control`, the map leaves its own tools to the bar and fills the
 * chain area.
 * @see docs/interface.md
 */
export function RouteMap(
  props: RouteTreeProps & {
    /** The chain bar's control: the bar holds the map tools. */
    control?: ChainCanvasControl;
    /** Room kept clear at each side, for the edge lanes over the map. */
    insetSide?: number;
    /** Audio is running: the lines show the sound flowing. */
    flowing?: boolean;
  },
) {
  const vertical = useVerticalRig();
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const open = expanded ?? !vertical;
  const model = routeGraph(props.route, props.tiles, {
    selected: props.selected,
    expanded: open,
    scenes: props.scenes,
    plain: props.plain,
    slots: !!props.onSlot,
  });
  const {
    graph,
    at,
    emptyPaths,
    inner,
    block,
    tile,
    lanes,
    silent,
    splits,
    foldable,
  } = model;
  const canAdd =
    !props.disabled && !!(props.onGap || props.onAdd || props.onAddBefore);
  const canMove = !props.disabled && !!props.onMove;
  return (
    <div
      role="group"
      aria-label={props.label ?? 'Signal chain'}
      className={
        props.control
          ? 'flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2'
          : 'flex min-h-0 min-w-0 flex-1 flex-col gap-2'
      }
    >
      {foldable.length > 0 && (
        <SilentBranchesToggle
          names={foldable.map((f) => f.name)}
          expanded={open}
          onToggle={() => setExpanded(!open)}
        />
      )}
      <div
        className={
          props.control
            ? 'min-h-0 min-w-0 flex-1'
            : 'min-h-60 min-w-0 flex-1 max-lg:h-[clamp(15rem,42vh,26rem)] max-lg:flex-none'
        }
      >
        <ChainCanvas
          flowing={props.flowing}
          graph={graph}
          selected={props.selected ?? null}
          onSelect={(id) => {
            if (!id) return;
            const t = tile.get(id);
            if (t?.empty) props.onSlot?.(id);
            else props.onSelect(id);
          }}
          disabled={props.disabled}
          onPlus={
            canAdd
              ? (edge) => {
                  const before = inner.get(edgeKey(edge));
                  if (before) return props.onAddBefore?.(before);
                  const where = at.get(edgeKey(edge));
                  if (!where) return;
                  if (emptyPaths.has(edgeKey(edge))) props.onAdd?.(where);
                  else props.onGap?.(where);
                }
              : undefined
          }
          card={(id) => {
            const t = tile.get(id);
            if (!t || t.empty) return undefined;
            return {
              caption: t.caption,
              preview: t.preview,
              kind: t.kind,
              on: t.on,
            };
          }}
          plusAlways={(edge) => emptyPaths.has(edgeKey(edge))}
          plusAllowed={(edge) => {
            if (inner.has(edgeKey(edge))) return !!props.onAddBefore;
            const where = at.get(edgeKey(edge));
            if (!where) return false;
            return emptyPaths.has(edgeKey(edge))
              ? !!props.onAdd
              : !!props.onGap && (props.gaps?.(where) ?? true);
          }}
          plusLabel={(edge) => {
            const before = inner.get(edgeKey(edge));
            if (before)
              return `Add a block before ${tile.get(before)?.label ?? 'this block'}`;
            const where = at.get(edgeKey(edge));
            const path = (where?.path ?? 0) + 1;
            const of =
              where?.split && splits.length > 1
                ? ` of split ${splits.indexOf(where.split) + 1}`
                : '';
            if (emptyPaths.has(edgeKey(edge)))
              return `Add effect to path ${path}${of}`;
            return where?.split
              ? `Add or split on path ${path}${of} at position ${where.index + 1}`
              : `Add or split at position ${(where?.index ?? 0) + 1}`;
          }}
          onMove={
            canMove
              ? (id, edge) => {
                  const blockId = block.get(id);
                  const where = at.get(edgeKey(edge));
                  if (blockId && where && (props.gaps?.(where) ?? true))
                    props.onMove!(blockId, where);
                }
              : undefined
          }
          movable={(id) => props.movable?.(block.get(id) ?? '') ?? false}
          onKeyMove={
            props.onKey
              ? (id, key) => {
                  const blockId = block.get(id);
                  if (blockId) props.onKey!(blockId, key);
                }
              : undefined
          }
          tint={(id) => tile.get(id)?.tint}
          off={(id) => {
            const t = tile.get(id);
            return (t?.on === false && !t.empty) || silent.has(id);
          }}
          face={(id) =>
            tile.get(id)?.empty ? (
              <Plus
                className="size-6 text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              tile.get(id)?.face
            )
          }
          laneLabel={(lane) => lanes[lane] ?? `Path ${lane + 1}`}
          toolbarExtra={props.toolbarExtra}
          toolbar={props.control ? 'none' : 'float'}
          control={props.control}
          insetSide={props.insetSide}
          readOnlyNote="Select a block to edit it. Drag to pan, pinch or ⌘-scroll to zoom."
        />
      </div>
    </div>
  );
}
