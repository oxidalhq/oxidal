import { ArrowRight, Plus } from '@phosphor-icons/react';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';

import { Led } from '@oxidal/design-system/components/badge';
import { Button } from '@oxidal/design-system/components/button';
import { useFlip } from '@oxidal/design-system/lib/use-flip';
import { useVerticalRig } from '@oxidal/design-system/lib/use-media';
import { ChainBlock, ChainPort } from '@oxidal/design-system/widgets/chain';

import type { BlockKind, RigBlockVM, RigLaneVM } from './rigChain';

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
  useFlip(
    root,
    JSON.stringify(
      lanes.map((lane) => [lane.id, ...lane.blocks.map((b) => b.id)]),
    ),
  );
  const phone = useVerticalRig();
  const vertical = phone && appearance !== 'artwork';
  const portClass =
    'relative z-1 mt-5 inline-flex w-fit items-center gap-1 bg-background px-1.5 font-mono text-xs font-semibold whitespace-nowrap group-data-active/lane:text-foreground group-data-dim/lane:text-muted-foreground group-data-[orientation=vertical]/chain:mt-0 group-data-[orientation=vertical]/chain:justify-self-start max-sm:mt-0 group-data-[orientation=vertical]/chain:[&>svg]:rotate-90';
  const busClass =
    'absolute -top-2 bottom-0 border-l border-wire group-first/lane:top-8 group-last/lane:bottom-auto group-last/lane:h-10 group-data-[orientation=vertical]/chain:hidden data-[side=split]:left-0 data-[side=sum]:right-0 max-sm:hidden';
  const drag = useDrag(root, vertical, disabled ? undefined : onMove);
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
      className="relative z-1 flex min-w-0 gap-1 overflow-x-auto px-0.5 py-1 [scrollbar-width:none] group-data-[orientation=vertical]/chain:flex-col group-data-[orientation=vertical]/chain:items-stretch group-data-[orientation=vertical]/chain:gap-2 group-data-[orientation=vertical]/chain:overflow-visible group-data-[orientation=vertical]/chain:border-l group-data-[orientation=vertical]/chain:border-wire group-data-[orientation=vertical]/chain:pl-2 max-sm:flex-wrap max-sm:overflow-visible"
      role="region"
      aria-label={`${lane.id} chain blocks`}
      data-lane={index}
      tabIndex={0}
    >
      {/* A run of empty slots shows as one + (7.28); it adds at the first. */}
      {lane.blocks
        .filter((b, i) => !(b.empty && lane.blocks[i - 1]?.empty))
        .map((b) => block(b, index))}
      {!lane.blocks.length && (
        <span className="mt-5 self-center bg-background px-1.5 text-sm text-muted-foreground">
          Direct signal
        </span>
      )}
    </div>
  );
  if (parallel && lanes.length > 1)
    return (
      <div
        ref={root}
        className="chain-view group/chain relative isolate grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-0 before:absolute before:inset-x-0 before:top-8 before:-z-1 before:border-t before:border-wire data-dragging:cursor-grabbing data-[orientation=vertical]:grid-cols-1 data-[orientation=vertical]:before:hidden max-sm:grid-cols-1 max-sm:gap-1.5 max-sm:before:hidden"
        data-dragging={drag.active || undefined}
        aria-label={label}
        data-chain-view={appearance}
        data-orientation={vertical ? 'vertical' : 'horizontal'}
      >
        <ChainPort label="IN" className={portClass} />
        <div className="grid min-w-0 auto-cols-max gap-2 overflow-x-auto [scrollbar-width:none] group-data-[orientation=vertical]/chain:auto-cols-auto group-data-[orientation=vertical]/chain:overflow-visible max-sm:auto-cols-auto max-sm:gap-3 max-sm:overflow-visible max-sm:border-l max-sm:border-wire max-sm:pl-3">
          {lanes.map((lane, index) => (
            <div
              key={lane.id}
              className="group/lane relative grid min-w-max grid-cols-[auto_minmax(0,1fr)] items-start gap-1.5 px-2.5 group-data-[orientation=vertical]/chain:min-w-0 group-data-[orientation=vertical]/chain:grid-cols-1 before:absolute before:inset-x-0 before:top-8 before:border-t before:border-wire group-data-[orientation=vertical]/chain:before:hidden max-sm:min-w-0 max-sm:grid-cols-1 max-sm:px-0 max-sm:before:hidden [&>[data-lane]]:overflow-visible"
              data-dim={lane.dim || undefined}
              data-active={lane.active || undefined}
              role="group"
              aria-current={lane.active ? 'true' : undefined}
              aria-label={`${lane.id} signal chain${lane.active ? ', sounding' : ''}`}
            >
              <span className={busClass} data-side="split" aria-hidden="true" />
              <span
                className="relative z-1 mt-5 inline-flex w-fit min-w-5 flex-col items-center justify-center gap-1 bg-background px-1.5 font-mono text-xs font-semibold whitespace-nowrap group-data-active/lane:text-foreground group-data-dim/lane:text-muted-foreground group-data-[orientation=vertical]/chain:mt-0 group-data-[orientation=vertical]/chain:justify-self-start max-sm:mt-0 max-sm:flex-row max-sm:justify-start max-sm:gap-2 [&:has([data-lane-name])]:w-18 max-sm:[&:has([data-lane-name])]:w-auto group-data-[orientation=vertical]/chain:[&>svg]:rotate-90"
                title={lane.name}
              >
                <span>{lane.input}</span>
                {lane.name && (
                  <span
                    data-lane-name
                    className="max-w-18 truncate text-2xs font-medium max-sm:max-w-none max-sm:text-sm"
                  >
                    {lane.name}
                  </span>
                )}
                {lane.active && (
                  <span className="rounded border border-current px-1 py-0.5 text-2xs leading-none uppercase">
                    Sounding
                  </span>
                )}
              </span>
              {tiles(lane, index)}
              <span className={busClass} data-side="sum" aria-hidden="true" />
            </div>
          ))}
        </div>
        <span className={portClass}>
          OUT <ArrowRight aria-hidden="true" />
        </span>
      </div>
    );
  return (
    <div
      ref={root}
      className="chain-view group/chain grid min-w-0 gap-2 data-dragging:cursor-grabbing"
      data-dragging={drag.active || undefined}
      aria-label={label}
      data-chain-view={appearance}
      data-orientation={vertical ? 'vertical' : 'horizontal'}
    >
      {lanes.map((lane, index) => (
        <div
          key={lane.id}
          className="group/lane relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-1.5 group-data-[orientation=vertical]/chain:grid-cols-1 before:absolute before:inset-x-0 before:top-8 before:border-t before:border-wire group-data-[orientation=vertical]/chain:before:hidden max-sm:before:hidden"
          data-dim={lane.dim || undefined}
          data-active={lane.active || undefined}
          role="group"
          aria-current={lane.active ? 'true' : undefined}
          aria-label={`${lane.id} signal chain${lane.active ? ', sounding' : ''}`}
        >
          <ChainPort label={lane.input} className={portClass} />
          {tiles(lane, index)}
          <span className={portClass}>
            OUT <ArrowRight aria-hidden="true" />
          </span>
        </div>
      ))}
    </div>
  );
}

