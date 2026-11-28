import {
  CornersOut,
  Crosshair,
  GitFork,
  ListBullets,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
  MapTrifold,
  Plus,
} from '@phosphor-icons/react';
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Led } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { List, ListRow } from '../components/ui/list-row';
import { Switch } from '../components/ui/switch';
import { Eyebrow } from '../components/ui/text';
import type { GlyphKey } from '../lib/block-glyphs';
import type { ChainCanvasControl } from '../lib/chain-canvas-control';
import {
  type ChainGraph,
  edgeMid,
  type GraphEdge,
  type GraphNode,
  layoutGraph,
  nearestEdge,
  nodeX,
  nodeY,
  pathEmptiedBy,
} from '../lib/chain-graph';
import { cn } from '../lib/cn';
import { useRemembered } from '../lib/use-remembered';
import { BlockGlyph } from './block-glyph';

/**
 * The signal chain drawn as a map. It fits and centres when it can; when the
 * chain is bigger than the space the player pans, zooms and uses a minimap.
 * Connections are faint dashed curves with arrows. A + on each connection
 * adds a block or a parallel path, and a block can be dragged onto another
 * connection. The widget draws and reports what the player did; the owner
 * applies it (the product through its route operations). Leave out the edit
 * callbacks and the chain is view-only.
 * @see docs/interface.md
 */

export type CanvasChoice = { glyph: GlyphKey; name: string };

type View = { x: number; y: number; s: number };
/** Height of the toolbar along the top of the drawing, with its margin. */
const TOOLBAR_H = 56;
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
/** Keep at least a little of the chain in view so it cannot be flung away. */
const keepInView = (v: View, w: number, h: number, cw: number, ch: number) => ({
  ...v,
  x: clamp(v.x, 120 - cw * v.s, w - 120),
  y: clamp(v.y, 120 - ch * v.s, h - 120),
});

type ListSection =
  | { kind: 'main'; nodes: GraphNode[] }
  | { kind: 'split'; lanes: { lane: number; nodes: GraphNode[] }[] };

/**
 * The blocks in signal order for the list view: runs of the main line, and
 * between them the parallel paths, each in its own order.
 */
function listSections(
  nodes: GraphNode[],
  col: Record<string, number>,
): ListSection[] {
  const sections: ListSection[] = [];
  const ordered = nodes
    .filter((n) => n.kind !== 'cap')
    .sort((a, b) => col[a.id]! - col[b.id]! || a.row - b.row);
  for (const n of ordered) {
    const last = sections.at(-1);
    if (n.lane === undefined) {
      if (last?.kind === 'main') last.nodes.push(n);
      else sections.push({ kind: 'main', nodes: [n] });
      continue;
    }
    const split =
      last?.kind === 'split'
        ? last
        : (sections[sections.push({ kind: 'split', lanes: [] }) - 1] as Extract<
            ListSection,
            { kind: 'split' }
          >);
    const path = split.lanes.find((l) => l.lane === n.lane);
    if (path) path.nodes.push(n);
    else split.lanes.push({ lane: n.lane, nodes: [n] });
  }
  for (const section of sections)
    if (section.kind === 'split') section.lanes.sort((a, b) => a.lane - b.lane);
  return sections;
}

function Choices({
  choices,
  onPick,
}: {
  choices: CanvasChoice[];
  onPick: (c: CanvasChoice) => void;
}) {
  const [q, setQ] = useState('');
  return (
    <div className="grid gap-2">
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search blocks"
        aria-label="Search blocks"
        className="rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none"
      />
      <div className="grid max-h-48 grid-cols-4 gap-1 overflow-y-auto">
        {choices
          .filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
          .map((c) => (
            <button
              key={c.name}
              onClick={() => onPick(c)}
              className="grid place-items-center gap-1 rounded-lg p-1.5 text-[11px] hover:bg-accent"
            >
              <BlockGlyph glyph={c.glyph} className="size-6" />
              {c.name}
            </button>
          ))}
      </div>
    </div>
  );
}

type Menu = { edge: GraphEdge; mode: 'menu' | 'insert' | 'branch' };

/** What a block card shows: its kind, values and state. */
export type CanvasCard = {
  /** The category or engine, in small caps. */
  caption?: string;
  /** One line of the main values, such as "380 ms · 35 %". */
  preview?: string;
  /** Colours the small light on the card. */
  kind?: 'amp' | 'cab' | 'pedal' | 'time' | 'mod' | 'lv2' | 'other';
  on?: boolean;
  /** Edited and not saved yet. */
  unsaved?: boolean;
  /** The playing scene changes this block. */
  sceneMark?: boolean;
};

