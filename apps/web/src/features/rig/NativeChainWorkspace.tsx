/**
 * The C2 Rig workspace for a TONE3000-only preset (the native engine) or an
 * effects-only preset (the LV2 graph engine): the same chain map or tree,
 * chain bar, edge lanes and panel as a mixed preset, fed from the engine's
 * lanes instead of a rig route. Whatever plays it, a preset is a chain of
 * pedals and looks the same. The bar holds Map or Tree, the map's tools,
 * + Add, Undo and Redo where the engine has them, Save, how the chain is
 * being run, and Hide.
 * @see docs/interface.md
 */
import { ArrowArcLeft, ArrowArcRight } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { useChainCanvasControl } from '@oxidal/design-system/lib/chain-canvas-control';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';
import { useRemembered } from '@oxidal/design-system/lib/use-remembered';
import {
  ChainWorkspace,
  type ChainWorkspaceLayout,
} from '@oxidal/design-system/patterns/chain-workspace';
import { StreamStatus } from '@oxidal/design-system/widgets/stream-status';

import type { AudioState } from '../../api';
import { useEpaper } from '../../components/RouteTree.display';
import type { IdStep, RigLaneVM } from '../../rigChain';
import type { RouteAt } from '../../rigRoute';
import { requestScreen } from '../../screenNavigation';
import { useDockParts } from '../dock/dockParts';
import { useChainView } from './chainView';
import { ChainDrawing } from './RigChainSurface';
import { DeviceEdgeLanes } from './RigEdgeLanes';

const CHAIN_MIN_HEIGHT = 260;
/** Wider than this, the edge lanes show their figures beside the meters. */
const FIGURES_FROM = 1200;

function useWidth() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/**
 * The native lanes as a route: one lane in a row, two as a stereo split. A
 * run of free positions shows as one +, as the tree shows it.
 */
function nativeRoute(lanes: RigLaneVM[]): IdStep[] {
  const ids = (lane: RigLaneVM) =>
    lane.blocks
      .filter((block, i) => !(block.empty && lane.blocks[i - 1]?.empty))
      .map((block) => block.id);
  if (lanes.length < 2) return lanes[0] ? ids(lanes[0]) : [];
  return [
    {
      split: 'native~stereo',
      merge: 'native~stereo',
      gains: lanes.map(() => 1),
      branches: lanes.map(ids),
    },
  ];
}

