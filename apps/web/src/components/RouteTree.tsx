import { Plus } from '@phosphor-icons/react';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Caption } from '@oxidal/design-system/components/text';
import { useFlip } from '@oxidal/design-system/lib/use-flip';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';
import { ChainPort } from '@oxidal/design-system/widgets/chain';
import { SilentBranchesToggle } from '@oxidal/design-system/widgets/silent-branches-toggle';

import { RigTile, SlotTile } from '../ChainView';
import { panLabel } from '../lib/panLabel';
import type { IdStep, RigBlockVM } from '../rigChain';
import { pathMix, type RouteAt } from '../rigRoute';

/**
 * A connection between two parts of the chain: a dashed line ending in an
 * arrow at the part it feeds, as the chain map draws it. Running down a
 * phone the line and its arrow point down.
 */
const LINK = [
  'group/gap relative grid min-h-touch w-11 shrink-0 place-items-center',
  'before:absolute before:inset-x-0 before:top-1/2 before:h-0 before:border-t before:border-dashed before:border-wire',
  'after:absolute after:top-1/2 after:right-0 after:-translate-y-1/2 after:border-y-4 after:border-l-[6px] after:border-y-transparent after:border-l-wire',
  'group-data-[orientation=vertical]/route:min-h-5 group-data-[orientation=vertical]/route:w-13 group-data-[orientation=vertical]/route:has-[button]:min-h-touch',
  'group-data-[orientation=vertical]/route:before:inset-x-auto group-data-[orientation=vertical]/route:before:inset-y-0 group-data-[orientation=vertical]/route:before:h-auto group-data-[orientation=vertical]/route:before:left-1/2 group-data-[orientation=vertical]/route:before:border-t-0 group-data-[orientation=vertical]/route:before:border-l',
  'group-data-[orientation=vertical]/route:after:top-auto group-data-[orientation=vertical]/route:after:right-auto group-data-[orientation=vertical]/route:after:bottom-0 group-data-[orientation=vertical]/route:after:left-1/2 group-data-[orientation=vertical]/route:after:-translate-x-1/2 group-data-[orientation=vertical]/route:after:translate-y-0 group-data-[orientation=vertical]/route:after:rotate-90',
].join(' ');

/**
 * Where the split and join bars start and end: from the line of the first
 * path to the line of the last, so neither bar runs past them.
 */