/** An empty slot: a dashed + tile on the wire. A tap adds a block here. */
export function SlotTile({
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
    <Button
      variant="outline"
      type="button"
      className="relative min-h-touch shrink-0 gap-1 border-dashed bg-background px-3 text-muted-foreground group-data-[orientation=vertical]/chain:self-start group-data-[orientation=vertical]/route:self-start data-drop-before:border-solid data-drop-before:outline-2 data-drop-before:outline-brand"
      data-tile={id}
      data-drop-before={dropBefore || undefined}
      aria-label="Add a block here"
      disabled={disabled}
      onClick={onAdd}
    >
      <Plus aria-hidden="true" /> Add
    </Button>
  );
}

/** Shared chain block with the runtime's exact identity, artwork and drag owner. */
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
    <ChainBlock
      block={{
        id: block.id,
        label: block.label,
        caption: block.caption,
        preview: block.preview,
        kind: block.kind === 'other' ? 'lv2' : block.kind,
        on: block.on,
        icon: block.face,
      }}
      selected={selected}
      tint={block.tint}
      lifted={!!drag?.style}
      className="group-data-[orientation=vertical]/chain:w-full data-drop-before:outline-2 data-drop-before:outline-brand data-lifted:pointer-events-none data-movable:select-none max-lg:group-data-[orientation=horizontal]/chain:w-36 max-lg:group-data-[orientation=horizontal]/route:w-36"
      data-tile={block.id}
      data-flip={block.id}
      data-movable={drag ? true : undefined}
      data-lifted={drag?.style ? true : undefined}
      data-drop-before={dropBefore || undefined}
      style={drag?.style}
      onPointerDown={drag?.onPointerDown}
      data-kind={block.kind}
      data-on={block.on}
      title={block.label}
      disabled={disabled}
      onSelect={onSelect}
    />
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
    <Button
      type="button"
      variant="outline"
      className="min-w-24 justify-start aria-pressed:border-foreground"
      data-kind={kind}
      aria-pressed={on}
      aria-label={on && !state ? label : `${label} · ${state ?? 'Bypassed'}`}
      disabled={disabled}
      onClick={onToggle}
    >
      <Led kind={!kind || kind === 'other' ? 'lv2' : kind} on={on} />
      {state ?? (on ? 'On' : 'Bypassed')}
    </Button>
  );
}

const SLOP = 8;
const HOLD_MS = 350;
/**
 * Pointer dragging for chain tiles. A mouse or pen drags once it moves past a
 * few pixels; a finger holds first, so a swipe still scrolls the chain. The
 * drop uses the position along the visible lane's axis.
 */
function useDrag(
  root: React.RefObject<HTMLDivElement | null>,
  vertical: boolean,
  onMove?: (id: string, lane: number, before: string | null) => void,
) {
  type Press = {
    pointerId: number;
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
        return Math.max(b.top - y, 0, y - b.bottom);
      };
      return !best || d(r) < d(best) ? r : best;
    }, undefined);
    if (!row) return null;
    const tiles = [...row.querySelectorAll<HTMLElement>('[data-tile]')].filter(
      (t) => t.dataset.tile !== press.current?.id,
    );
    const next = tiles.find((t) => {
      const b = t.getBoundingClientRect();
      return vertical ? y < (b.top + b.bottom) / 2 : x < (b.left + b.right) / 2;
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
    before: moving?.before,
    start(e: ReactPointerEvent, id: string, lane: number) {
      if (!onMove || e.button !== 0 || press.current) return;
      dragged.current = false;
      press.current = {
        pointerId: e.pointerId,
        id,
        lane,
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