export function NativeChainWorkspace({
  lanes,
  selected,
  onSelect,
  onSlot,
  onMove,
  onGap,
  gaps,
  disabled,
  onAdd,
  addWaits,
  undo,
  onSave,
  canSave,
  saveTitle,
  saveLabel = 'Save copy',
  stream,
  midi,
  midiPort,
  boost,
  children,
}: {
  lanes: RigLaneVM[];
  selected?: string;
  onSelect: (id: string) => void;
  /** An empty slot was tapped. */
  onSlot?: (id: string) => void;
  /**
   * A block dragged onto a line: its lane (`path` 0 is left, 1 right) and
   * the place in the drawn lane it goes before. Leave out when the engine
   * cannot move blocks.
   */
  onMove?: (id: string, at: RouteAt) => void;
  /**
   * + on a line: add a block there. Offered only where `onGap` is given and
   * the lane still has a free position.
   */
  onGap?: (at: RouteAt) => void;
  /** Whether a block can be added at this place. */
  gaps?: (at: RouteAt) => boolean;
  disabled: boolean;
  onAdd?: () => void;
  addWaits?: string;
  /** Leave out when the engine keeps no edit history. */
  undo?: {
    canUndo: boolean;
    canRedo: boolean;
    onUndo: () => void;
    onRedo: () => void;
  };
  /** Leave out when there is nothing to save, such as a draft not yet playing. */
  onSave?: () => void;
  canSave?: boolean;
  saveTitle?: string;
  /** The Save button's words. */
  saveLabel?: string;
  stream?: NonNullable<AudioState['configured']>['stream']['input'];
  midi?: AudioState['midi'];
  midiPort?: string;
  boost?: ReactNode;
  children: (layout: ChainWorkspaceLayout) => ReactNode;
}) {
  const canvas = useChainCanvasControl();
  const [view, setView] = useChainView();
  const epaper = useEpaper();
  const [height, setHeight] = useRemembered<number>(
    'oxidal.rig.chain-height',
    0,
  );
  const [collapsed, setCollapsed] = useRemembered(
    'oxidal.rig.panel-hidden',
    false,
  );
  const dock = useDockParts();
  // A phone has no edge lanes: its guitar and level stay in the panel.
  const phone = useVerticalRig();
  const [measure, width] = useWidth();
  const insetSide = phone ? 0 : width >= FIGURES_FROM ? 148 : 56;
  // Selecting a block brings the hidden panel back with its settings.
  useEffect(() => {
    if (selected) setCollapsed(false);
  }, [selected, setCollapsed]);

  const blocks = new Map(
    lanes.flatMap((lane) => lane.blocks.map((block) => [block.id, block])),
  );
  const current = selected ? blocks.get(selected) : undefined;
  const route = nativeRoute(lanes);
  const props = {
    route,
    tiles: (id: string) => {
      const block = blocks.get(id);
      return block ? [block] : [];
    },
    selected,
    onSelect,
    onSlot,
    onMove,
    onGap,
    gaps,
    // Blocks move; free positions stay where they are.
    movable: onMove
      ? (id: string) => !!blocks.get(id) && !blocks.get(id)!.empty
      : undefined,
    disabled,
    label: 'Sounding tone blocks',
    list: epaper,
  };
  return (
    <ChainWorkspace
      // May shrink below its content, as the mixed Rig's can, so a wide row
      // in the panel wraps instead of pushing the page past the screen.
      className="-mx-page min-w-0"
      canvas={canvas}
      chainMin={CHAIN_MIN_HEIGHT}
      chainHeight={height}
      onChainHeight={setHeight}
      collapsed={collapsed}
      onCollapsedChange={setCollapsed}
      chain={
        <div ref={measure} className="relative h-full">
          {epaper ? (
            // E-paper's list scrolls in the chain's room, clear of the edge
            // lanes, as on a mixed preset.
            <div
              className="h-full overflow-y-auto overscroll-contain px-page pt-2 pb-3"
              style={
                insetSide
                  ? { paddingLeft: insetSide, paddingRight: insetSide }
                  : undefined
              }
            >
              <ChainDrawing {...props} map={false} insetSide={insetSide} />
            </div>
          ) : (
            <ChainDrawing
              {...props}
              map={view === 'map'}
              control={canvas}
              insetSide={insetSide}
            />
          )}
          {!phone && (
            <DeviceEdgeLanes
              figuresFrom={FIGURES_FROM}
              midi={midi}
              midiPort={midiPort}
              boost={boost}
            />
          )}
        </div>
      }
      aboveBar={dock?.bottom || undefined}
      chainView={epaper ? undefined : view}
      onChainView={epaper ? undefined : setView}
      selected={
        current && !current.empty
          ? { name: current.label, on: current.on }
          : null
      }
      onAdd={onAdd}
      addWaits={addWaits}
      edits={
        onSave
          ? {
              count: 0,
              list: null,
              compare: 'edited',
              onCompare: () => {},
              onSave,
              canSave: !!canSave,
              saveTitle,
              saveLabel,
            }
          : undefined
      }
      barCentre={
        stream ? (
          <StreamStatus
            stream={stream}
            onAudioSettings={() =>
              requestScreen({ screen: 'settings', section: 'audio' })
            }
          />
        ) : undefined
      }
      barTrail={
        undo && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Undo change"
              title="Undo the last chain edit"
              disabled={disabled || !undo.canUndo}
              onClick={undo.onUndo}
            >
              <ArrowArcLeft aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Redo change"
              title="Redo the last undone chain edit"
              disabled={disabled || !undo.canRedo}
              onClick={undo.onRedo}
            >
              <ArrowArcRight aria-hidden="true" />
            </Button>
          </>
        )
      }
      panelLabel="Sound controls and the selected block"
      panelClassName="px-page pb-3"
    >
      {children}
    </ChainWorkspace>
  );
}
