import type { BlockKind, RigBlockVM, RigLaneVM } from './rigChain';
import { ArrowRight, Plus } from '@phosphor-icons/react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import './ChainView.css';

/**
 * One chain for every engine: plain outlined tiles on a wire, an LED for the
 * on/bypassed state and ink inversion for selection. Tiles carry no buttons;
 * a tap selects and bypass lives in the block detail.
 * @see docs/interface.md
 */
export function ChainView({
  lanes,
  selected,
  onSelect,
  disabled,
  label,
  appearance,
  parallel = false,
  onAdd,
  movable,
  onMove,
}: {
  /** Empty slots are shown only when blocks can be added to them. */
  onAdd?: (slot: string) => void;
  /** Blocks that can be dragged to another place. */
  movable?: (id: string) => boolean;
  /** A dragged block dropped before `before` (a tile id) in `lane`, or at its end. */
  onMove?: (id: string, lane: number, before: string | null) => void;
  lanes: RigLaneVM[];
  /** Lanes are branches of one signal: one input splits to all, one output sums them. */
  parallel?: boolean;
  /** Chain appearance preference, exposed for styling and tests. */
  appearance?: string;
  selected?: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  label: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const drag = useDrag(root, disabled ? undefined : onMove);
  const block = (b: RigBlockVM, lane: number) =>
    b.empty ? (
      onAdd && (
        <SlotTile
          key={b.id}
          id={b.id}
          disabled={disabled}
          dropBefore={drag.before === b.id}
          onAdd={() => onAdd(b.id)}
        />
      )
    ) : (
      <RigTile
        key={b.id}
        block={b}
        selected={selected === b.id}
        disabled={disabled}
        onSelect={() => {
          if (!drag.consumeClick()) onSelect(b.id);
        }}
        drag={
          onMove && movable?.(b.id) && !disabled
            ? {
                onPointerDown: (e) => drag.start(e, b.id, lane),
                style: drag.offset(b.id),
              }
            : undefined
        }
        dropBefore={drag.before === b.id}
      />
    );
  const tiles = (lane: RigLaneVM, index: number) => (
    <div
      className="chain-blocks"
      role="region"
      aria-label={`${lane.id} chain blocks`}
      data-lane={index}
      tabIndex={0}
    >
      {lane.blocks.map((b) => block(b, index))}
      {!lane.blocks.length && (
        <span className="chain-empty">Direct signal</span>
      )}
    </div>
  );
  if (parallel && lanes.length > 1)
    return (
      <div
        ref={root}
        className="chain-view chain-parallel"
        data-dragging={drag.active || undefined}
        aria-label={label}
        data-chain-view={appearance}
      >
        <span className="chain-port">IN</span>
        <div className="chain-parallel-lanes">
          {lanes.map((lane, index) => (
            <div
              key={lane.id}
              className="chain-lane chain-branch"
              data-dim={lane.dim || undefined}
              aria-label={`${lane.id} signal chain`}
            >
              <span
                className="chain-bus"
                data-side="split"
                aria-hidden="true"
              />
              <span
                className="chain-port chain-branch-number"
                title={lane.name}
              >
                <span>{lane.input}</span>
                {lane.name && (
                  <span className="chain-branch-name">{lane.name}</span>
                )}
              </span>
              {tiles(lane, index)}
              <span className="chain-bus" data-side="sum" aria-hidden="true" />
            </div>
          ))}
        </div>
        <span className="chain-port">
          OUT <ArrowRight aria-hidden="true" />
        </span>
      </div>
    );
  return (
    <div
      ref={root}
      className="chain-view"
      data-dragging={drag.active || undefined}
      aria-label={label}
      data-chain-view={appearance}
    >
      {lanes.map((lane, index) => (
        <div
          key={lane.id}
          className="chain-lane"
          data-dim={lane.dim || undefined}
          aria-label={`${lane.id} signal chain`}
        >
          <span className="chain-port">{lane.input}</span>
          {tiles(lane, index)}
          <span className="chain-port">
            OUT <ArrowRight aria-hidden="true" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** An empty slot: a dashed + tile on the wire. A tap adds a block here. */
function SlotTile({
  id,
  disabled,
  dropBefore,
  onAdd,
}: {
  id: string;
  disabled?: boolean;
  dropBefore?: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      className="rig-tile rig-slot"
      data-tile={id}
      data-drop-before={dropBefore || undefined}
      aria-label="Add a block here"
      disabled={disabled}
      onClick={onAdd}
    >
      <span className="rig-tile-face">
        <Plus aria-hidden="true" />
      </span>
      <span className="rig-tile-label">Add</span>
    </button>
  );
}

/** One block: outlined face, category LED, short label. A tap selects. */
export function RigTile({
  block,
  selected,
  disabled,
  onSelect,
  drag,
  dropBefore,
}: {
  block: RigBlockVM;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  /** Present when the tile can be dragged to another place. */
  drag?: {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
    style?: CSSProperties;
  };
  /** A dragged block would land just before this one. */
  dropBefore?: boolean;
}) {
  return (
    <button
      type="button"
      className="rig-tile"
      data-tile={block.id}
      data-movable={drag ? true : undefined}
      data-lifted={drag?.style ? true : undefined}
      data-drop-before={dropBefore || undefined}
      style={drag?.style}
      onPointerDown={drag?.onPointerDown}
      data-kind={block.kind}
      data-on={block.on}
      aria-label={block.on ? block.label : `${block.label}, bypassed`}
      title={block.label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="rig-tile-face">
        <span className="chain-led" aria-hidden="true" />
        {block.face}
      </span>
      <span className="rig-tile-label">{block.label}</span>
    </button>
  );
}

/** Labelled LED toggle used for block and setting on/bypass state. */
export function LedToggle({
  on,
  kind,
  label,
  disabled,
  onToggle,
  state,
}: {
  on: boolean;
  /** Overrides On/Bypassed, e.g. "Mixed" for a partially enabled branch. */
  state?: string;
  kind?: BlockKind;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="led-toggle"
      data-kind={kind}
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="chain-led" aria-hidden="true" />
      {state ?? (on ? 'On' : 'Bypassed')}
    </button>
  );
}

const SLOP = 8;
const HOLD_MS = 350;
/**
 * Pointer dragging for chain tiles. A mouse or pen drags once it moves past a
 * few pixels; a finger holds first, so a swipe still scrolls the chain. The
 * drop lands before the tile under the pointer's x, in the lane under its y.
 */
function useDrag(
  root: React.RefObject<HTMLDivElement | null>,
  onMove?: (id: string, lane: number, before: string | null) => void,
) {
  type Press = {
    id: string;
    lane: number;
    x: number;
    y: number;
    live: boolean;
  };
  const press = useRef<Press | null>(null);
  const timer = useRef<number>(undefined);
  const dragged = useRef(false);
  type Moving = {
    id: string;
    dx: number;
    dy: number;
    lane: number;
    before: string | null;
  };
  const [moving, setState] = useState<Moving | null>(null);
  // The drop reads the latest position, not a render's copy.
  const latest = useRef<Moving | null>(null);
  const setMoving = (next: Moving | null) => {
    latest.current = next;
    setState(next);
  };
  const target = (x: number, y: number) => {
    const rows = [
      ...(root.current?.querySelectorAll<HTMLElement>('[data-lane]') ?? []),
    ];
    const row = rows.reduce<HTMLElement | undefined>((best, r) => {
      const d = (el: HTMLElement) => {
        const b = el.getBoundingClientRect();
        return Math.abs(y - (b.top + b.bottom) / 2);
      };
      return !best || d(r) < d(best) ? r : best;
    }, undefined);
    if (!row) return null;
    const tiles = [...row.querySelectorAll<HTMLElement>('[data-tile]')].filter(
      (t) => t.dataset.tile !== press.current?.id,
    );
    const next = tiles.find((t) => {
      const b = t.getBoundingClientRect();
      return x < (b.left + b.right) / 2;
    });
    return {
      lane: Number(row.dataset.lane),
      before: next?.dataset.tile ?? null,
    };
  };
  function lift(e: { clientX: number; clientY: number }) {
    const p = press.current;
    if (!p) return;
    p.live = true;
    dragged.current = true;
    navigator.vibrate?.(10);
    const at = target(e.clientX, e.clientY);
    setMoving({
      id: p.id,
      dx: e.clientX - p.x,
      dy: e.clientY - p.y,
      lane: at?.lane ?? p.lane,
      before: at?.before ?? null,
    });
  }
  function end(drop: boolean) {
    window.clearTimeout(timer.current);
    const p = press.current;
    press.current = null;
    const m = latest.current;
    setMoving(null);
    if (drop && p?.live && m) onMove?.(p.id, m.lane, m.before);
  }
  // While a finger drags, the page must not scroll under it.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const hold = (e: TouchEvent) => {
      if (press.current?.live) e.preventDefault();
    };
    el.addEventListener('touchmove', hold, { passive: false });
    return () => el.removeEventListener('touchmove', hold);
  }, [root]);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      const far = Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP;
      if (!p.live) {
        if (!far) return;
        // A finger that moves before the hold is a scroll, not a drag.
        if (e.pointerType === 'touch') return end(false);
        lift(e);
        return;
      }
      const at = target(e.clientX, e.clientY);
      const m = latest.current;
      if (m)
        setMoving({
          ...m,
          dx: e.clientX - p.x,
          dy: e.clientY - p.y,
          lane: at?.lane ?? m.lane,
          before: at ? at.before : m.before,
        });
    };
    const up = () => end(true);
    const cancel = () => end(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  });
  return {
    active: !!moving,
    before: moving?.before,
    start(e: ReactPointerEvent, id: string, lane: number) {
      if (!onMove || e.button !== 0) return;
      dragged.current = false;
      press.current = { id, lane, x: e.clientX, y: e.clientY, live: false };
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
