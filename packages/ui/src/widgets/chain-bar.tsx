import {
  CaretDown,
  CaretUp,
  ClockCounterClockwise,
  CornersOut,
  Crosshair,
  DotsSix,
  FloppyDisk,
  ListBullets,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  MapTrifold,
  Plus,
} from '@phosphor-icons/react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button } from '../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Separator } from '../components/ui/separator';
import { Switch } from '../components/ui/switch';
import type { ChainCanvasControl } from '../lib/chain-canvas-control';
import { cn } from '../lib/cn';
import { CompareToggle } from './versions';

/**
 * The slim bar between the chain map and the panel under it. It holds the
 * map tools (zoom, fit, centre, list, Map or Tree, minimap, Follow), a grip
 * on its top edge that drags the chain taller or shorter, and a button that
 * hides the panel so the chain fills the screen. With the panel hidden the
 * bar sits at the bottom and names the selected block and whether it is on.
 * On a phone it keeps one row: pinch zooms, so the zoom buttons and the
 * minimap go.
 *
 * Given `edits` and `onAdd`, it also carries the editing tools: Add (a block
 * after the selected one), the change count that opens the change list, the
 * Edited and Saved compare, where changes apply, and Save. The count, the
 * compare and the scope appear only once something has changed. Narrower
 * than a desktop the zoom buttons, the minimap, the compare and the scope
 * step out (the panel keeps the compare and the scope); a phone keeps fit,
 * centre, Map or Tree, the count, Save and Hide.
 * @see docs/interface.md
 */

/** Arrow keys on the grip move the chain edge this far. */
export const CHAIN_HEIGHT_STEP = 24;
/** Narrower than this, the bar keeps only what a phone needs. */
export const CHAIN_BAR_COMPACT_BELOW = 560;
/** With the editing tools, the bar shows all of them from this width. */
export const CHAIN_BAR_FULL_FROM = 1100;