export function ChainCanvas({
  graph,
  selected,
  onSelect,
  choices = [],
  onInsert,
  onBranch,
  onMove,
  muted = {},
  solo = {},
  onToggleMute,
  onToggleSolo,
  onPlus,
  plusLabel,
  laneLabel,
  tint,
  off,
  movable,
  onKeyMove,
  face,
  plusAllowed,
  plusAlways,
  card,
  disabled,
  readOnlyNote,
  toolbarExtra,
  toolbar = 'float',
  insetTop = 0,
  insetSide = 0,
  control,
  className,
}: {
  graph: ChainGraph;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Blocks that can be added on a connection. */
  choices?: CanvasChoice[];
  onInsert?: (edge: GraphEdge, choice: CanvasChoice) => void;
  onBranch?: (edge: GraphEdge, choice: CanvasChoice) => void;
  onMove?: (id: string, edge: GraphEdge) => void;
  /** Audition state per parallel path (not saved). */
  muted?: Record<number, boolean>;
  solo?: Record<number, boolean>;
  onToggleMute?: (lane: number) => void;
  onToggleSolo?: (lane: number) => void;
  /** Extra controls at the start of the toolbar, such as a switch of view. */
  toolbarExtra?: ReactNode;
  /** Said once when the chain cannot be edited here. */
  readOnlyNote?: string;
  /** Used instead of the built-in menu: the owner opens its own chooser for a connection. */
  onPlus?: (edge: GraphEdge) => void;
  /** Words for the + on a connection, for screen readers. */
  plusLabel?: (edge: GraphEdge) => string;
  /** Words above a parallel path, such as its level. */
  laneLabel?: (lane: number) => string;
  /** A colour for a block's outline, such as the sounding scene's. */
  tint?: (id: string) => string | undefined;
  /** A bypassed block is drawn faded. */
  off?: (id: string) => boolean;
  /** Which blocks can be dragged. */
  movable?: (id: string) => boolean;
  /** Alt and an arrow key: the keyboard path for dragging a block. */
  onKeyMove?: (id: string, key: 'left' | 'right' | 'up' | 'down') => void;
  /** What to draw inside a block's tile instead of its glyph, such as model artwork. */
  face?: (id: string) => ReactNode | undefined;
  /** Whether a connection can take a new block; no + without it. */
  plusAllowed?: (edge: GraphEdge) => boolean;
  /** Connections whose + stays when zoomed out, such as a path with nothing on it. */
  plusAlways?: (edge: GraphEdge) => boolean;
  /** What a block's card shows under its name; a block without one shows its name only. */
  card?: (id: string) => CanvasCard | undefined;
  /** Locked: draw and select, but no adding or moving. */
  disabled?: boolean;
  /**
   * `float` draws the map tools in the top corner and a hint at the bottom.
   * `none` leaves both out, for a chain bar that holds the tools instead.
   */
  toolbar?: 'float' | 'none';
  /** With `toolbar="none"`: room kept clear along the top when fitting, such as under a header. */
  insetTop?: number;
  /** With `toolbar="none"`: room kept clear at each side when fitting, such as for edge readouts. */
  insetSide?: number;
  /** Zoom, fit, centre, list, minimap and Follow driven from outside, such as by the chain bar. */
  control?: ChainCanvasControl;
  className?: string;
}) {
  const { nodes, edges } = graph;
  const lay = useMemo(() => layoutGraph(graph), [graph]);
  const editable = !disabled && !!(onInsert || onBranch || onMove || onPlus);
  const byId = (id: string) => nodes.find((n) => n.id === id)!;

  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: 0, y: 0, s: 1 });
  const [smooth, setSmooth] = useState(true);
  const [ownFollow, setOwnFollow] = useState(true);
  // The minimap is off until asked for; this browser remembers the choice.
  const [ownMinimap, setOwnMinimap] = useRemembered(
    'oxidal.canvas.minimap',
    false,
  );
  const [ownList, setOwnList] = useState(false);
  // A control from outside (the chain bar) holds these instead.
  const follow = control ? control.follow : ownFollow;
  const setFollow = control ? control.setFollow : setOwnFollow;
  const minimap = control ? control.minimap : ownMinimap;
  const setMinimap = control ? control.setMinimap : setOwnMinimap;
  const listView = control ? control.list : ownList;
  const setListView = control ? control.setList : setOwnList;
  const floating = toolbar === 'float';
  const [menu, setMenu] = useState<Menu | null>(null);
  const [moving, setMoving] = useState<{
    id: string;
    x: number;
    y: number;
    over: GraphEdge | null;
  } | null>(null);
  const didMove = useRef(false);
  const viewRef = useRef(view);
  const dims = useRef({ w: lay.w, h: lay.h });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);
  const pinch = useRef(0);
  useEffect(() => {
    viewRef.current = view;
    dims.current = { w: lay.w, h: lay.h };
  });

  // Fitting the whole chain can leave blocks too small to read on a narrow
  // screen. On opening (not when asked to fit) the chain then starts at a
  // readable size from its left end, and the player pans along it.
  const fit = useCallback(
    (w: number, h: number, whole = true) => {
      if (!w) return;
      const d = dims.current;
      // The toolbar sits along the top; the chain is centred in the space below it.
      const top = floating ? TOOLBAR_H : insetTop;
      const side = floating ? 0 : insetSide;
      const all = clamp(
        Math.min((w - 64 - 2 * side) / d.w, (h - top - 32) / d.h),
        0.3,
        1.5,
      );
      const s = whole ? all : Math.max(all, 0.6);
      setSmooth(true);
      setView({
        s,
        x: s > all ? 24 + side : (w - d.w * s) / 2,
        y: top + (h - top - d.h * s) / 2,
      });
    },
    [floating, insetTop, insetSide],
  );
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
      fit(r.width, r.height, false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const focus = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    setSmooth(true);
    setView((v) => {
      const s = Math.max(v.s, 0.9);
      return {
        s,
        x: size.w / 2 - nodeX(n, lay) * s,
        y: size.h / 2 - nodeY(n) * s,
      };
    });
  };
  const pick = (id: string) => {
    setMenu(null);
    onSelect(id);
    if (follow) focus(id);
  };
  const zoomAt = (cx: number, cy: number, f: number, animate = false) => {
    setSmooth(animate);
    setView((v) => {
      const s = clamp(v.s * f, 0.3, 1.6);
      return {
        s,
        x: cx - (cx - v.x) * (s / v.s),
        y: cy - (cy - v.y) * (s / v.s),
      };
    });
  };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey)
        zoomAt(
          e.clientX - r.left,
          e.clientY - r.top,
          Math.exp(-e.deltaY * 0.01),
        );
      else {
        setSmooth(false);
        setView((v) =>
          keepInView(
            { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY },
            r.width,
            r.height,
            dims.current.w,
            dims.current.h,
          ),
        );
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [listView]);

  // A control from outside reads the zoom and calls the same commands as the
  // floating toolbar's buttons.
  const zoom = view.s;
  useEffect(() => {
    control?.reportZoom(zoom);
  }, [control, zoom]);
  // The highest thing drawn: a block's top edge, or the label above a path.
  const highest = Math.min(
    ...nodes.map((n) => nodeY(n) - (n.lane !== undefined ? 70 : 30)),
  );
  const drawingTop = Math.round(view.y + highest * view.s);
  useEffect(() => {
    control?.reportTop(drawingTop);
  }, [control, drawingTop]);
  useEffect(() => {
    if (!control) return;
    control.attach({
      zoomIn: () => zoomAt(size.w / 2, size.h / 2, 1.25, true),
      zoomOut: () => zoomAt(size.w / 2, size.h / 2, 0.8, true),
      fit: () => fit(size.w, size.h),
      centre: () => {
        if (selected) focus(selected);
      },
      panBy: (dx, dy) => {
        setSmooth(true);
        setView((v) =>
          keepInView(
            { ...v, x: v.x + dx, y: v.y + dy },
            size.w,
            size.h,
            lay.w,
            lay.h,
          ),
        );
      },
    });
    return () => control.attach(null);
  });

  const step = (dir: 'left' | 'right' | 'up' | 'down') => {
    const cur =
      nodes.find((n) => n.id === selected) ??
      nodes.find((n) => n.kind === 'block');
    if (!cur) return;
    let next: GraphNode | undefined;
    if (dir === 'right')
      next = nodes.find(
        (n) => n.id === edges.find((e) => e[0] === cur.id)?.[1],
      );
    if (dir === 'left')
      next = nodes.find(
        (n) => n.id === edges.find((e) => e[1] === cur.id)?.[0],
      );
    if (dir === 'up' || dir === 'down') {
      const same = nodes
        .filter((n) => lay.col[n.id] === lay.col[cur.id] && n.kind === 'block')
        .sort((a, b) => a.row - b.row);
      const i = same.findIndex((n) => n.id === cur.id);
      next = same[dir === 'up' ? i - 1 : i + 1];
    }
    if (next?.kind === 'block') pick(next.id);
  };

  const toContent = (cx: number, cy: number) => {
    const rect = box.current?.getBoundingClientRect();
    const v = viewRef.current;
    return rect
      ? { x: (cx - rect.left - v.x) / v.s, y: (cy - rect.top - v.y) / v.s }
      : { x: 0, y: 0 };
  };
  const startMove = (e: ReactPointerEvent, n: GraphNode) => {
    if (
      !onMove ||
      disabled ||
      n.kind !== 'block' ||
      e.button !== 0 ||
      (movable && !movable(n.id))
    )
      return;
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    let active = false;
    const over = (x: number, y: number) =>
      nearestEdge(graph, lay, toContent(x, y), n.id);
    const mv = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) {
        active = true;
        didMove.current = true;
        setMenu(null);
      }
      if (active)
        setMoving({
          id: n.id,
          x: ev.clientX,
          y: ev.clientY,
          over: over(ev.clientX, ev.clientY),
        });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv);
      if (!active) return;
      const target = over(ev.clientX, ev.clientY);
      setMoving(null);
      if (target) {
        onMove(n.id, target);
        if (follow) setTimeout(() => focus(n.id), 0);
      }
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up, { once: true });
  };

  // A block moved by its buttons or keys, or by an edit elsewhere, can leave
  // the visible part of the map; Follow brings it back into view.
  const selectedAt = (() => {
    const n = nodes.find((x) => x.id === selected);
    return n ? `${nodeX(n, lay)},${nodeY(n)}` : '';
  })();
  const lastAt = useRef(selectedAt);
  const followMoved = useEffectEvent((before: string) => {
    if (follow && selected && before && selectedAt && before !== selectedAt)
      focus(selected);
  });
  useEffect(() => {
    const before = lastAt.current;
    lastAt.current = selectedAt;
    followMoved(before);
  }, [selectedAt]);

  const far = view.s < 0.55;
  const mini = 200 / lay.w;
  const lanes = Array.from(
    new Set(nodes.filter((n) => n.lane !== undefined).map((n) => n.lane!)),
  ).sort((a, b) => a - b);
  const anySolo = Object.values(solo).some(Boolean);
  const dim = (n: GraphNode) =>
    n.lane !== undefined && (muted[n.lane] || (anySolo && !solo[n.lane]));
  const overflow = lay.w * view.s > size.w || lay.h * view.s > size.h;

  // One row of the list: a block as the map's card shows it, or a free slot.
  const row = (n: GraphNode) => {
    if (n.kind === 'slot')
      return (
        <ListRow
          key={n.id}
          leading={
            <span className="grid size-9 place-items-center rounded-full border border-dashed border-wire text-muted-foreground">
              <Plus className="size-3.5" aria-hidden="true" />
            </span>
          }
          title="Add a block here"
          caption={n.name !== 'Add a block here' ? n.name : undefined}
          onClick={() => onSelect(n.id)}
        />
      );
    const info = card?.(n.id);
    const on = info?.on ?? true;
    return (
      <ListRow
        key={n.id}
        selected={selected === n.id}
        className={cn(!on && 'opacity-60')}
        leading={
          <span className="grid size-9 place-items-center rounded-md border border-border bg-muted text-foreground">
            {n.glyph && <BlockGlyph glyph={n.glyph} className="size-4" />}
          </span>
        }
        title={n.name}
        caption={
          [info?.caption, info?.preview, !on && 'Off']
            .filter(Boolean)
            .join(' · ') || undefined
        }
        onClick={() => onSelect(n.id)}
      />
    );
  };

  if (listView)
    return (
      // The list keeps clear of what sits over the map (a header along the
      // top, meters down the sides), as the map does when it fits.
      <div
        className={cn('relative h-full overflow-y-auto p-4', className)}
        style={
          floating
            ? undefined
            : {
                paddingTop: Math.max(16, insetTop),
                paddingLeft: Math.max(16, insetSide),
                paddingRight: Math.max(16, insetSide),
              }
        }
      >
        <div className="mx-auto max-w-3xl">
          <div className="mb-3 flex items-center justify-between">
            <Eyebrow>Signal chain as a list</Eyebrow>
            {/* With the chain bar in charge, its own list button goes back. */}
            {floating && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setListView(false)}
              >
                Show the map
              </Button>
            )}
          </div>
          {/* The chain in signal order: the main line's blocks, each
              parallel path under its name, then what follows the join. */}
          <div className="grid gap-4">
            {listSections(nodes, lay.col).map((section, i) =>
              section.kind === 'main' ? (
                <List
                  key={i}
                  aria-label={i ? 'After the paths join' : 'Main line'}
                >
                  {section.nodes.map(row)}
                </List>
              ) : (
                <section
                  key={i}
                  aria-label={`Split into ${section.lanes.length} paths`}
                  className="grid gap-3"
                >
                  <Eyebrow>
                    Split into {section.lanes.length} paths, joined after
                  </Eyebrow>
                  {section.lanes.map(({ lane, nodes: path }) => (
                    <div
                      key={lane}
                      className="grid gap-1 border-l border-dashed border-wire pl-3"
                    >
                      <span className="font-mono text-2xs font-medium text-muted-foreground">
                        {laneLabel ? laneLabel(lane) : `Path ${lane + 1}`}
                      </span>
                      <List
                        aria-label={
                          laneLabel ? laneLabel(lane) : `Path ${lane + 1}`
                        }
                      >
                        {path.map(row)}
                      </List>
                    </div>
                  ))}
                </section>
              ),
            )}
          </div>
        </div>
      </div>
    );

  return (
    <div
      ref={box}
      tabIndex={0}
      role="application"
      aria-label="Signal chain. Drag to pan, pinch or press plus and minus to zoom, arrow keys to move between blocks."
      className={cn(
        'relative h-full min-h-0 cursor-grab touch-none overflow-clip outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing',
        className,
      )}
      onKeyDown={(e) => {
        const m: Record<string, () => void> = {
          ArrowRight: () => step('right'),
          ArrowLeft: () => step('left'),
          ArrowUp: () => step('up'),
          ArrowDown: () => step('down'),
          '+': () => zoomAt(size.w / 2, size.h / 2, 1.25, true),
          '-': () => zoomAt(size.w / 2, size.h / 2, 0.8, true),
          '0': () => fit(size.w, size.h),
          Escape: () => setMenu(null),
        };
        const f = m[e.key];
        if (f) {
          e.preventDefault();
          f();
        }
      }}
      onPointerDown={(e) => {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          vx: view.x,
          vy: view.y,
          moved: false,
        };
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        }
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          const rect = box.current!.getBoundingClientRect();
          if (pinch.current)
            zoomAt(
              (a!.x + b!.x) / 2 - rect.left,
              (a!.y + b!.y) / 2 - rect.top,
              d / pinch.current,
            );
          pinch.current = d;
          if (drag.current) drag.current.moved = true;
          return;
        }
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) > 4) {
          d.moved = true;
          box.current?.setPointerCapture(e.pointerId);
        }
        if (d.moved) {
          setSmooth(false);
          setView((v) =>
            keepInView(
              { ...v, x: d.vx + dx, y: d.vy + dy },
              size.w,
              size.h,
              lay.w,
              lay.h,
            ),
          );
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = 0;
      }}
      onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
      onClickCapture={(e) => {
        if (drag.current?.moved) {
          e.stopPropagation();
          drag.current.moved = false;
        }
      }}
    >
      <div
        className={cn(
          'absolute top-0 left-0 origin-top-left',
          smooth &&
            'transition-transform duration-300 ease-out motion-reduce:transition-none',
        )}
        style={{
          width: lay.w,
          height: lay.h,
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
        }}
      >
        <svg
          className="absolute inset-0"
          width={lay.w}
          height={lay.h}
          aria-hidden
        >
          <defs>
            {[
              ['arrow', 'var(--color-muted-foreground)'],
              ['arrowHi', 'var(--color-foreground)'],
            ].map(([id, c]) => (
              <marker
                key={id}
                id={`chain-${id}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="9"
                markerHeight="9"
                markerUnits="userSpaceOnUse"
                orient="auto"
              >
                <path
                  d="M1.5 1.5 L8.5 5 L1.5 8.5"
                  fill="none"
                  stroke={c}
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </marker>
            ))}
          </defs>
          {edges.map(([a, b]) => {
            const p = byId(a);
            const q = byId(b);
            const { x1, x2 } = edgeMid(p, q, lay);
            const mx = (x1 + x2) / 2;
            const hi = selected === a || selected === b;
            const faded = dim(p) || dim(q) || !lay.reach.has(a);
            return (
              <path
                key={`${a}-${b}`}
                d={`M ${x1} ${nodeY(p)} C ${mx} ${nodeY(p)}, ${mx} ${nodeY(q)}, ${x2} ${nodeY(q)}`}
                fill="none"
                strokeWidth={hi ? 1.75 : 1.25}
                strokeDasharray="5 5"
                markerEnd={`url(#chain-${hi ? 'arrowHi' : 'arrow'})`}
                style={{
                  stroke: hi
                    ? 'var(--color-foreground)'
                    : 'var(--color-muted-foreground)',
                  opacity: faded ? 0.2 : hi ? 0.85 : 0.5,
                }}
              />
            );
          })}
        </svg>

        {editable &&
          edges.map(([a, b]) => {
            if (far && !moving && !plusAlways?.([a, b])) return null;
            const p = byId(a);
            const q = byId(b);
            const { x, y } = edgeMid(p, q, lay);
            const open = menu?.edge[0] === a && menu.edge[1] === b;
            const target = moving?.over?.[0] === a && moving.over[1] === b;
            return (
              <div
                key={`+${a}-${b}`}
                className="absolute z-10"
                style={{ left: x, top: y }}
              >
                {(onInsert || onBranch || onPlus) &&
                  (plusAllowed?.([a, b]) ?? true) && (
                    <button
                      aria-label={
                        plusLabel?.([a, b]) ??
                        `Add a block between ${p.name} and ${q.name}`
                      }
                      onClick={() =>
                        onPlus
                          ? onPlus([a, b])
                          : setMenu(
                              open ? null : { edge: [a, b], mode: 'menu' },
                            )
                      }
                      className={cn(
                        'absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-dashed border-border bg-background text-muted-foreground transition-opacity hover:border-foreground hover:text-foreground focus-visible:opacity-100',
                        target
                          ? 'scale-150 border-brand bg-brand/15 text-foreground opacity-100'
                          : moving
                            ? 'opacity-90'
                            : open
                              ? 'opacity-100'
                              : 'opacity-50 hover:opacity-100',
                      )}
                    >
                      <Plus className="size-3" />
                    </button>
                  )}
                {!(onInsert || onBranch || onPlus) && moving && (
                  <span
                    className={cn(
                      'absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed',
                      target
                        ? 'scale-150 border-brand bg-brand/15'
                        : 'border-border',
                    )}
                  />
                )}
                {open && menu && (
                  <div
                    role="dialog"
                    aria-label="On this connection"
                    className="shadow-xl absolute top-4 left-0 z-30 w-64 origin-top-left rounded-xl border border-border bg-popover p-2 text-popover-foreground"
                    style={{ transform: `scale(${1 / view.s})` }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    {menu.mode === 'menu' ? (
                      <div className="grid gap-0.5 text-sm">
                        <Eyebrow className="px-2 py-1">
                          {p.name} → {q.name}
                        </Eyebrow>
                        {onInsert && (
                          <button
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent"
                            onClick={() =>
                              setMenu({ edge: [a, b], mode: 'insert' })
                            }
                          >
                            <Plus className="size-4" /> Add a block here
                          </button>
                        )}
                        {onBranch && (
                          <button
                            className="flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent"
                            onClick={() =>
                              setMenu({ edge: [a, b], mode: 'branch' })
                            }
                          >
                            <GitFork className="size-4" /> Branch a parallel
                            path here
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        <Eyebrow className="px-1">
                          {menu.mode === 'insert'
                            ? 'Add a block between'
                            : 'New parallel path with'}{' '}
                          {p.name} and {q.name}
                        </Eyebrow>
                        <Choices
                          choices={choices}
                          onPick={(c) => {
                            (menu.mode === 'insert' ? onInsert : onBranch)?.(
                              [a, b],
                              c,
                            );
                            setMenu(null);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

        {lanes.map((l) => {
          const laneNodes = nodes.filter((n) => n.lane === l);
          const first = laneNodes.reduce((m, n) =>
            lay.col[n.id]! < lay.col[m.id]! ? n : m,
          );
          return (
            <div
              key={l}
              className={cn(
                'shadow-sm absolute flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[11px]',
                far && 'opacity-0',
              )}
              style={{
                left: nodeX(first, lay) - 60,
                top: nodeY(first) - 66,
              }}
            >
              <span className="font-semibold">
                {laneLabel ? laneLabel(l) : `Path ${l + 1}`}
              </span>
              {onToggleSolo && (
                <button
                  aria-pressed={!!solo[l]}
                  aria-label={`Solo path ${l + 1}`}
                  onClick={() => onToggleSolo(l)}
                  className={cn(
                    'rounded px-1 font-mono font-bold',
                    solo[l]
                      ? 'bg-brand text-brand-foreground'
                      : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  S
                </button>
              )}
              {onToggleMute && (
                <button
                  aria-pressed={!!muted[l]}
                  aria-label={`Mute path ${l + 1}`}
                  onClick={() => onToggleMute(l)}
                  className={cn(
                    'rounded px-1 font-mono font-bold',
                    muted[l]
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-accent',
                  )}
                >
                  M
                </button>
              )}
            </div>
          );
        })}

        {nodes.map((n) => {
          const sel = selected === n.id;
          const cap = n.kind === 'cap';
          // A free slot is round like a joint, but it can be pressed.
          const slot = n.kind === 'slot';
          const round = cap || slot;
          const info = round ? undefined : card?.(n.id);
          const on = info?.on ?? true;
          const mark = !cap && tint?.(n.id);
          return (
            <div
              key={n.id}
              className={cn(
                'absolute -translate-x-1/2 -translate-y-1/2',
                round ? 'size-10' : 'h-14 w-[168px]',
                (dim(n) || off?.(n.id) || moving?.id === n.id) && 'opacity-30',
              )}
              style={{ left: nodeX(n, lay), top: nodeY(n) }}
            >
              <button
                onPointerDown={(e) => startMove(e, n)}
                onKeyDown={(e) => {
                  if (!onKeyMove || disabled || !e.altKey) return;
                  const key = (
                    {
                      ArrowLeft: 'left',
                      ArrowRight: 'right',
                      ArrowUp: 'up',
                      ArrowDown: 'down',
                    } as const
                  )[e.key as 'ArrowLeft'];
                  if (!key) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onKeyMove(n.id, key);
                }}
                style={
                  mark
                    ? {
                        borderColor: mark,
                        backgroundColor: sel
                          ? undefined
                          : `color-mix(in oklab, ${mark} 12%, var(--color-card))`,
                      }
                    : undefined
                }
                onClick={() => {
                  if (didMove.current) {
                    didMove.current = false;
                    return;
                  }
                  if (!cap) pick(n.id);
                }}
                aria-pressed={sel}
                aria-label={
                  round
                    ? n.name
                    : [
                        n.name,
                        info?.caption,
                        info?.preview,
                        !on && 'Off',
                        on && info?.unsaved && 'Unsaved',
                        info?.sceneMark && 'changed by this scene',
                      ]
                        .filter(Boolean)
                        .join(' ')
                }
                className={cn(
                  'relative size-full outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  slot
                    ? 'grid place-items-center rounded-full border-2 border-dashed border-input bg-background text-muted-foreground hover:border-foreground hover:text-foreground'
                    : cap
                      ? 'grid place-items-center rounded-full border-2 border-foreground bg-background font-mono text-[11px] font-bold'
                      : cn(
                          'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-pad border px-2.5 text-left transition-[background-color,box-shadow] duration-[var(--duration-fast)]',
                          sel
                            ? 'border-foreground bg-foreground text-background shadow-raised'
                            : 'border-input bg-card hover:bg-accent',
                          !on && 'border-dashed',
                          // Selected keeps its light ink on the dark card.
                          !on && !sel && 'text-muted-foreground',
                        ),
                )}
              >
                {slot ? (
                  <Plus aria-hidden="true" className="size-4" />
                ) : cap ? (
                  n.name
                ) : (
                  <>
                    <span
                      aria-hidden="true"
                      className={cn(
                        'relative grid size-9 place-items-center rounded-lg border [&_img]:size-full [&_img]:rounded-md [&_img]:object-cover [&_svg]:size-5',
                        sel
                          ? 'border-background/40 bg-background/10'
                          : 'border-border bg-background',
                        !on && 'border-dashed [&_svg]:opacity-60',
                      )}
                    >
                      {face?.(n.id) ?? (
                        <BlockGlyph glyph={n.glyph!} className="size-5" />
                      )}
                      <Led
                        kind={
                          !info?.kind || info.kind === 'other'
                            ? info
                              ? 'lv2'
                              : 'amp'
                            : info.kind
                        }
                        on={on}
                        className={cn(
                          'absolute -top-1 -right-1 size-2.5',
                          sel && 'border-background',
                        )}
                      />
                    </span>
                    <span className="grid min-w-0">
                      <span className="truncate text-sm font-semibold">
                        {n.name}
                      </span>
                      {/* Spaces between the lines (a grid draws none) keep the
                          visible words matching the block's spoken name. */}
                      {info?.caption && ' '}
                      {info?.caption && (
                        <span
                          className={cn(
                            'truncate small-caps text-xs',
                            sel
                              ? 'text-background/70'
                              : 'text-muted-foreground',
                          )}
                        >
                          {info.caption}
                        </span>
                      )}
                      {info?.preview && ' '}
                      {info?.preview && (
                        <span
                          className={cn(
                            'truncate font-mono text-xs tabular-nums',
                            sel ? 'text-background/80' : 'text-foreground/80',
                          )}
                        >
                          {info.preview}
                        </span>
                      )}
                    </span>
                    {(!on || info?.unsaved) && ' '}
                    {(!on || info?.unsaved) && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute -top-2 right-2 rounded-full border px-1.5 small-caps text-2xs leading-4 font-medium',
                          sel
                            ? 'border-background/60 bg-foreground text-background'
                            : !on
                              ? 'border-border bg-background text-muted-foreground'
                              : 'border-brand bg-background text-foreground',
                        )}
                      >
                        {!on ? 'Off' : 'Unsaved'}
                      </span>
                    )}
                    {info?.sceneMark && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute bottom-1 left-1 size-1.5 rotate-45',
                          sel ? 'bg-background' : 'bg-foreground',
                        )}
                      />
                    )}
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>

      {moving &&
        (() => {
          const n = byId(moving.id);
          const over = moving.over;
          const emptied = pathEmptiedBy(graph, n.id);
          return (
            <div
              className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-1/2"
              style={{ left: moving.x, top: moving.y }}
            >
              <span className="shadow-xl mx-auto grid size-16 place-items-center rounded-xl border-2 border-foreground bg-card opacity-90">
                <BlockGlyph glyph={n.glyph!} className="size-8" />
              </span>
              <span
                role="status"
                className="shadow-lg absolute top-full left-1/2 mt-2 w-60 -translate-x-1/2 rounded-lg border border-border bg-popover px-3 py-2 text-center text-xs"
              >
                {over ? (
                  <>
                    Move <strong>{n.name}</strong> between{' '}
                    <strong>{byId(over[0]).name}</strong> and{' '}
                    <strong>{byId(over[1]).name}</strong>
                    {emptied !== null && (
                      <span className="mt-1 block text-muted-foreground">
                        Path {emptied + 1} will have no blocks, so it becomes a
                        dry path.
                      </span>
                    )}
                  </>
                ) : (
                  'Drop on a connection to move it. Drop anywhere else to cancel.'
                )}
              </span>
            </div>
          );
        })()}

      {floating && (
        <div
          className="shadow-md absolute top-3 right-3 flex max-w-[calc(100%-1.5rem)] items-center gap-1 rounded-lg border border-border bg-popover p-1"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon-sm"
            className="max-sm:hidden"
            aria-label="Zoom out"
            onClick={() => zoomAt(size.w / 2, size.h / 2, 0.8, true)}
          >
            <MagnifyingGlassMinus />
          </Button>
          <span className="w-11 text-center font-mono text-xs max-sm:hidden">
            {Math.round(view.s * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="max-sm:hidden"
            aria-label="Zoom in"
            onClick={() => zoomAt(size.w / 2, size.h / 2, 1.25, true)}
          >
            <MagnifyingGlassPlus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Fit the whole chain"
            onClick={() => fit(size.w, size.h)}
          >
            <CornersOut />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Centre on the selected block"
            disabled={!selected}
            onClick={() => selected && focus(selected)}
          >
            <Crosshair />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Show the chain as a list"
            onClick={() => setListView(true)}
          >
            <ListBullets />
          </Button>
          {toolbarExtra}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Minimap"
            aria-pressed={minimap}
            title={minimap ? 'Hide the minimap' : 'Show the minimap'}
            className={cn('max-sm:hidden', minimap && 'bg-accent')}
            onClick={() => setMinimap(!minimap)}
          >
            <MapTrifold />
          </Button>
          <label className="flex items-center gap-1.5 pr-2 pl-1 text-xs">
            <span className="max-sm:sr-only">Follow</span>
            <Switch
              checked={follow}
              onCheckedChange={setFollow}
              aria-label="Follow the selected block"
            />
          </label>
        </div>
      )}
      {floating && (
        <p className="rounded pointer-events-none absolute bottom-3 left-4 max-w-[60%] bg-background/80 px-2 py-1 text-xs text-muted-foreground max-sm:hidden">
          {editable
            ? 'Drag to pan · pinch or ⌘-scroll to zoom · arrow keys move along the chain · + on a line adds a block · drag a block onto a line to move it'
            : (readOnlyNote ??
              'Drag to pan · pinch or ⌘-scroll to zoom · arrow keys move along the chain')}
        </p>
      )}
      {overflow && minimap && (
        <div
          role="group"
          aria-label="Chain overview map"
          className="shadow-md absolute right-3 bottom-3 overflow-hidden rounded-lg border border-border bg-popover/90"
          style={{ width: 200, height: lay.h * mini }}
          onPointerDown={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            const cx = (e.clientX - rect.left) / mini;
            const cy = (e.clientY - rect.top) / mini;
            setSmooth(true);
            setView((v) => ({
              ...v,
              x: size.w / 2 - cx * v.s,
              y: size.h / 2 - cy * v.s,
            }));
          }}
        >
          {nodes.map((n) => (
            <span
              key={n.id}
              className={cn(
                'absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-sm',
                selected === n.id ? 'bg-brand' : 'bg-foreground/60',
              )}
              style={{ left: nodeX(n, lay) * mini, top: nodeY(n) * mini }}
            />
          ))}
          <span
            className="absolute border border-brand bg-brand/10"
            style={{
              left: (-view.x / view.s) * mini,
              top: (-view.y / view.s) * mini,
              width: (size.w / view.s) * mini,
              height: (size.h / view.s) * mini,
            }}
          />
        </div>
      )}
    </div>
  );
}
