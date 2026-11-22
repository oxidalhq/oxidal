import { Plus } from '@phosphor-icons/react';
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { useFlip } from '@oxidal/design-system/lib/use-flip';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';
import { SilentBranchesToggle } from '@oxidal/design-system/widgets/silent-branches-toggle';

import './RouteTree.css';
import { RigTile } from '../ChainView';
import { panLabel } from '../lib/panLabel';
import type { IdStep, RigBlockVM } from '../rigChain';
import { pathMix, type RouteAt } from '../rigRoute';

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
  onKey?: (id: string, key: MoveKey) => void;
  disabled?: boolean;
  /** E-paper: the chain as a numbered list, buttons only. */
  list?: boolean;
  /** Paths folded from a graph for drawing only: their levels are not known. */
  plain?: boolean;
  label?: string;
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
      <div className="route-canvas" role="group" aria-label={label}>
        <ol className="route-list" aria-label="Chain as a list">
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
      className="route-canvas"
      data-orientation={vertical ? 'vertical' : 'horizontal'}
      role="group"
      aria-label={label}
      data-dragging={drag.active || undefined}
    >
      <div
        ref={scroller}
        className="route-scroll"
        role="region"
        aria-label={
          vertical ? 'Chain, input to output' : 'Chain, scrolls sideways'
        }
        tabIndex={vertical ? undefined : 0}
      >
        <div className="route-row">
          <span className="route-port">IN</span>
          <RowSteps
            {...props}
            drag={drag}
            steps={route}
            owner={null}
            silentExpanded={expanded ?? !vertical}
            onToggleSilent={() => setExpanded(!(expanded ?? !vertical))}
          />
          <span className="route-port">OUT</span>
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
  const gap = (index: number) => {
    const here = at(index);
    const open = !!props.onGap && !!props.gaps?.(here);
    const key = gapKey(here);
    return (
      <span
        key={`gap-${key}`}
        className="route-gap"
        data-gap={open ? key : undefined}
        data-drop={drag.over === key || undefined}
        data-drop-before={drag.over === key || undefined}
      >
        {open && (
          <button
            type="button"
            className="route-gap-add"
            aria-label={describe(here, owner?.name ?? null)}
            disabled={props.disabled}
            onClick={() => props.onGap!(here)}
          >
            <Plus aria-hidden="true" />
          </button>
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
      <div
        key={step.split}
        className="route-split"
        role="group"
        aria-label={
          scene ? 'Scene lanes' : `Split · ${step.branches.length} paths`
        }
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
              className="route-path"
              role="group"
              aria-label={
                scene
                  ? `Scene ${path + 1} ${scene.names[path] ?? ''}${sounding ? ', sounding' : ''}`
                  : `Path ${path + 1}`
              }
              data-dim={(scene && !sounding) || undefined}
            >
              <span className="route-path-caption">
                {scene
                  ? `${path + 1} ${scene.names[path] ?? ''}${sounding ? ' · Sounding' : ''}`
                  : props.plain
                    ? `Path ${path + 1}`
                    : caption(step, path)}
              </span>
              <div className="route-row">
                {branch.length ? (
                  <RowSteps
                    {...props}
                    steps={branch}
                    owner={{ split: step, path, name }}
                  />
                ) : (
                  <>
                    <span className="route-gap" aria-hidden="true" />
                    {props.onAdd ? (
                      <button
                        type="button"
                        className="route-empty"
                        data-gap={gapKey(empty)}
                        data-drop={drag.over === gapKey(empty) || undefined}
                        aria-label={`Add effect to ${name}`}
                        disabled={props.disabled}
                        onClick={() => props.onAdd!(empty)}
                      >
                        + Add effect
                      </button>
                    ) : (
                      <span className="route-empty">Dry</span>
                    )}
                    <span className="route-gap" aria-hidden="true" />
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
      </div>,
    );
  });
  out.push(gap(steps.length));
  return <>{out}</>;
}

function Block(props: Props & { drag: Drag; id: string }) {
  const { id, drag } = props;
  const canMove = !props.disabled && !!props.movable?.(id);
  const tiles = props.tiles(id);
  // A run of empty slots shows as one + (7.28); it adds at the first.
  return (
    <div
      className="route-block"
      data-node={id}
      data-flip={id}
      data-lifted={drag.moving === id || undefined}
      style={drag.offset(id)}
    >
      {tiles
        .filter((t, i) => !(t.empty && tiles[i - 1]?.empty))
        .map((t) =>
          t.empty ? (
            props.onSlot && (
              <button
                key={t.id}
                type="button"
                className="rig-tile rig-slot"
                aria-label="Add a block here"
                disabled={props.disabled}
                onClick={() => props.onSlot!(t.id)}
              >
                <span className="rig-tile-face">
                  <Plus aria-hidden="true" />
                </span>
                <span className="rig-tile-label">Add</span>
              </button>
            )
          ) : (
            <span
              key={t.id}
              className="route-tile"
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
        )}
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
          props.tiles(step).map((t) => (
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
              <span className="caption">
                {scene
                  ? soundingAt(scene, path)
                    ? '(sounding)'
                    : ''
                  : props.plain
                    ? ''
                    : `(${caption(split, path).split(' · ').slice(1).join(', ')})`}
              </span>
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
