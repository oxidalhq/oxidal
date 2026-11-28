import { type ReactNode, useEffect, useRef, useState } from 'react';

import type { ChainCanvasControl } from '../lib/chain-canvas-control';
import { cn } from '../lib/cn';
import {
  CHAIN_BAR_COMPACT_BELOW,
  CHAIN_BAR_FULL_FROM,
  ChainBar,
  type ChainBarEdits,
} from '../widgets/chain-bar';

/**
 * The Rig's work area: the chain on top, the chain bar as the divider, and
 * the panel under it (scenes, the selected block, the level). The grip on the
 * bar shares the height between the chain and the panel; Hide gives the
 * chain the whole area. Pass the chain (usually a `ChainCanvas` with
 * `toolbar="none"` and the same `canvas` control) and the panel as children.
 * @see docs/interface.md
 */

/** The bar's height with its margin, and the least the panel keeps. */
const BAR = 56;
const PANEL_MIN = 140;
const CHAIN_MIN = 120;
/** The bar's side margins together. */
const BAR_MARGIN = 16;

/** What the panel needs to know about the bar above it. */
export type ChainWorkspaceLayout = {
  /** A phone-width area. */
  phone: boolean;
  /** The bar has room for the compare and the scope; otherwise the panel shows them. */
  barHasCompare: boolean;
};

export function ChainWorkspace({
  canvas,
  chain,
  chainView,
  onChainView,
  selected,
  onAdd,
  addWaits,
  edits,
  barLead,
  barTrail,
  barCentre,
  aboveBar,
  defaultCollapsed = false,
  collapsed: collapsedIn,
  onCollapsedChange,
  chainHeight,
  onChainHeight,
  chainMin = CHAIN_MIN,
  panelLabel = 'Scenes and the selected block',
  panelClassName,
  children,
  className,
}: {
  canvas: ChainCanvasControl;
  /** The chain drawing: a map, a tree or a list. */
  chain: ReactNode;
  chainView?: 'map' | 'tree';
  onChainView?: (view: 'map' | 'tree') => void;
  selected?: { name: string; on: boolean } | null;
  onAdd?: () => void;
  /** Why Add waits; see `ChainBar`. */
  addWaits?: string;
  edits?: ChainBarEdits;
  /** At the chain bar's start, such as the preset picker. */
  barLead?: ReactNode;
  /** Before Save on the chain bar, such as Tuner and Perform. */
  barTrail?: ReactNode;
  /** In the chain bar's empty middle, such as the stream and engine status. */
  barCentre?: ReactNode;
  /** Between the chain and its bar, such as tools docked at the bottom; the chain gives up the room. */
  aboveBar?: ReactNode;
  defaultCollapsed?: boolean;
  /** Hold the panel's Hide in the screen, such as to remember it; leave out to keep it here. */
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
  /**
   * The chain height the player chose, such as one this browser remembers;
   * null or 0 starts at the default. Leave out to keep it here.
   */
  chainHeight?: number | null;
  onChainHeight?: (height: number) => void;
  /** The least height the chain keeps. */
  chainMin?: number;
  /** The name screen readers give the panel. */
  panelLabel?: string;
  panelClassName?: string;
  /** The panel under the bar. */
  children: ReactNode | ((layout: ChainWorkspaceLayout) => ReactNode);
  className?: string;
}) {
  const [ownCollapsed, setOwnCollapsed] = useState(defaultCollapsed);
  const collapsed = collapsedIn ?? ownCollapsed;
  const setCollapsed = (next: boolean) => {
    setOwnCollapsed(next);
    onCollapsedChange?.(next);
  };
  // The space the chain and the panel share decides the grip's range.
  const root = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry)
        setSpace({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Tools docked above the bar add their own height; the chain keeps its own.
  const below = useRef<HTMLDivElement>(null);
  const [extra, setExtra] = useState(0);
  const docked = Boolean(aboveBar);
  useEffect(() => {
    const el = below.current;
    if (!docked || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry)
        setExtra(
          Math.round(
            entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height,
          ),
        );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [docked]);
  const room = docked ? extra : 0;
  const barWidth = space.w - BAR_MARGIN;
  const phone = space.w > 0 && barWidth < CHAIN_BAR_COMPACT_BELOW;
  const layout: ChainWorkspaceLayout = {
    phone,
    barHasCompare: space.w === 0 || barWidth >= CHAIN_BAR_FULL_FROM,
  };
  const maxHeight = Math.max(chainMin, space.h - BAR - PANEL_MIN - room);
  const defaultHeight = Math.min(
    maxHeight,
    Math.max(chainMin, Math.round(space.h * (phone ? 0.42 : 0.5))),
  );
  const [ownChosen, setOwnChosen] = useState<number | null>(null);
  const chosen = chainHeight === undefined ? ownChosen : chainHeight || null;
  const setChosen = (next: number) => {
    setOwnChosen(next);
    onChainHeight?.(next);
  };
  const height = Math.min(
    maxHeight,
    Math.max(chainMin, chosen ?? defaultHeight),
  );

  return (
    <div
      ref={root}
      data-slot="chain-workspace"
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}
    >
      <div
        className={collapsed ? 'relative min-h-0 flex-1' : 'relative shrink-0'}
        style={collapsed ? undefined : { height: height + room }}
      >
        {aboveBar ? (
          <div className="flex h-full flex-col">
            <div className="relative min-h-0 flex-1">{chain}</div>
            <div ref={below} className="shrink-0">
              {aboveBar}
            </div>
          </div>
        ) : (
          chain
        )}
      </div>
      <ChainBar
        className={collapsed ? 'mx-2 mb-2' : 'mx-2'}
        canvas={canvas}
        chainView={chainView}
        onChainView={onChainView}
        height={height}
        minHeight={chainMin}
        maxHeight={maxHeight}
        defaultHeight={defaultHeight}
        onHeight={setChosen}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        selected={selected}
        onAdd={onAdd}
        addWaits={addWaits}
        edits={edits}
        lead={barLead}
        trail={barTrail}
        centre={barCentre}
      />
      {!collapsed && (
        <div
          role="region"
          aria-label={panelLabel}
          className={cn('min-h-0 flex-1 overflow-y-auto', panelClassName)}
        >
          {typeof children === 'function' ? children(layout) : children}
        </div>
      )}
    </div>
  );
}