/** Changes since the preset was saved, and the tools that go with them. */
export type ChainBarEdits = {
  /** How many changes since saving; 0 hides the count, compare and scope. */
  count: number;
  /** The change list, opened from the count. */
  list: ReactNode;
  compare: 'edited' | 'saved';
  onCompare: (value: 'edited' | 'saved') => void;
  /** The compare cannot switch now, such as while a change is being sent. */
  compareDisabled?: boolean;
  /** Where changes go, such as `ChangeScope`. */
  scope?: ReactNode;
  /** Save from the bar; left out where the screen saves elsewhere. */
  onSave?: () => void;
  saving?: boolean;
  /**
   * Whether Save can be pressed; by default only once something has
   * changed. A screen whose changes are not all listed (such as a new
   * version built by an edit) or that has its own reasons to wait says so.
   */
  canSave?: boolean;
  /** Why Save waits, said on the button. */
  saveTitle?: string;
  /** The button's word, such as "Save copy" where an original is never overwritten. */
  saveLabel?: string;
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export function ChainBar({
  canvas,
  chainView,
  onChainView,
  height,
  minHeight,
  maxHeight,
  defaultHeight,
  onHeight,
  collapsed,
  onCollapsedChange,
  selected,
  onAdd,
  addWaits,
  edits,
  lead,
  centre,
  trail,
  compact: compactIn,
  className,
}: {
  /** The chain map's control: its zoom, list, minimap and Follow, and its commands. */
  canvas: ChainCanvasControl;
  /** The chain drawn as a map or as a tree. Leave out to hide the choice. */
  chainView?: 'map' | 'tree';
  onChainView?: (view: 'map' | 'tree') => void;
  /** Height of the chain area above the bar, in CSS pixels. */
  height: number;
  minHeight: number;
  maxHeight: number;
  /** Where a double-click on the grip puts the edge back. */
  defaultHeight: number;
  onHeight: (height: number) => void;
  /** The panel under the bar is hidden and the chain fills the screen. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** The selected block, named on the bar while the panel is hidden. */
  selected?: { name: string; on: boolean } | null;
  /** Adds a block after the selected one. */
  onAdd?: () => void;
  /** Why Add cannot be used now, such as a routing that cannot be rearranged; Add stays in its place, dimmed. */
  addWaits?: string;
  /** Changes since saving, with compare, scope and Save. */
  edits?: ChainBarEdits;
  /** At the bar's start, before the map tools, such as the preset picker. */
  lead?: ReactNode;
  /** In the bar's empty middle, such as how the chain is being run. */
  centre?: ReactNode;
  /** Before Save and Hide, such as Tuner and Perform. */
  trail?: ReactNode;
  /** Force the phone row; by default the bar decides from its own width. */
  compact?: boolean;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  // Unknown until measured: draw the full row.
  const [width, setWidth] = useState(Infinity);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width ?? 0;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const compact = compactIn ?? width < CHAIN_BAR_COMPACT_BELOW;
  const editing = !!(edits || onAdd);
  // Between a phone and a desktop the editing tools need the zoom's room;
  // a preset at the start and actions at the end need more.
  const full = CHAIN_BAR_FULL_FROM + (lead ? 300 : 0) + (trail ? 200 : 0);
  const trim = editing && !compact && width < full;
  // A phone with a preset at the start keeps only the preset, the count, Save and Hide.
  const leadOnly = compact && !!lead;
  const changed = !!edits && edits.count > 0;
  const tree = chainView === 'tree';
  // The tree pans and zooms like the map; only the list stands still.
  const mapOff = canvas.list && !tree;

  const set = (h: number) =>
    onHeight(clamp(Math.round(h), minHeight, maxHeight));
  const drag = useRef<{ y: number; h: number; id: number } | null>(null);
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (collapsed || e.button !== 0) return;
    const on = e.target as HTMLElement;
    // Buttons and switches keep their own job; empty space and the grip resize.
    if (on.closest('button, input, label, a')) return;
    e.preventDefault();
    drag.current = { y: e.clientY, h: height, id: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const moveDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    set(d.h + e.clientY - d.y);
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };
  const gripKeys = (e: ReactKeyboardEvent) => {
    const to = {
      ArrowUp: height - CHAIN_HEIGHT_STEP,
      ArrowDown: height + CHAIN_HEIGHT_STEP,
      Home: minHeight,
      End: maxHeight,
      Enter: defaultHeight,
    }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    set(to);
  };

  // A touch screen keeps the 44 px height; the bar's buttons stay 36 px wide.
  const narrowTarget = '[@media(pointer:coarse)]:min-w-0';
  const tool = (
    label: string,
    icon: ReactNode,
    onClick: () => void,
    extra?: { disabled?: boolean; pressed?: boolean; hidden?: boolean },
  ) =>
    extra?.hidden ? null : (
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        title={label}
        disabled={extra?.disabled}
        aria-pressed={extra?.pressed}
        // A pressed tool keeps its fill; hover darkens the sign only, so a
        // tool beside a pressed one never looks pressed too.
        className={cn(
          narrowTarget,
          'hover:bg-transparent hover:text-foreground',
          extra?.pressed && 'bg-accent hover:bg-accent',
        )}
        onClick={onClick}
      >
        {icon}
      </Button>
    );
  // A phone with the editing tools has no room for rules; the gaps group them.
  const rule =
    compact && editing ? null : (
      <Separator orientation="vertical" className="mx-1 h-5" />
    );
  // With the panel hidden, the bar says which block is selected and whether it is on.
  const named = collapsed && !!selected;
  const name = selected && (
    <span
      className="flex min-w-0 items-baseline gap-1 px-1 text-sm"
      data-slot="chain-bar-selected"
    >
      <span className="truncate font-semibold">{selected.name}</span>
      <span className="shrink-0 font-normal text-muted-foreground">
        · {selected.on ? 'On' : 'Off'}
      </span>
    </span>
  );

  return (
    <div
      ref={root}
      role="toolbar"
      aria-label="Chain tools"
      data-slot="chain-bar"
      data-collapsed={collapsed || undefined}
      data-compact={compact || undefined}
      className={cn(
        'relative flex min-h-9 touch-none items-center gap-0.5 rounded-lg border border-border bg-card px-1 py-1 select-none [@media(pointer:coarse)]:py-0.5',
        className,
      )}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {!collapsed && (
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="horizontal"
          aria-label="Chain height"
          aria-valuenow={Math.round(height)}
          aria-valuemin={Math.round(minHeight)}
          aria-valuemax={Math.round(maxHeight)}
          title="Drag to make the chain taller or shorter. Double-click to reset."
          data-slot="chain-bar-grip"
          // A 24 px target; the pill drawn inside it sits on the bar's top
          // edge, clear of the buttons below.
          className="group/grip absolute -top-[18px] left-1/2 z-10 grid h-6 w-14 -translate-x-1/2 cursor-row-resize place-items-center outline-none"
          onKeyDown={gripKeys}
          onDoubleClick={() => set(defaultHeight)}
        >
          <span className="grid h-4 w-11 place-items-center rounded-full border border-border bg-card text-muted-foreground group-hover/grip:text-foreground group-focus-visible/grip:ring-2 group-focus-visible/grip:ring-ring">
            <DotsSix weight="bold" className="size-3.5" aria-hidden />
          </span>
        </div>
      )}

      {lead && (
        <>
          <div className="flex min-w-0 shrink items-center">{lead}</div>
          {!leadOnly && rule}
        </>
      )}
      {tool('Zoom out', <MagnifyingGlassMinus />, canvas.zoomOut, {
        hidden: compact || trim,
        disabled: mapOff,
      })}
      {!compact && !trim && (
        <span
          className={cn(
            'w-11 text-center font-mono text-xs tabular-nums',
            mapOff && 'text-muted-foreground',
          )}
        >
          {Math.round(canvas.zoom * 100)}%
        </span>
      )}
      {tool('Zoom in', <MagnifyingGlassPlus />, canvas.zoomIn, {
        hidden: compact || trim,
        disabled: mapOff,
      })}
      {tool('Fit the whole chain', <CornersOut />, canvas.fit, {
        disabled: mapOff,
        hidden: leadOnly,
      })}
      {tool('Centre on the selected block', <Crosshair />, canvas.centre, {
        disabled: mapOff || !selected,
        hidden: leadOnly,
      })}
      {tool(
        canvas.list ? 'Show the map' : 'Show the chain as a list',
        <ListBullets />,
        () => canvas.setList(!canvas.list),
        { pressed: canvas.list, disabled: tree, hidden: compact && editing },
      )}

      {/* A phone with the panel hidden needs the room for the block's name. */}
      {chainView && onChainView && !(compact && named) && !leadOnly && (
        <>
          {rule}
          {/* A two-way switch with no box: the chosen view is filled in ink,
              the other stays plain text beside it. */}
          <div role="group" aria-label="Chain view" className="flex gap-0.5">
            {(['map', 'tree'] as const).map((v) => (
              <Button
                key={v}
                size="xs"
                variant="ghost"
                aria-pressed={chainView === v}
                className={cn(
                  // Only the chosen view has a fill; hover darkens the other's
                  // word, so the pair never shows two boxes side by side.
                  'px-2.5 hover:bg-transparent hover:text-foreground aria-[pressed=true]:bg-foreground aria-[pressed=true]:text-background aria-[pressed=true]:hover:bg-foreground aria-[pressed=true]:hover:text-background',
                  narrowTarget,
                )}
                onClick={() => onChainView(v)}
              >
                {v === 'map' ? 'Map' : 'Tree'}
              </Button>
            ))}
          </div>
        </>
      )}

      {!compact && !trim && (
        <>
          {rule}
          {tool(
            canvas.minimap ? 'Hide the minimap' : 'Show the minimap',
            <MapTrifold />,
            () => canvas.setMinimap(!canvas.minimap),
            { pressed: canvas.minimap, disabled: mapOff || tree },
          )}
        </>
      )}
      {!(compact && editing) && (
        <>
          {rule}
          <label className="flex items-center gap-1.5 px-1 text-xs">
            <span className={cn(compact && 'sr-only')}>Follow</span>
            <Switch
              checked={canvas.follow}
              onCheckedChange={canvas.setFollow}
              disabled={mapOff}
              aria-label="Follow the selected block"
              // As tall as the buttons beside it; a touch screen keeps the
              // full target. Marked important: the switch's own 44 px minimum
              // is a spacing name the class merger does not know to replace.
              className="min-h-control-xs [@media(pointer:coarse)]:min-h-touch"
            />
          </label>
        </>
      )}
      {onAdd && !compact && (
        <>
          {rule}
          <Button
            variant="ghost"
            size="xs"
            className="px-2.5"
            aria-label={
              selected ? `Add a block after ${selected.name}` : 'Add a block'
            }
            title={addWaits ?? 'Add a block after the selected one'}
            disabled={!selected || !!addWaits}
            onClick={onAdd}
          >
            <Plus /> Add
          </Button>
        </>
      )}

      {/* Empty space: dragging it resizes the chain, like the grip. A quiet
          status can sit in its middle; the space around it still drags. */}
      <div
        aria-hidden={centre && !compact ? undefined : true}
        className={cn(
          // A size container, so the status can shorten to the room it has.
          '@container flex min-w-2 flex-1 items-center justify-center self-stretch overflow-hidden',
          !collapsed && 'cursor-row-resize',
          named && compact && !edits && 'hidden',
        )}
      >
        {!compact && centre}
      </div>

      {named && !compact && name}
      {changed && edits && (
        <>
          {(!compact || named) && rule}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                aria-label={`${edits.count} ${edits.count === 1 ? 'change' : 'changes'}`}
                title="What changed since saving"
                className={cn('px-2', narrowTarget)}
              >
                <ClockCounterClockwise />
                {edits.count}
                {!compact && (edits.count === 1 ? ' change' : ' changes')}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 max-w-[calc(100vw-2rem)]">
              {edits.list}
            </PopoverContent>
          </Popover>
          {!compact && !trim && (
            <>
              <CompareToggle
                size="xs"
                value={edits.compare}
                onChange={edits.onCompare}
                disabled={edits.compareDisabled}
              />
              {edits.scope}
            </>
          )}
        </>
      )}
      {trail && (
        <>
          {rule}
          <div className="flex shrink-0 items-center gap-0.5">{trail}</div>
        </>
      )}
      {edits?.onSave && (
        <>
          {rule}
          <Button
            variant="ghost"
            size="xs"
            className={cn(
              'px-2.5',
              (edits.canSave ?? changed) && 'font-semibold',
              narrowTarget,
            )}
            disabled={!(edits.canSave ?? changed) || edits.saving}
            title={
              edits.saveTitle ??
              ((edits.canSave ?? changed)
                ? undefined
                : 'Nothing has changed since saving')
            }
            onClick={edits.onSave}
          >
            {!compact && <FloppyDisk />}
            {edits.saving ? 'Saving…' : (edits.saveLabel ?? 'Save')}
            {(edits.canSave ?? changed) && !edits.saving && (
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-brand"
              />
            )}
          </Button>
        </>
      )}
      {(!compact || edits) && rule}
      <Button
        variant="ghost"
        size={(compact && !named) || trim ? 'icon-xs' : 'xs'}
        aria-label={
          collapsed
            ? `Show panel${selected ? `: ${selected.name}, ${selected.on ? 'on' : 'off'}` : ''}`
            : 'Hide panel'
        }
        aria-expanded={!collapsed}
        title={
          collapsed
            ? 'Show the panel under the chain'
            : 'Hide the panel, so the chain fills the screen'
        }
        className={cn(
          'shrink-0',
          narrowTarget,
          !compact && !trim && 'px-2.5',
          // On a phone the hidden panel's button carries the block's name.
          named &&
            compact &&
            !edits &&
            'min-w-0 flex-1 shrink justify-end px-1.5',
        )}
        onClick={() => onCollapsedChange(!collapsed)}
      >
        {named && compact && !edits && name}
        {!compact && !trim && (collapsed ? 'Show' : 'Hide')}
        {collapsed ? <CaretUp /> : <CaretDown />}
      </Button>
    </div>
  );
}
