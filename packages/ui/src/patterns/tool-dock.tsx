import {
  ArrowsInSimple,
  PictureInPicture,
  SidebarSimple,
  Toolbox,
  X,
} from '@phosphor-icons/react';
import * as React from 'react';
import { createPortal } from 'react-dom';

import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from '../components/ui/sheet';
import { cn } from '../lib/cn';
import { useMedia } from '../lib/use-media';
import {
  type Dock,
  DockContext,
  LauncherSlotContext,
  type ToolPlace,
  type ToolPlaces,
  type ToolPosition,
} from './dock-context';

export type { ToolPlace, ToolPlaces, ToolPosition } from './dock-context';

export type DockTool = {
  id: string;
  title: string;
  icon: React.ReactNode;
  /** The tool itself: a backing player, a chord sheet, the venue EQ. */
  render: () => React.ReactNode;
};

const WIDTH = '22rem';
const FLOAT_VIEWPORT = '(min-width: 48rem)';

/**
 * Keeping things open beside the page. Anything that opens as a sheet can
 * be kept: the standing tools listed here (backing track, chord sheet, venue
 * EQ, tuner) and any `DockableSheet` inside (a block's controls, Change…,
 * the scene editor).
 *
 * A panel opens the way everything else does, as a **sheet** (from the
 * right on wide screens, from the bottom on phones). From the sheet you can
 * **float** it, to drag it by its header and resize it from its corner, or
 * **pin** it left or right, where it stays beside the page and the page
 * narrows to make room. Several can be pinned on a side; they stack. Where
 * you put a panel is remembered, so it opens there next time.
 *
 * - Laptops and wide tablets: sheet, float, pin left, pin right.
 * - Narrow tablets: sheet or float (there is no room to pin).
 * - Phones: a sheet only.
 *
 * The places are the caller's to keep (per player, per device).
 */
