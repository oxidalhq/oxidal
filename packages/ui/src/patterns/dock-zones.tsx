import {
  CaretLineDown,
  CaretLineLeft,
  CaretLineRight,
  CaretLineUp,
  Check,
  DotsThree,
  PictureInPicture,
  PushPin,
  Rows,
  SidebarSimple,
  SquareHalfBottom,
  X,
} from '@phosphor-icons/react';
import {
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader } from '../components/ui/sheet';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui/tabs';
import { cn } from '../lib/cn';
import {
  type DockLayout,
  type DockTarget,
  fitLayout,
  moveTool,
  setZone,
  type Zone,
  ZONE_SIZE,
  type ZoneId,
} from '../lib/dock-layout';
import { useMedia } from '../lib/use-media';

/**
 * Tools kept beside the chain: three zones around a screen's middle (left,
 * right, and bottom, above the chain bar on the Rig), each holding one or
 * more tools as tabs, or split when there is room. Drag a tab to another
 * zone, or use its menu (Dock left, Dock right, Dock bottom, Float, Close)
 * by keyboard or touch. Each zone resizes with its grip and folds to a few
 * faint icons. A pinned zone pushes the middle aside; a side zone can
 * instead float over it as glass. With room for one side zone only, the
 * left zone's tools join the right one, floating. Work that runs (a track,
 * a split) carries on when its tool is folded or closed, and its icon keeps
 * a small light. On a phone the same tools are tabs in one bottom sheet
 * (`DockSheet`).
 * @see docs/interface.md
 */

export type DockTool = {
  id: string;
  title: string;
  icon: ReactNode;
  /** What it shows; `wide` is true in the bottom zone, laid out across. */
  content: ReactNode | ((where: { wide: boolean }) => ReactNode);
  /** Work that carries on when folded or closed, in words: "Slow Burn is playing". */
  running?: string;
};

const DRAG_TYPE = 'text/x-oxidal-tool';
const OUTER = 'rounded-[calc(var(--radius-lg)+0.25rem)]';
const GLASS = cn(
  OUTER,
  'border border-border/80 bg-card/90 shadow-[inset_0_1px_0_var(--color-background),0_8px_24px_rgb(0_0_0/0.08)] backdrop-blur-md [[data-display=epaper]_&]:bg-background [[data-display=epaper]_&]:backdrop-blur-none',
);
const ZONE_NAMES: Record<ZoneId, string> = {
  left: 'Left dock',
  right: 'Right dock',
  bottom: 'Bottom dock',
};
const FOLD_ICON: Record<ZoneId, ReactNode> = {
  left: <CaretLineLeft />,
  right: <CaretLineRight />,
  bottom: <CaretLineDown />,
};
const OPEN_ICON: Record<ZoneId, ReactNode> = {
  left: <CaretLineRight />,
  right: <CaretLineLeft />,
  bottom: <CaretLineUp />,
};

type Act = {
  move: (id: string, to: DockTarget, at?: { x: number; y: number }) => void;
  zone: (id: ZoneId, change: Partial<Zone>) => void;
  drag: (id: string | null) => void;
  tool: (id: string) => DockTool | undefined;
};

const contentOf = (tool: DockTool, wide: boolean) =>
  typeof tool.content === 'function' ? tool.content({ wide }) : tool.content;