function useBus(frame: RefObject<HTMLDivElement | null>, key: string) {
  const [bus, setBus] = useState<{ top: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = () => {
      const lines = el.querySelectorAll<HTMLElement>(
        ':scope > .route-path > [data-line]',
      );
      const first = lines[0];
      const last = lines[lines.length - 1];
      if (!first || !last) return setBus(null);
      const top = first.offsetTop + first.offsetHeight / 2;
      const bottom = last.offsetTop + last.offsetHeight / 2;
      setBus((old) =>
        old && old.top === top && old.height === bottom - top
          ? old
          : { top, height: bottom - top },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [frame, key]);
  return bus;
}

type Split = Exclude<IdStep, string>;
/** A key that moves the focused block: Alt+arrow, the keyboard drag. */
export type MoveKey = 'left' | 'right' | 'up' | 'down';

/** Scene lanes: the split whose paths are the scenes, named and lit. */
export type SceneLanes = {
  split: string;
  names: string[];
  /** The path that sounds now, if one does. */
  sounding: number | null;
  /** Confirmed branch readback in route order. Unknown branches stay visible. */
  enabled?: (boolean | undefined)[];
};

export type RouteTreeProps = Props;

type Props = {
  route: IdStep[];
  /** The tiles one block draws (a TONE3000 block may draw several). */
  tiles: (id: string) => RigBlockVM[];
  selected?: string;
  onSelect: (tile: string) => void;
  /** An empty slot inside a TONE3000 block was tapped. */
  onSlot?: (tile: string) => void;
  scenes?: SceneLanes | null;
  /** Whether a block can go at a gap; no gaps without it. */
  gaps?: (at: RouteAt) => boolean;
  /** The + at a gap: add an effect or split there. */
  onGap?: (at: RouteAt) => void;
  /** "+ Add effect" on a path: add an effect at its end. */
  onAdd?: (at: RouteAt) => void;
  /** Blocks (by block id) that can be dragged and moved by key. */
  movable?: (id: string) => boolean;
  onMove?: (id: string, at: RouteAt) => void;
  /**
   * Add a block just before this tile, inside its TONE3000 chain, using one
   * of the chain's free positions.
   */
  onAddBefore?: (tile: string) => void;
  onKey?: (id: string, key: MoveKey) => void;
  disabled?: boolean;
  /** E-paper: the chain as a numbered list, buttons only. */
  list?: boolean;
  /** Paths folded from a graph for drawing only: their levels are not known. */
  plain?: boolean;
  label?: string;
  /** The switch of chain view, drawn in the top corner. */
  toolbarExtra?: ReactNode;
};

/**
 * The rig canvas: one renderer for a straight chain, any routing tree
 * and scene lanes. Blocks sit on a wire with a + in every gap; a split stacks
 * its paths, each captioned with its level and pan; an empty path says
 * "+ Add effect". Blocks drag to any gap, within or across paths, and Alt+arrow
 * keys do the same without a pointer. E-paper reads it as a numbered list with
 * path labels and buttons only.
 * @see docs/interface.md
 */
export function RouteTree(props: Props) {
  const { route, list, label = 'Signal chain' } = props;
  const root = useRef<HTMLDivElement>(null);
  const vertical = useVerticalRig();
  const scroller = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<boolean | null>(null);
  useFlip(scroller, JSON.stringify(route, ['split', 'branches']));
  const drag = useGapDrag(
    root,
    props.disabled || list ? undefined : props.onMove,
  );
  if (list)
    return (
      <div
        className="route-canvas group/route min-w-0 data-dragging:select-none"
        role="group"
        aria-label={label}
      >
        <ol
          className="m-0 grid list-decimal gap-1.5 pl-6 [&_li]:leading-relaxed [&_ol]:mt-1 [&_ol]:grid [&_ol]:list-decimal [&_ol]:gap-1.5 [&_ol]:pl-6"
          aria-label="Chain as a list"
        >
          <ListSteps {...props} steps={route} />
          {props.onGap && props.gaps?.(top(route.length)) && (
            <li>
              <Button
                variant="outline"
                disabled={props.disabled}
                onClick={() => props.onGap!(top(route.length))}
              >
                + Add effect at the end
              </Button>
            </li>
          )}
        </ol>
      </div>
    );
  return (
    <div
      ref={root}
      className="route-canvas group/route relative min-w-0 data-dragging:select-none"
      data-orientation={vertical ? 'vertical' : 'horizontal'}
      role="group"
      aria-label={label}
      data-dragging={drag.active || undefined}
    >
      {props.toolbarExtra && (
        <div className="shadow-md absolute top-0 right-0 z-10 rounded-lg border border-border bg-popover p-1">
          {props.toolbarExtra}
        </div>
      )}
      <div
        ref={scroller}
        className="overflow-x-auto pt-1 pb-2 group-data-[orientation=vertical]/route:overflow-visible"
        role="region"
        aria-label={
          vertical ? 'Chain, input to output' : 'Chain, scrolls sideways'
        }
        tabIndex={vertical ? undefined : 0}
      >
        <div className="flex w-max shrink-0 items-center group-data-[orientation=vertical]/route:w-full group-data-[orientation=vertical]/route:min-w-0 group-data-[orientation=vertical]/route:flex-col group-data-[orientation=vertical]/route:items-stretch">
          <ChainPort
            className="group-data-[orientation=vertical]/route:ml-3 group-data-[orientation=vertical]/route:self-start"
            label="IN"
          />
          <RowSteps
            {...props}
            drag={drag}
            steps={route}
            owner={null}
            silentExpanded={expanded ?? !vertical}
            onToggleSilent={() => setExpanded(!(expanded ?? !vertical))}
          />
          <ChainPort
            className="group-data-[orientation=vertical]/route:ml-3 group-data-[orientation=vertical]/route:self-start"
            label="OUT"
          />
        </div>
      </div>
    </div>
  );
}

const top = (index: number): RouteAt => ({ split: null, path: 0, index });
const gapKey = (at: RouteAt) => `${at.split ?? ''}|${at.path}|${at.index}`;
function parseGap(key: string): RouteAt {
  const [split, path, index] = key.split('|');
  return { split: split || null, path: Number(path), index: Number(index) };
}
/** Path 1 · 100% · Centre, from the split's merge gains. */
function caption(split: Split, path: number) {
  // A stereo TONE3000 chain's two lanes.
  if (split.split.endsWith('~stereo')) return path === 0 ? 'Left' : 'Right';
  const mix = pathMix(split.gains[path] ?? 1, split.rightGains?.[path]);
  return [
    `Path ${path + 1}`,
    `${Math.round(mix.level * 100)}%`,
    panLabel(mix.pan),
    ...(mix.invert ? ['inverted'] : []),
  ].join(' · ');
}
const describe = (at: RouteAt, owner: string | null) =>
  owner
    ? `Add or split on ${owner} at position ${at.index + 1}`
    : `Add or split at position ${at.index + 1}`;

type Drag = ReturnType<typeof useGapDrag>;
type Owner = { split: Split; path: number; name: string } | null;
const soundingAt = (scene: SceneLanes, path: number) =>
  scene.enabled?.[path] ?? scene.sounding === path;
function containsSelected(steps: IdStep[], props: Props): boolean {
  return (
    !!props.selected &&
    steps.some((step) =>
      typeof step === 'string'
        ? props.tiles(step).some((tile) => tile.id === props.selected)
        : step.branches.some((branch) => containsSelected(branch, props)),
    )
  );
}

function RowSteps(
  props: Props & {
    drag: Drag;
    steps: IdStep[];
    owner: Owner;
    silentExpanded: boolean;
    onToggleSilent: () => void;
  },
) {
  const { steps, owner, drag } = props;
  const at = (index: number): RouteAt =>
    owner ? { split: owner.split.split, path: owner.path, index } : top(index);
  // A path's last connection runs on to the join bar, so its arrow lands there.
  // A block's free slot beside this place already offers a +: one is enough.
  const besideSlot = (index: number) => {
    const before = steps[index - 1];
    const after = steps[index];
    return (
      (typeof before === 'string' && !!props.tiles(before).at(-1)?.empty) ||
      (typeof after === 'string' && !!props.tiles(after)[0]?.empty)
    );
  };
  const gap = (index: number, last = false) => {
    const here = at(index);
    const open = !!props.onGap && !!props.gaps?.(here) && !besideSlot(index);
    const key = gapKey(here);
    return (
      <span
        key={`gap-${key}`}
        className={
          last && owner
            ? `${LINK} min-w-11 flex-1 group-data-[orientation=vertical]/route:flex-none group-data-[orientation=vertical]/route:after:hidden`
            : LINK
        }
        // A place a dragged block can land, even where nothing can be added.
        data-gap={open || props.onMove ? key : undefined}
        data-drop={drag.over === key || undefined}
        data-drop-before={drag.over === key || undefined}
      >
        {open && (
          <Button
            variant="outline"
            type="button"
            // The chain map's + on a line: small, dashed, half strength until
            // pointed at; its target is larger than it looks.
            className="relative size-7 min-h-0 min-w-0 rounded-full border-dashed border-border bg-background p-0 text-muted-foreground opacity-50 group-data-drop/gap:border-2 group-data-drop/gap:border-solid group-data-drop/gap:border-foreground group-data-drop/gap:opacity-100 after:absolute after:-inset-2 hover:border-foreground hover:text-foreground hover:opacity-100 focus-visible:opacity-100 sm:size-6 [&_svg]:size-3 [@media(pointer:coarse)]:min-w-0"
            aria-label={describe(here, owner?.name ?? null)}
            disabled={props.disabled}
            onClick={() => props.onGap!(here)}
          >
            <Plus aria-hidden="true" />
          </Button>
        )}
      </span>
    );
  };
  const out: ReactNode[] = [];
  steps.forEach((step, index) => {
    out.push(gap(index));
    if (typeof step === 'string') {
      out.push(<Block key={step} {...props} id={step} />);
      return;
    }
    const scene = props.scenes?.split === step.split ? props.scenes : null;
    const silent =
      step.branches.length > 3 && scene
        ? scene.names.flatMap((name, path) =>
            scene.enabled?.[path] === false &&
            !containsSelected(step.branches[path] ?? [], props)
              ? [{ name, path }]
              : [],
          )
        : [];
    out.push(
      <SplitFrame
        key={step.split}
        label={scene ? 'Scene lanes' : `Split · ${step.branches.length} paths`}
        layout={`${step.branches.length}:${props.silentExpanded}`}
      >
        {step.branches.map((branch, path) => {
          if (
            !props.silentExpanded &&
            silent.some((item) => item.path === path)
          )
            return null;
          const name = scene
            ? `scene ${path + 1}`
            : `path ${path + 1}${owner ? ` of ${owner.name}` : ''}`;
          const sounding = scene ? soundingAt(scene, path) : undefined;
          const empty: RouteAt = { split: step.split, path, index: 0 };
          return (
            <div
              key={`${step.split}-${path}`}
              className="route-path grid min-w-0 gap-0.5 data-dim:opacity-60"
              role="group"
              aria-label={
                scene
                  ? `Scene ${path + 1} ${scene.names[path] ?? ''}${sounding ? ', sounding' : ''}`
                  : `Path ${path + 1}`
              }
              data-dim={(scene && !sounding) || undefined}
            >
              {/* The chain map's path label: a small rounded tag. */}
              <span className="shadow-sm w-fit max-w-full rounded-full border border-border bg-card px-2 py-0.5 text-[11px] whitespace-nowrap group-data-[orientation=vertical]/route:wrap-anywhere group-data-[orientation=vertical]/route:whitespace-normal">
                {scene
                  ? `${path + 1} ${scene.names[path] ?? ''}${sounding ? ' · Sounding' : ''}`
                  : props.plain
                    ? `Path ${path + 1}`
                    : caption(step, path)}
              </span>
              <div
                data-line
                className="flex min-w-max shrink-0 items-center group-data-[orientation=vertical]/route:w-full group-data-[orientation=vertical]/route:min-w-0 group-data-[orientation=vertical]/route:flex-col group-data-[orientation=vertical]/route:items-stretch"
              >
                {branch.length ? (
                  <RowSteps
                    {...props}
                    steps={branch}
                    owner={{ split: step, path, name }}
                  />
                ) : (
                  <>
                    <span className={LINK} aria-hidden="true" />
                    {props.onAdd ? (
                      <Button
                        variant="outline"
                        type="button"
                        className="inline-grid min-h-touch shrink-0 place-items-center rounded-md border border-dashed border-wire px-3 font-medium group-data-[orientation=vertical]/route:self-start data-drop:border-2 data-drop:border-foreground"
                        data-gap={gapKey(empty)}
                        data-drop={drag.over === gapKey(empty) || undefined}
                        aria-label={`Add effect to ${name}`}
                        disabled={props.disabled}
                        onClick={() => props.onAdd!(empty)}
                      >
                        + Add effect
                      </Button>
                    ) : (
                      <span className="inline-grid min-h-touch shrink-0 place-items-center rounded-md border border-dashed border-wire px-3 font-medium group-data-[orientation=vertical]/route:self-start data-drop:border-2 data-drop:border-foreground">
                        Dry
                      </span>
                    )}
                    <span
                      className={`${LINK} min-w-11 flex-1 group-data-[orientation=vertical]/route:flex-none group-data-[orientation=vertical]/route:after:hidden`}
                      aria-hidden="true"
                    />
                  </>
                )}
              </div>
            </div>
          );
        })}
        {silent.length > 0 && (
          <SilentBranchesToggle
            names={silent.map(({ name }) => name)}
            expanded={props.silentExpanded}
            onToggle={props.onToggleSilent}
          />
        )}
      </SplitFrame>,
    );
  });
  out.push(gap(steps.length, true));
  return <>{out}</>;
}

/**
 * The paths of a split, between the split bar and the join bar. The bars are
 * dashed like every connection and run only between the first and last
 * path's lines. Running down a phone, one bar runs down the left.
 */
function SplitFrame({
  label,
  layout,
  children,
}: {
  label: string;
  layout: string;
  children: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const bus = useBus(frame, layout);
  return (
    <div
      ref={frame}
      className="relative grid shrink-0 gap-2 py-1 group-data-[orientation=vertical]/route:min-w-0 group-data-[orientation=vertical]/route:border-l group-data-[orientation=vertical]/route:border-dashed group-data-[orientation=vertical]/route:border-wire group-data-[orientation=vertical]/route:pl-3"
      role="group"
      aria-label={label}
    >
      {bus &&
        (['left-0', 'right-0'] as const).map((side) => (
          <span
            key={side}
            aria-hidden="true"
            className={`pointer-events-none absolute ${side} border-l border-dashed border-wire group-data-[orientation=vertical]/route:hidden`}
            style={{ top: bus.top, height: bus.height }}
          />
        ))}
      {children}
    </div>
  );
}

function Block(props: Props & { drag: Drag; id: string }) {
  const { id, drag } = props;
  const canMove = !props.disabled && !!props.movable?.(id);
  const tiles = props.tiles(id);
  // A run of empty slots shows as one + (7.28); it adds at the first.
  return (
    <div
      className="relative isolate flex shrink-0 items-center group-data-[orientation=vertical]/route:w-full group-data-[orientation=vertical]/route:min-w-0 group-data-[orientation=vertical]/route:flex-col group-data-[orientation=vertical]/route:items-stretch group-data-[orientation=vertical]/route:gap-3 group-data-[orientation=vertical]/route:before:absolute group-data-[orientation=vertical]/route:before:inset-y-0 group-data-[orientation=vertical]/route:before:left-6 group-data-[orientation=vertical]/route:before:-z-1 group-data-[orientation=vertical]/route:before:border-l group-data-[orientation=vertical]/route:before:border-wire data-lifted:relative data-lifted:z-2 data-lifted:opacity-70"
      data-node={id}
      data-flip={id}
      data-lifted={drag.moving === id || undefined}
      style={drag.offset(id)}
    >
      {tiles
        .filter((t, i) => !(t.empty && tiles[i - 1]?.empty))
        .map((t, i) => [
          // Blocks inside one node are joined like any others, so a free
          // slot sits centred between its neighbours.
          i > 0 && (
            <span
              key={`link-${t.id}`}
              aria-hidden="true"
              className={`${LINK} group-data-[orientation=vertical]/route:hidden`}
            />
          ),
          t.empty ? (
            props.onSlot && (
              <SlotTile
                key={t.id}
                id={t.id}
                disabled={props.disabled}
                onAdd={() => props.onSlot!(t.id)}
              />
            )
          ) : (
            <span
              key={t.id}
              className="group-data-[orientation=vertical]/route:w-full data-movable:touch-pan-x group-data-[orientation=vertical]/route:data-movable:touch-pan-y group-data-[orientation=vertical]/route:[&>button]:w-full"
              onKeyDown={(e: ReactKeyboardEvent) => {
                const key = moveKey(e);
                if (!key || !canMove || !props.onKey) return;
                e.preventDefault();
                props.onKey(id, key);
              }}
              onPointerDown={
                canMove && props.onMove ? (e) => drag.start(e, id) : undefined
              }
              data-movable={canMove || undefined}
            >
              <RigTile
                block={t}
                selected={props.selected === t.id}
                disabled={props.disabled}
                onSelect={() => {
                  if (!drag.consumeClick()) props.onSelect(t.id);
                }}
              />
            </span>
          ),
        ])}
    </div>
  );
}

function moveKey(e: ReactKeyboardEvent): MoveKey | null {
  if (!e.altKey) return null;
  return (
    (
      {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      } as const
    )[e.key as 'ArrowLeft'] ?? null
  );
}

function ListSteps(props: Props & { steps: IdStep[] }) {
  return (
    <>
      {props.steps.map((step) =>
        typeof step === 'string' ? (
          // A run of free slots is one row, as the tree shows one +.
          props
            .tiles(step)
            .filter((t, i, all) => !(t.empty && all[i - 1]?.empty))
            .map((t) => (
              <li key={t.id}>
                {t.empty ? (
                  props.onSlot && (
                    <Button
                      variant="outline"
                      disabled={props.disabled}
                      onClick={() => props.onSlot!(t.id)}
                    >
                      Add a block here
                    </Button>
                  )
                ) : (
                  <Button
                    variant="outline"
                    aria-pressed={props.selected === t.id}
                    aria-label={t.on ? t.label : `${t.label}, bypassed`}
                    disabled={props.disabled}
                    onClick={() => props.onSelect(t.id)}
                  >
                    {t.label}
                    {t.on ? '' : ' (off)'}
                  </Button>
                )}
              </li>
            ))
        ) : (
          <ListSplit key={step.split} {...props} split={step} />
        ),
      )}
    </>
  );
}

function ListSplit(props: Props & { split: Split }) {
  const { split } = props;
  const scene = props.scenes?.split === split.split ? props.scenes : null;
  return (
    <li>
      <strong>
        {scene ? 'Scenes' : `Split, ${split.branches.length} paths`}
      </strong>
      <ol>
        {split.branches.map((branch, path) => {
          const end: RouteAt = {
            split: split.split,
            path,
            index: branch.length,
          };
          return (
            <li key={`${split.split}-${path}`}>
              <strong>
                {scene
                  ? `${path + 1} ${scene.names[path] ?? ''}`
                  : `Path ${path + 1}`}
              </strong>{' '}
              <Caption as="span">
                {scene
                  ? soundingAt(scene, path)
                    ? '(sounding)'
                    : ''
                  : props.plain
                    ? ''
                    : `(${caption(split, path).split(' · ').slice(1).join(', ')})`}
              </Caption>
              {!!branch.length && (
                <ol>
                  <ListSteps {...props} steps={branch} />
                </ol>
              )}
              {props.onAdd && props.gaps?.(end) && (
                <Button
                  variant="outline"
                  aria-label={`Add effect to ${scene ? 'scene' : 'path'} ${path + 1}`}
                  disabled={props.disabled}
                  onClick={() => props.onAdd!(end)}
                >
                  + Add effect
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </li>
  );
}

const SLOP = 8;
const HOLD_MS = 350;
/**
 * Pointer dragging onto gaps. A mouse or pen drags once it moves past a few
 * pixels; a finger holds first, so a swipe still scrolls the chain. The drop
 * lands on the gap nearest the pointer.
 */
function useGapDrag(
  root: RefObject<HTMLDivElement | null>,
  onMove?: (id: string, at: RouteAt) => void,
) {
  type Press = {
    pointerId: number;
    id: string;
    x: number;
    y: number;
    live: boolean;
  };
  const press = useRef<Press | null>(null);
  const timer = useRef<number>(undefined);
  const dragged = useRef(false);
  type Moving = { id: string; dx: number; dy: number; over: string | null };
  const [moving, setState] = useState<Moving | null>(null);
  const latest = useRef<Moving | null>(null);
  const setMoving = (next: Moving | null) => {
    latest.current = next;
    setState(next);
  };
  const nearest = (x: number, y: number) => {
    let best: { key: string; d: number } | null = null;
    for (const el of root.current?.querySelectorAll<HTMLElement>(
      '[data-gap]',
    ) ?? []) {
      const b = el.getBoundingClientRect();
      const d = Math.hypot(
        x - (b.left + b.right) / 2,
        y - (b.top + b.bottom) / 2,
      );
      if (!best || d < best.d) best = { key: el.dataset.gap!, d };
    }
    return best?.key ?? null;
  };
  function lift(e: { clientX: number; clientY: number }) {
    const p = press.current;
    if (!p) return;
    p.live = true;
    dragged.current = true;
    navigator.vibrate?.(10);
    setMoving({
      id: p.id,
      dx: e.clientX - p.x,
      dy: e.clientY - p.y,
      over: nearest(e.clientX, e.clientY),
    });
  }
  function end(drop: boolean) {
    window.clearTimeout(timer.current);
    const p = press.current;
    press.current = null;
    const m = latest.current;
    setMoving(null);
    if (drop && p?.live && m?.over) onMove?.(p.id, parseGap(m.over));
  }
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const hold = (e: TouchEvent) => {
      if (press.current?.live) e.preventDefault();
    };
    el.addEventListener('touchmove', hold, { passive: false });
    return () => {
      el.removeEventListener('touchmove', hold);
      window.clearTimeout(timer.current);
      press.current = null;
    };
  }, [root]);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (!p.live) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= SLOP) return;
        // A finger that moves before the hold is a scroll, not a drag.
        if (e.pointerType === 'touch') return end(false);
        lift(e);
        return;
      }
      setMoving({
        id: p.id,
        dx: e.clientX - p.x,
        dy: e.clientY - p.y,
        over: nearest(e.clientX, e.clientY),
      });
    };
    const up = (e: PointerEvent) => {
      if (press.current?.pointerId === e.pointerId) end(true);
    };
    const cancel = (e: PointerEvent) => {
      if (press.current?.pointerId === e.pointerId) end(false);
    };
    const blur = () => {
      if (press.current) end(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') blur();
    };
    window.addEventListener('blur', blur);
    window.addEventListener('keydown', escape);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', escape);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  });
  return {
    active: !!moving,
    moving: moving?.id,
    over: moving?.over ?? null,
    start(e: ReactPointerEvent, id: string) {
      if (!onMove || e.button !== 0 || press.current) return;
      dragged.current = false;
      press.current = {
        pointerId: e.pointerId,
        id,
        x: e.clientX,
        y: e.clientY,
        live: false,
      };
      window.clearTimeout(timer.current);
      if (e.pointerType === 'touch') {
        const at = { clientX: e.clientX, clientY: e.clientY };
        timer.current = window.setTimeout(() => lift(at), HOLD_MS);
      }
    },
    offset(id: string): CSSProperties | undefined {
      return moving?.id === id
        ? { transform: `translate(${moving.dx}px, ${moving.dy}px)` }
        : undefined;
    },
    /** True once after a drag, so its pointerup is not also a tap. */
    consumeClick() {
      const was = dragged.current;
      dragged.current = false;
      return was;
    },
  };
}