export function ToolDock({
  tools,
  places,
  onPlaces,
  lastPlaces,
  positions,
  onPositions,
  children,
  className,
}: {
  tools: DockTool[];
  places: ToolPlaces;
  onPlaces: (places: ToolPlaces) => void;
  /** Last non-closed placement, independent of session open state. */
  lastPlaces?: ToolPlaces;
  positions?: Record<string, ToolPosition>;
  onPositions?: (positions: Record<string, ToolPosition>) => void;
  children: React.ReactNode;
  className?: string;
}) {
  const wide = useMedia('(min-width: 64rem)');
  const tablet = useMedia(FLOAT_VIEWPORT);
  const [localSpots, setLocalSpots] = React.useState<
    Record<string, ToolPosition>
  >({});
  const spots = positions ?? localSpots;
  const [left, setLeft] = React.useState<HTMLElement | null>(null);
  const [right, setRight] = React.useState<HTMLElement | null>(null);
  const [float, setFloat] = React.useState<HTMLElement | null>(null);

  const setSpot = (id: string, spot: ToolPosition) => {
    const next = { ...spots, [id]: { ...spots[id], ...spot } };
    if (onPositions) onPositions(next);
    else setLocalSpots(next);
  };
  React.useEffect(() => {
    const keepReachable = () => {
      // Phone layouts show sheets. Keep each floating window's saved rectangle
      // until the viewer returns to a viewport that can display it.
      if (!window.matchMedia?.(FLOAT_VIEWPORT).matches) return;
      let changed = false;
      const next = { ...spots };
      for (const [id, spot] of Object.entries(spots)) {
        const width = Math.max(
          256,
          Math.min(spot.width ?? 352, window.innerWidth - 16),
        );
        const height =
          spot.height == null
            ? undefined
            : Math.max(160, Math.min(spot.height, window.innerHeight - 96));
        const x = Math.max(8, Math.min(spot.x, window.innerWidth - width - 8));
        const y = Math.max(8, Math.min(spot.y, window.innerHeight - 56));
        if (
          x !== spot.x ||
          y !== spot.y ||
          width !== spot.width ||
          height !== spot.height
        ) {
          next[id] = { x, y, width, height };
          changed = true;
        }
      }
      if (changed) {
        if (onPositions) onPositions(next);
        else setLocalSpots(next);
      }
    };
    let active = true;
    window.addEventListener('resize', keepReachable);
    queueMicrotask(() => {
      if (active) keepReachable();
    });
    return () => {
      active = false;
      window.removeEventListener('resize', keepReachable);
    };
  }, [spots, onPositions]);
  const placeOf = (id: string): ToolPlace => places[id] ?? 'closed';
  const put = (id: string, place: ToolPlace) => {
    // One standing tool in a sheet at a time; on a phone, one tool at all.
    const next: ToolPlaces = { ...places };
    for (const tool of tools) {
      if (tool.id === id || place === 'closed') continue;
      const now = placeOf(tool.id);
      if (!tablet || (place === 'sheet' && now === 'sheet'))
        next[tool.id] = 'closed';
    }
    next[id] = place;
    onPlaces(next);
  };
  /** Where a standing tool actually shows on this screen. */
  const shown = (id: string): ToolPlace => {
    const place = placeOf(id);
    if (place === 'closed' || place === 'sheet') return place;
    if (!tablet) return 'sheet';
    if (!wide) return 'float';
    return place;
  };
  const dock: Dock = {
    tablet,
    wide,
    preferredPlace: (id) => places[id] ?? lastPlaces?.[id] ?? 'sheet',
    put,
    slots: { left, right, float },
    spotOf: (id) => {
      const index = Math.max(
        0,
        tools.findIndex((t) => t.id === id),
      );
      const edge = typeof window === 'undefined' ? 1280 : window.innerWidth;
      // Start at the right edge, clear of the page's own controls.
      return (
        spots[id] ?? {
          x: Math.max(8, edge - 376 - index * 28),
          y: 96 + index * 28,
        }
      );
    },
    setSpot,
  };

  const slot = React.useContext(LauncherSlotContext);
  /** The tools: one labelled menu in the shell's masthead, or a row above the page. */
  const launcher = (masthead: boolean) => {
    const toggle = (tool: DockTool) =>
      put(
        tool.id,
        placeOf(tool.id) !== 'closed'
          ? 'closed'
          : lastPlaces?.[tool.id] === 'closed'
            ? 'sheet'
            : (lastPlaces?.[tool.id] ?? 'sheet'),
      );
    const open = tools.filter((t) => placeOf(t.id) !== 'closed').length;
    const quiet =
      'text-enclosure-foreground/70 hover:bg-enclosure-border hover:text-enclosure-foreground aria-[pressed=true]:bg-enclosure-border aria-[pressed=true]:text-enclosure-foreground';
    if (!masthead)
      return (
        <div
          role="toolbar"
          aria-label="Tools to keep open"
          className="flex flex-wrap items-center justify-end gap-1 px-page pt-2"
        >
          {tools.map((tool) => (
            <Button
              key={tool.id}
              size="sm"
              variant={placeOf(tool.id) !== 'closed' ? 'secondary' : 'ghost'}
              aria-pressed={placeOf(tool.id) !== 'closed'}
              aria-label={`${tool.title} panel`}
              onClick={() => toggle(tool)}
            >
              {tool.icon}
              <span className="hidden sm:inline">{tool.title}</span>
              <span className="sm:hidden">{tool.title.split(' ')[0]}</span>
            </Button>
          ))}
        </div>
      );
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className={quiet}>
            <Toolbox />
            <span className="max-lg:sr-only">Tools</span>
            {open > 0 && (
              <span className="font-mono text-xs tabular-nums">{open}</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Keep open while you play</DropdownMenuLabel>
          {tools.map((tool) => (
            <DropdownMenuCheckboxItem
              key={tool.id}
              checked={placeOf(tool.id) !== 'closed'}
              onSelect={() => toggle(tool)}
            >
              {tool.icon} {tool.title}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };
  const at = (where: ToolPlace) => tools.filter((t) => shown(t.id) === where);
  const sheet = at('sheet')[0];
  const panel = (tool: DockTool) => (
    <ToolPanel
      key={tool.id}
      id={tool.id}
      title={tool.title}
      icon={tool.icon}
      place={shown(tool.id)}
      dock={dock}
      onPlace={(place) => put(tool.id, place)}
    >
      {tool.render()}
    </ToolPanel>
  );
  const aside =
    'sticky top-0 hidden max-h-dvh content-start gap-2 overflow-y-auto p-2 has-[[data-slot=tool-panel]]:grid';

  return (
    <DockContext.Provider value={dock}>
      <div
        data-slot="tool-dock"
        className={cn(
          'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start',
          className,
        )}
      >
        <aside
          aria-label="Pinned on the left"
          className={cn(aside, 'col-start-1 border-r border-border')}
          style={{ width: WIDTH }}
        >
          {at('left').map(panel)}
          <div ref={setLeft} className="contents" />
        </aside>
        <div className="col-start-2 min-w-0">
          {slot ? createPortal(launcher(true), slot) : launcher(false)}
          {children}
        </div>
        <aside
          aria-label="Pinned on the right"
          className={cn(aside, 'col-start-3 border-l border-border')}
          style={{ width: WIDTH }}
        >
          {at('right').map(panel)}
          <div ref={setRight} className="contents" />
        </aside>
        {at('float').map(panel)}
        <div ref={setFloat} className="contents" />
        <Sheet
          open={Boolean(sheet)}
          onOpenChange={(open) => !open && sheet && put(sheet.id, 'closed')}
        >
          <SheetContent
            onOpenChange={(open) => !open && sheet && put(sheet.id, 'closed')}
          >
            <SheetHeader
              title={sheet?.title ?? ''}
              actions={
                sheet && (
                  <WindowControls
                    title={sheet.title}
                    place="sheet"
                    dock={dock}
                    onPlace={(place) => put(sheet.id, place)}
                  />
                )
              }
            />
            <SheetBody className="grid content-start gap-3">
              {sheet?.render()}
            </SheetBody>
          </SheetContent>
        </Sheet>
      </div>
    </DockContext.Provider>
  );
}

/**
 * A sheet that can be kept open. It opens as an ordinary sheet; inside a
 * `ToolDock` it also offers Float, Pin left and Pin right, and opens next
 * time where it was last put. Without a dock around it, it is a plain
 * sheet.
 */
export function DockableSheet({
  id,
  title,
  description,
  closeLabel,
  returnFocus,
  renderSheet,
  icon,
  open,
  onOpenChange,
  footer,
  className,
  children,
}: {
  /** Names the panel, so its place is remembered: "block-controls", "scenes". */
  id: string;
  title: string;
  description?: React.ReactNode;
  closeLabel?: string;
  /** Launcher for a sheet opened by a button outside its dialog root. */
  returnFocus?: () => HTMLElement | null;
  /** An in-page sheet can keep its own collapse and focus behavior. */
  renderSheet?: (placement: React.ReactNode) => React.ReactNode;
  icon?: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  footer?: React.ReactNode;
  /** For the sheet form, such as a wider sheet. */
  className?: string;
  children: React.ReactNode;
}) {
  const dock = React.useContext(DockContext);
  const kept = dock?.preferredPlace(id) ?? 'sheet';
  const place: ToolPlace =
    !dock || !dock.tablet || kept === 'closed' || kept === 'sheet'
      ? 'sheet'
      : !dock.wide
        ? 'float'
        : kept;
  const slot = dock && place !== 'sheet' ? dock.slots[place as 'left'] : null;

  if (open && dock && place !== 'sheet')
    return slot
      ? createPortal(
          <ToolPanel
            id={id}
            title={title}
            icon={icon}
            place={place}
            dock={dock}
            footer={footer}
            onPlace={(next) =>
              next === 'closed' ? onOpenChange(false) : dock.put(id, next)
            }
          >
            {children}
          </ToolPanel>,
          slot,
        )
      : null;

  const placement = dock && (
    <WindowControls
      title={title}
      place="sheet"
      dock={dock}
      onPlace={(next) => dock.put(id, next)}
    />
  );
  if (renderSheet) return open ? renderSheet(placement) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        onOpenChange={onOpenChange}
        className={className}
        onCloseAutoFocus={(event) => {
          const launcher = returnFocus?.();
          if (launcher?.isConnected) {
            event.preventDefault();
            launcher.focus({ preventScroll: true });
          }
        }}
      >
        <SheetHeader
          title={title}
          description={description}
          closeLabel={closeLabel}
          actions={placement}
        />
        <SheetBody className="grid content-start gap-3">{children}</SheetBody>
        {footer && <SheetFooter>{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Where to keep a panel, as one small cluster of icons used in every form
 * (sheet header, floating panel, pinned panel): open as a sheet, float, pin
 * left, pin right. The form it is in now is pressed. Phones have sheets
 * only, so they show none of it.
 */
function WindowControls({
  title,
  place,
  dock,
  onPlace,
}: {
  title: string;
  place: ToolPlace;
  dock: Dock;
  onPlace: (place: ToolPlace) => void;
}) {
  if (!dock.tablet) return null;
  const control = (to: ToolPlace, label: string, icon: React.ReactNode) => (
    <Button
      size="icon-sm"
      variant="ghost"
      title={label}
      aria-label={`${label}: ${title}`}
      aria-pressed={place === to}
      onClick={() => place !== to && onPlace(to)}
    >
      {icon}
    </Button>
  );
  const fill = (to: ToolPlace) => (place === to ? 'fill' : 'regular');
  return (
    <div
      role="group"
      aria-label={`Where to keep ${title}`}
      data-slot="window-controls"
      className="flex items-center gap-0.5 [&_svg]:size-4"
    >
      {control('sheet', 'Open as a sheet', <ArrowsInSimple />)}
      {control('float', 'Float', <PictureInPicture weight={fill('float')} />)}
      {dock.wide && (
        <>
          {control('left', 'Pin left', <SidebarSimple weight={fill('left')} />)}
          {control(
            'right',
            'Pin right',
            <SidebarSimple weight={fill('right')} className="-scale-x-100" />,
          )}
        </>
      )}
    </div>
  );
}

function ToolPanel({
  id,
  title,
  icon,
  place,
  dock,
  onPlace,
  footer,
  children,
}: {
  id: string;
  title: string;
  icon?: React.ReactNode;
  place: ToolPlace;
  dock: Dock;
  onPlace: (place: ToolPlace) => void;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const float = place === 'float';
  const spot = dock.spotOf(id);
  const grab = React.useRef<{ x: number; y: number } | null>(null);
  const box = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    const element = box.current;
    if (!float || !element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!window.matchMedia?.(FLOAT_VIEWPORT).matches) return;
      const width = Math.round(element.offsetWidth);
      const height = Math.round(element.offsetHeight);
      if (width !== spot.width || height !== spot.height)
        dock.setSpot(id, { ...spot, width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [float, dock, id, spot]);

  const drag = {
    onPointerDown: (event: React.PointerEvent) => {
      if (!float || (event.target as HTMLElement).closest('button')) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      grab.current = { x: event.clientX - spot.x, y: event.clientY - spot.y };
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (!grab.current) return;
      const width = box.current?.offsetWidth ?? 0;
      dock.setSpot(id, {
        x: Math.min(
          Math.max(8, event.clientX - grab.current.x),
          window.innerWidth - width - 8,
        ),
        y: Math.min(
          Math.max(8, event.clientY - grab.current.y),
          window.innerHeight - 56,
        ),
      });
    },
    onPointerUp: () => {
      grab.current = null;
    },
  };
  return (
    <section
      ref={box}
      aria-label={`${title} tool`}
      data-slot="tool-panel"
      data-place={place}
      className={cn(
        'grid min-w-0 animate-arrive grid-cols-1 rounded-lg border border-border bg-card',
        float &&
          // Drag its corner to resize it, within sensible limits.
          'fixed z-popover max-h-[calc(100dvh-6rem)] min-h-40 max-w-[calc(100vw-1rem)] min-w-64 resize overflow-auto border-foreground/30 shadow-raised',
      )}
      style={
        float
          ? {
              left: spot.x,
              top: spot.y,
              width: spot.width ?? WIDTH,
              height: spot.height,
            }
          : undefined
      }
    >
      <header
        {...drag}
        className={cn(
          'sticky top-0 z-10 flex items-center gap-1 rounded-t-lg border-b border-border bg-card py-1 pr-1 pl-3 [&_svg]:size-4',
          float && 'cursor-grab touch-none select-none active:cursor-grabbing',
        )}
      >
        {icon && (
          <span aria-hidden="true" className="text-muted-foreground">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title}
        </span>
        <WindowControls
          title={title}
          place={place}
          dock={dock}
          onPlace={onPlace}
        />
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Close ${title}`}
          onClick={() => onPlace('closed')}
        >
          <X />
        </Button>
      </header>
      <div className="grid min-w-0 content-start gap-3 p-3">{children}</div>
      {footer && (
        <footer className="sticky bottom-0 flex flex-wrap gap-2 rounded-b-lg border-t border-border bg-card p-2">
          {footer}
        </footer>
      )}
    </section>
  );
}