/** Where to keep a tool, for keyboard and touch: the same moves as dragging its tab. */
function ToolMenu({
  tool,
  place,
  zone,
  zoneId,
  act,
  defaultOpen = false,
}: {
  tool: DockTool;
  place: DockTarget;
  zone?: Zone;
  zoneId?: ZoneId;
  act: Act;
  defaultOpen?: boolean;
}) {
  const go = (to: DockTarget) => () => place !== to && act.move(tool.id, to);
  const where = (to: DockTarget, icon: ReactNode, label: string) => (
    <DropdownMenuItem
      onSelect={go(to)}
      aria-current={place === to ? 'true' : undefined}
    >
      {icon} {label}
      {place === to && <Check className="ml-auto" aria-label="Here now" />}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu modal={false} defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${tool.title}: where to keep it`}
        >
          <DotsThree weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>{tool.title}</DropdownMenuLabel>
        {where('left', <SidebarSimple />, 'Dock left')}
        {where(
          'right',
          <SidebarSimple className="-scale-x-100" />,
          'Dock right',
        )}
        {where('bottom', <SquareHalfBottom />, 'Dock bottom')}
        {where('float', <PictureInPicture />, 'Float')}
        {zone && zoneId && (
          <>
            <DropdownMenuSeparator />
            {zone.tools.length > 1 && (
              <DropdownMenuItem
                onSelect={() => act.zone(zoneId, { split: !zone.split })}
              >
                <Rows className={cn(zoneId === 'bottom' && 'rotate-90')} />
                {zone.split
                  ? 'Show as tabs'
                  : zoneId === 'bottom'
                    ? 'Show side by side'
                    : 'Show stacked'}
              </DropdownMenuItem>
            )}
            {zoneId !== 'bottom' && (
              <DropdownMenuItem
                onSelect={() => act.zone(zoneId, { glass: !zone.glass })}
              >
                <PushPin />
                {zone.glass ? 'Pin beside the chain' : 'Float over the chain'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onSelect={() => act.zone(zoneId, { collapsed: true })}
            >
              {FOLD_ICON[zoneId]} Fold to a strip
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={go('closed')}>
          <X /> Close
        </DropdownMenuItem>
        {tool.running && (
          <p className="m-0 px-2 pt-1 pb-1.5 text-xs text-muted-foreground">
            {tool.running}; it carries on when folded or closed.
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The grip on a zone's inner edge: drag it, or focus it and use the arrow keys. */
function Grip({
  zoneId,
  size,
  onSize,
}: {
  zoneId: ZoneId;
  size: number;
  onSize: (size: number) => void;
}) {
  const drag = useRef<{ at: number; size: number } | null>(null);
  const { min, max } = ZONE_SIZE[zoneId];
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n)));
  const across = zoneId !== 'bottom';
  // Moving towards the middle makes a zone bigger.
  const sign = zoneId === 'left' ? 1 : -1;
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={across ? 'vertical' : 'horizontal'}
      aria-label={`${ZONE_NAMES[zoneId]} size`}
      aria-valuenow={size}
      aria-valuemin={min}
      aria-valuemax={max}
      title="Drag to resize"
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        drag.current = { at: across ? e.clientX : e.clientY, size };
        e.currentTarget.setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const now = across ? e.clientX : e.clientY;
        onSize(clamp(drag.current.size + sign * (now - drag.current.at)));
      }}
      onPointerUp={() => (drag.current = null)}
      onKeyDown={(e) => {
        const by = across
          ? { ArrowRight: 24 * sign, ArrowLeft: -24 * sign }[e.key]
          : { ArrowUp: 24, ArrowDown: -24 }[e.key];
        if (by) {
          e.preventDefault();
          onSize(clamp(size + by));
        }
      }}
      className={cn(
        'group/grip absolute z-10 grid place-items-center outline-none',
        across
          ? 'top-1/2 h-14 w-4 -translate-y-1/2 cursor-col-resize'
          : 'top-0 left-1/2 h-4 w-14 -translate-x-1/2 -translate-y-1/2 cursor-row-resize',
        zoneId === 'left' && 'right-0 translate-x-1/2',
        zoneId === 'right' && 'left-0 -translate-x-1/2',
      )}
    >
      <span
        className={cn(
          'rounded-full border border-border bg-card group-hover/grip:bg-accent group-focus-visible/grip:ring-2 group-focus-visible/grip:ring-ring',
          across ? 'h-11 w-1.5' : 'h-1.5 w-11',
        )}
      />
    </div>
  );
}

/**
 * A zone folded to a few faint icons: no line, no background, no column of
 * its own. They fade in on hover, focus or a tap; a light on an icon shows
 * work still running. Down the screen's edge, or in a row (beside the Rig's
 * IN and OUT controls, or above the chain bar).
 */
function Strip({
  zoneId,
  zone,
  act,
  across,
  className,
}: {
  zoneId: ZoneId;
  zone: Zone;
  act: Act;
  /** Icons in a row rather than down the edge. */
  across: boolean;
  className?: string;
}) {
  const open = (
    <Button
      key="open"
      variant="ghost"
      size="icon-xs"
      aria-label={`Open the ${ZONE_NAMES[zoneId].toLowerCase()}`}
      onClick={() => act.zone(zoneId, { collapsed: false })}
      className="[@media(pointer:coarse)]:size-touch"
    >
      {OPEN_ICON[zoneId]}
    </Button>
  );
  const tools = zone.tools.flatMap((id) => {
    const tool = act.tool(id);
    if (!tool) return [];
    return [
      <Button
        key={id}
        variant="ghost"
        size="icon-xs"
        title={tool.title}
        aria-label={`Open ${tool.title}${tool.running ? `. ${tool.running}` : ''}`}
        onClick={() => act.zone(zoneId, { collapsed: false, active: id })}
        className="relative [@media(pointer:coarse)]:size-touch"
      >
        {tool.icon}
        {tool.running && (
          <span
            aria-hidden="true"
            data-slot="running-light"
            className="absolute top-1 right-1 size-1.5 rounded-full bg-led-pedal"
          />
        )}
      </Button>,
    ];
  });
  return (
    <div
      role="toolbar"
      aria-label={`${ZONE_NAMES[zoneId]}, folded`}
      aria-orientation={across ? 'horizontal' : 'vertical'}
      data-slot="dock-strip"
      data-zone={zoneId}
      className={cn(
        'pointer-events-auto flex items-center gap-0.5',
        !across && 'flex-col',
        // Faint until reached for; the light on a running tool stays full.
        '[&_button]:text-foreground [&_button]:hover:bg-transparent [&_svg]:size-4 [&_svg]:opacity-40 [&_svg]:transition-opacity [&_svg]:duration-[var(--duration-base)] [&_svg]:ease-out focus-within:[&_svg]:opacity-100 hover:[&_svg]:opacity-100 active:[&_svg]:opacity-100 motion-reduce:[&_svg]:transition-none [[data-display=epaper]_&]:[&_svg]:opacity-100 [[data-display=epaper]_&]:[&_svg]:transition-none',
        className,
      )}
    >
      {zoneId === 'right' ? [...tools, open] : [open, ...tools]}
    </div>
  );
}

/** One docked tool's header when a zone is split: its name (drag it) and its menu. */
function PaneHeader({
  tool,
  end,
  onDragStart,
  onDragEnd,
}: {
  tool: DockTool;
  end: ReactNode;
  onDragStart: (e: DragEvent) => void;
  onDragEnd: () => void;
}) {
  return (
    <div className="flex min-h-control items-center gap-1 border-b border-border pr-1.5 pl-3 [&_svg]:size-4">
      <span
        draggable
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        className="flex min-w-0 flex-1 cursor-grab items-center gap-1.5 text-sm font-semibold active:cursor-grabbing"
      >
        <span aria-hidden="true" className="text-muted-foreground">
          {tool.icon}
        </span>
        <span className="truncate">{tool.title}</span>
      </span>
      {end}
    </div>
  );
}

function ZonePanel({
  zoneId,
  zone,
  act,
  roomToSplit,
  menuOpenFor,
  over,
  onOver,
}: {
  zoneId: ZoneId;
  zone: Zone;
  act: Act;
  roomToSplit: boolean;
  menuOpenFor?: string;
  over: boolean;
  onOver: (on: boolean) => void;
}) {
  const bottom = zoneId === 'bottom';
  const tools = zone.tools.flatMap((id) => act.tool(id) ?? []);
  const split = zone.split && roomToSplit && tools.length > 1;
  const active =
    tools.find((t) => t.id === zone.active) ?? (tools[0] as DockTool);
  const startDrag = (id: string) => (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, id);
    e.dataTransfer.effectAllowed = 'move';
    act.drag(id);
  };
  const end = (tool: DockTool, fold: boolean) => (
    <>
      <ToolMenu
        tool={tool}
        place={zoneId}
        zone={zone}
        zoneId={zoneId}
        act={act}
        defaultOpen={menuOpenFor === tool.id}
      />
      {fold && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Fold the ${ZONE_NAMES[zoneId].toLowerCase()}`}
          onClick={() => act.zone(zoneId, { collapsed: true })}
        >
          {FOLD_ICON[zoneId]}
        </Button>
      )}
    </>
  );
  return (
    <section
      aria-label={ZONE_NAMES[zoneId]}
      data-slot="dock-zone"
      data-zone={zoneId}
      data-glass={zone.glass || undefined}
      style={bottom ? { height: zone.size } : { width: zone.size }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        onOver(true);
      }}
      onDragLeave={() => onOver(false)}
      onDrop={(e) => {
        const id = e.dataTransfer.getData(DRAG_TYPE);
        onOver(false);
        if (id) {
          e.preventDefault();
          e.stopPropagation();
          act.move(id, zoneId);
        }
      }}
      className={cn(
        'relative flex min-h-0 shrink-0 flex-col text-foreground',
        bottom
          ? cn(OUTER, 'mx-2 mb-1.5 border border-border bg-card')
          : zone.glass
            ? cn(
                GLASS,
                'absolute top-14 z-20 max-h-[calc(100%-4.5rem)]',
                zoneId === 'left' ? 'left-2' : 'right-2',
              )
            : cn(
                'h-full bg-card',
                zoneId === 'left'
                  ? 'border-r border-border'
                  : 'border-l border-border',
              ),
        over && 'ring-2 ring-ring ring-inset',
      )}
    >
      <Grip
        zoneId={zoneId}
        size={zone.size}
        onSize={(size) => act.zone(zoneId, { size })}
      />
      {split ? (
        <div
          className={cn(
            'grid min-h-0 flex-1',
            bottom
              ? 'auto-cols-fr grid-flow-col divide-x divide-border'
              : 'auto-rows-fr divide-y divide-border',
          )}
        >
          {tools.map((tool, i) => (
            <div
              key={tool.id}
              role="group"
              aria-label={tool.title}
              className="flex min-h-0 min-w-0 flex-col"
            >
              <PaneHeader
                tool={tool}
                onDragStart={startDrag(tool.id)}
                onDragEnd={() => act.drag(null)}
                end={end(tool, i === (bottom ? tools.length - 1 : 0))}
              />
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {contentOf(tool, false)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Tabs
          value={active.id}
          onValueChange={(v) => act.zone(zoneId, { active: v })}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex items-center gap-1 border-b border-border pr-1.5">
            <TabsList className="min-w-0 flex-1 border-b-0 px-2">
              {tools.map((tool) => (
                <TabsTrigger
                  key={tool.id}
                  value={tool.id}
                  draggable
                  onDragStart={startDrag(tool.id)}
                  onDragEnd={() => act.drag(null)}
                  className="min-h-control [@media(pointer:coarse)]:min-h-touch"
                >
                  {tool.icon}
                  {tool.title}
                </TabsTrigger>
              ))}
            </TabsList>
            {end(active, true)}
          </div>
          <TabsContent
            value={active.id}
            className="min-h-0 flex-1 overflow-y-auto p-3"
          >
            {contentOf(active, bottom)}
          </TabsContent>
        </Tabs>
      )}
    </section>
  );
}

/** A tool on its own, floating as glass; drag it by its header. */
function FloatingWindow({
  tool,
  x,
  y,
  act,
  onPlace,
  menuOpen,
}: {
  tool: DockTool;
  x: number;
  y: number;
  act: Act;
  onPlace: (x: number, y: number) => void;
  menuOpen: boolean;
}) {
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  return (
    <section
      aria-label={`${tool.title}, floating`}
      data-slot="dock-float"
      style={{ left: x, top: y }}
      className={cn(
        GLASS,
        'absolute z-30 flex max-h-[min(30rem,calc(100%-6rem))] w-80 flex-col',
      )}
    >
      <header
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          grab.current = { dx: e.clientX - x, dy: e.clientY - y };
        }}
        onPointerMove={(e) => {
          if (grab.current)
            onPlace(
              Math.max(8, e.clientX - grab.current.dx),
              Math.max(8, e.clientY - grab.current.dy),
            );
        }}
        onPointerUp={() => (grab.current = null)}
        className="flex min-h-control cursor-grab touch-none items-center gap-1.5 border-b border-border pr-1.5 pl-3 select-none active:cursor-grabbing [&_svg]:size-4"
      >
        <span aria-hidden="true" className="text-muted-foreground">
          {tool.icon}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {tool.title}
        </span>
        <ToolMenu tool={tool} place="float" act={act} defaultOpen={menuOpen} />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Close ${tool.title}`}
          onClick={() => act.move(tool.id, 'closed')}
        >
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {contentOf(tool, false)}
      </div>
    </section>
  );
}

/** While a tab is dragged: the empty zones it can land in. */
function DropTargets({ layout, act }: { layout: DockLayout; act: Act }) {
  const [over, setOver] = useState<DockTarget | null>(null);
  const target = (to: ZoneId, className: string) =>
    layout.zones[to].tools.length === 0 && (
      <div
        data-slot="dock-target"
        onDragOver={(e) => {
          e.preventDefault();
          setOver(to);
        }}
        onDragLeave={() => setOver(null)}
        onDrop={(e) => {
          const id = e.dataTransfer.getData(DRAG_TYPE);
          e.preventDefault();
          e.stopPropagation();
          setOver(null);
          if (id) act.move(id, to);
        }}
        className={cn(
          OUTER,
          'pointer-events-auto absolute z-40 grid place-items-center border border-ring bg-accent/80 text-sm font-semibold text-foreground backdrop-blur-sm',
          over === to && 'ring-2 ring-ring',
          className,
        )}
      >
        {{ left: 'Dock left', right: 'Dock right', bottom: 'Dock bottom' }[to]}
      </div>
    );
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-40"
    >
      {target('left', 'top-14 bottom-16 left-2 w-28')}
      {target('right', 'top-14 right-2 bottom-16 w-28')}
      {target('bottom', 'right-32 bottom-14 left-32 h-20')}
    </div>
  );
}

/**
 * A folded strip a screen placed itself, such as in the Rig's IN and OUT
 * lanes beside the guitar and the output level. While it is shown, the dock
 * does not draw its own copy at the screen's edge.
 */
function PlacedStrip({
  side,
  onPlaced,
  children,
}: {
  side: 'left' | 'right';
  onPlaced: (side: 'left' | 'right', placed: boolean) => void;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    onPlaced(side, true);
    return () => onPlaced(side, false);
  }, [side, onPlaced]);
  return children;
}

/**
 * What a screen places itself: the bottom zone, and (with `inside`) the glass
 * zones. The folded strips are always offered: a screen that places one
 * (beside IN and OUT) takes it from the edge.
 */
export type DockParts = {
  bottom: ReactNode;
  glass: ReactNode;
  strips: { left: ReactNode; right: ReactNode };
};

/**
 * The three zones around a screen's middle. `children` gets the bottom zone
 * to place: above the chain bar on the Rig, above the bottom row on Perform.
 */
export function DockZones({
  tools,
  layout,
  onLayout,
  menuOpenFor,
  inside = false,
  children,
  className,
}: {
  /** Every tool the screen offers; the layout says where each one is. */
  tools: DockTool[];
  layout: DockLayout;
  onLayout: (layout: DockLayout) => void;
  /** Hold one tool's menu open, for a picture of it. */
  menuOpenFor?: string;
  /**
   * The caller places the glass zones (over the Rig's chain only, clear of
   * the bottom zone and the bar). Otherwise they float at the screen's
   * edges. The folded side strips go wherever the caller places
   * `strips` (beside IN and OUT), and at the edges when it does not.
   */
  inside?: boolean;
  children: (parts: DockParts) => ReactNode;
  className?: string;
}) {
  const bothSides = useMedia('(min-width: 75rem)');
  const tall = useMedia('(min-height: 45rem)');
  const shown = fitLayout(layout, bothSides);
  const root = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  /** Folded strips the screen placed itself (in the Rig's lanes). */
  const [placed, setPlaced] = useState({ left: false, right: false });
  const onPlaced = useCallback(
    (side: 'left' | 'right', on: boolean) =>
      setPlaced((p) => (p[side] === on ? p : { ...p, [side]: on })),
    [],
  );
  const [over, setOver] = useState<ZoneId | null>(null);
  const act: Act = {
    move: (id, to, at) => {
      setDragging(null);
      onLayout(moveTool(layout, id, to, at));
    },
    zone: (id, change) => {
      // With room for one side zone, the right zone shows the left zone's
      // tools too, so a change to it applies to both.
      let next = setZone(layout, id, change);
      if (!bothSides && id === 'right' && layout.zones.left.tools.length) {
        const rest = { ...change };
        delete rest.active;
        next = setZone(next, 'left', rest);
      }
      onLayout(next);
    },
    drag: setDragging,
    tool: (id) => tools.find((t) => t.id === id),
  };
  const zone = (id: ZoneId) => {
    const z = shown.zones[id];
    if (!z.tools.some((t) => act.tool(t))) return null;
    if (z.collapsed)
      return id === 'bottom' ? (
        <Strip
          zoneId={id}
          zone={z}
          act={act}
          across
          className="mx-2 mb-0.5 self-start"
        />
      ) : null;
    return (
      <ZonePanel
        zoneId={id}
        zone={z}
        act={act}
        roomToSplit={id === 'bottom' ? bothSides : tall}
        menuOpenFor={menuOpenFor}
        over={over === id}
        onOver={(on) => setOver(on ? id : null)}
      />
    );
  };
  const glass = (id: 'left' | 'right') =>
    shown.zones[id].glass && !shown.zones[id].collapsed;
  const floating = (
    <>
      {glass('left') && zone('left')}
      {glass('right') && zone('right')}
    </>
  );
  // A folded side zone takes no room: its icons float at the edge.
  const strip = (id: 'left' | 'right', across: boolean, className?: string) => {
    const z = shown.zones[id];
    return z.tools.length && z.collapsed ? (
      <Strip
        zoneId={id}
        zone={z}
        act={act}
        across={across}
        className={className}
      />
    ) : null;
  };
  const placeable = (id: 'left' | 'right') => {
    const folded = strip(id, true);
    return (
      folded && (
        <PlacedStrip side={id} onPlaced={onPlaced}>
          {folded}
        </PlacedStrip>
      )
    );
  };
  const parts: DockParts = {
    bottom: zone('bottom'),
    glass: inside && floating,
    strips: { left: placeable('left'), right: placeable('right') },
  };
  return (
    <div
      ref={root}
      data-slot="dock-zones"
      className={cn('relative flex h-full min-h-0', className)}
    >
      {!glass('left') && !shown.zones.left.collapsed && zone('left')}
      <div
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault();
        }}
        onDrop={(e) => {
          // Dropped over the middle: the tool floats where it was let go.
          const id = e.dataTransfer.getData(DRAG_TYPE);
          const box = root.current?.getBoundingClientRect();
          if (!id || !box) return;
          e.preventDefault();
          act.move(id, 'float', {
            x: Math.round(e.clientX - box.left - 40),
            y: Math.round(e.clientY - box.top - 16),
          });
        }}
      >
        {children(parts)}
        {!inside && (
          <>
            {floating}
            {/* Folded panels wait at the top of the edge, under the capsule,
                where they are seen, unless the screen placed them (the
                Rig's lanes, so they never sit on a meter). */}
            {!placed.left &&
              strip('left', false, 'absolute top-20 left-1 z-20')}
            {!placed.right &&
              strip('right', false, 'absolute top-20 right-1 z-20')}
          </>
        )}
      </div>
      {!glass('right') && !shown.zones.right.collapsed && zone('right')}
      {layout.floating.map((f) => {
        const tool = act.tool(f.id);
        return (
          tool && (
            <FloatingWindow
              key={f.id}
              tool={tool}
              x={f.x}
              y={f.y}
              act={act}
              menuOpen={menuOpenFor === f.id}
              onPlace={(x, y) =>
                onLayout({
                  ...layout,
                  floating: layout.floating.map((g) =>
                    g.id === f.id ? { ...g, x, y } : g,
                  ),
                })
              }
            />
          )
        );
      })}
      {dragging && <DropTargets layout={shown} act={act} />}
    </div>
  );
}

/**
 * A phone's tools: one bottom sheet with a tab for each, one at a time. It
 * opens on the sheet itself without a focus ring (it was tapped open; Tab
 * still reaches Close first) and starts tall enough that its edge falls on
 * the chain, not on a row of controls; Mute stays above it.
 */
export function DockSheet({
  tools,
  open,
  onOpenChange,
  active,
  onActive,
  title,
  description,
}: {
  tools: DockTool[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: string;
  onActive: (id: string) => void;
  /** Such as the track: "Slow Burn". */
  title: string;
  description?: string;
}) {
  const current = tools.find((t) => t.id === active) ?? tools[0];
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        onOpenChange={onOpenChange}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus({
            preventScroll: true,
            focusVisible: false,
          } as FocusOptions);
        }}
        className="max-h-[calc(100dvh-5rem)] min-h-[66dvh]"
      >
        <SheetHeader title={title} description={description} />
        {current && (
          <Tabs
            value={current.id}
            onValueChange={onActive}
            className="flex min-h-0 flex-1 flex-col"
          >
            <TabsList className="overflow-x-auto px-2">
              {tools.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="min-h-control shrink-0 [@media(pointer:coarse)]:min-h-touch"
                >
                  {t.title}
                </TabsTrigger>
              ))}
            </TabsList>
            <TabsContent
              value={current.id}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-4"
            >
              {contentOf(current, false)}
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
