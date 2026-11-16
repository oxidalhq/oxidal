import * as React from 'react';
import {
  ClockCounterClockwise,
  Lightning,
  Plug,
  Plus,
  SpeakerHifi,
  SpeakerSimpleHigh,
  WaveSine,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Badge, Led } from '../components/ui/badge';

export type BlockKind = 'amp' | 'cab' | 'pedal' | 'time' | 'mod' | 'lv2';

export type ChainBlockModel = {
  id: string;
  label: string;
  kind: BlockKind;
  /** The category or engine, shown in small caps under the name. */
  caption?: string;
  on: boolean;
  unsaved?: boolean;
  icon?: React.ReactNode;
  /** One line of the main values, as in "380 ms · 35%". */
  preview?: string;
};

export type ChainLaneModel = {
  id: string;
  name?: string;
  blocks: ChainBlockModel[];
};

const GLYPHS: Record<BlockKind, React.ReactNode> = {
  amp: <SpeakerHifi />,
  cab: <SpeakerSimpleHigh />,
  pedal: <Lightning />,
  time: <ClockCounterClockwise />,
  mod: <WaveSine />,
  lv2: <Plug />,
};

/**
 * One block in the chain: a glyph for its kind with the category LED, its
 * name, a small-caps caption, a one-line preview of its main values, and a
 * badge when it is bypassed or unsaved. The selected block inverts ink and
 * paper and lifts; a bypassed one is drawn dashed. In editing mode a long
 * press lifts it to drag.
 */
export function ChainBlock({
  block,
  selected = false,
  disabled = false,
  lifted = false,
  sceneMark = false,
  muted = false,
  size = 'md',
  onSelect,
  onPointerDown,
  className,
}: {
  block: ChainBlockModel;
  selected?: boolean;
  disabled?: boolean;
  lifted?: boolean;
  /** The playing scene changes this block (state or values). */
  sceneMark?: boolean;
  /** Held out of the sound for a moment (hold-to-hear). */
  muted?: boolean;
  size?: 'md' | 'lg';
  onSelect: (id: string) => void;
  onPointerDown?: (event: React.PointerEvent<HTMLButtonElement>) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-slot="chain-block"
      data-block={block.id}
      data-kind={block.kind}
      data-on={block.on}
      data-selected={selected || undefined}
      data-lifted={lifted || undefined}
      aria-pressed={selected}
      aria-label={`${block.label}${block.on ? '' : ', bypassed'}${block.unsaved ? ', unsaved' : ''}${sceneMark ? ', changed by this scene' : ''}`}
      data-muted={muted || undefined}
      disabled={disabled}
      onClick={() => onSelect(block.id)}
      onPointerDown={onPointerDown}
      className={cn(
        'group/block relative grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 rounded-pad border border-input bg-card text-left transition-[background-color,transform,box-shadow] duration-[var(--duration-fast)] select-none hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-40',
        size === 'md'
          ? 'min-h-14 w-40 px-2.5 py-2'
          : 'min-h-16 w-48 px-3 py-2.5',
        !block.on && 'border-dashed text-muted-foreground',
        muted && 'opacity-50 [&_svg]:opacity-50',
        selected &&
          'border-foreground bg-foreground text-background shadow-raised hover:bg-foreground',
        lifted && 'z-10 scale-105 shadow-raised',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative grid size-9 place-items-center rounded-lg border [&_svg]:size-5',
          selected
            ? 'border-background/40 bg-background/10'
            : 'border-border bg-background',
          !block.on && 'border-dashed [&_svg]:opacity-60',
        )}
      >
        {block.icon ?? GLYPHS[block.kind]}
        <Led
          kind={block.kind}
          on={block.on}
          className={cn(
            'absolute -top-1 -right-1 size-2.5',
            selected && 'border-background',
          )}
        />
      </span>
      <span className="grid min-w-0 gap-0">
        <span
          className={cn(
            'truncate font-semibold',
            size === 'md' ? 'text-sm' : 'text-md',
          )}
        >
          {block.label}
        </span>
        <span
          className={cn(
            'flex min-w-0 items-center gap-1 small-caps text-xs',
            selected ? 'text-background/70' : 'text-muted-foreground',
          )}
        >
          <span className="truncate">{block.caption ?? block.kind}</span>
          {!block.on && (
            <Badge
              size="sm"
              tone={selected ? 'neutral' : 'warning'}
              className={cn(selected && 'border-background/60 text-background')}
            >
              Off
            </Badge>
          )}
          {block.on && block.unsaved && (
            <Badge
              size="sm"
              tone="warning"
              className={cn(selected && 'border-background/60 text-background')}
            >
              Unsaved
            </Badge>
          )}
        </span>
        {block.preview && (
          <span
            className={cn(
              'truncate font-mono text-xs tabular-nums',
              selected ? 'text-background/80' : 'text-foreground/80',
            )}
          >
            {block.preview}
          </span>
        )}
      </span>
      {sceneMark && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute bottom-1 left-1 size-1.5 rotate-45',
            selected ? 'bg-background' : 'bg-foreground',
          )}
        />
      )}
    </button>
  );
}

/** A port at either end of the chain, or a split/merge node. */
export function ChainPort({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <span
      data-slot="chain-port"
      className={cn(
        'inline-flex h-7 shrink-0 items-center rounded-full border border-foreground px-2 small-caps text-xs font-medium',
        className,
      )}
    >
      {label}
    </span>
  );
}

function Wire({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('h-px w-4 shrink-0 bg-wire', className)}
    />
  );
}

function AddTarget({
  label,
  active,
  onAdd,
}: {
  label: string;
  active?: boolean;
  onAdd: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onAdd}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-wire text-muted-foreground hover:border-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        active &&
          'border-solid border-foreground bg-foreground text-background',
      )}
    >
      <Plus weight="bold" className="size-3.5" />
    </button>
  );
}

const HOLD_MS = 350;

/**
 * The chain: IN, the blocks in order joined by wires, OUT. A parallel rig
 * stacks its lanes between a split and a merge, each lane named. The strip
 * scrolls sideways with edge fades; the selected block is kept in view. In
 * editing mode a + sits in every gap and blocks drag to reorder after a
 * long press (or move with Shift+arrows when focused).
 */
export function Chain({
  lanes,
  parallel = false,
  selected,
  onSelect,
  editing = false,
  disabled = false,
  size = 'md',
  onAdd,
  onMove,
  label = 'Signal chain',
  className,
}: {
  lanes: ChainLaneModel[];
  parallel?: boolean;
  selected?: string | null;
  onSelect: (id: string) => void;
  editing?: boolean;
  disabled?: boolean;
  size?: 'md' | 'lg';
  /** Add a block in `lane` before position `index`. */
  onAdd?: (lane: number, index: number) => void;
  /** Move block `id` to `lane` at position `index` (counted before the move). */
  onMove?: (id: string, lane: number, index: number) => void;
  label?: string;
  className?: string;
}) {
  const root = React.useRef<HTMLDivElement>(null);
  const hold = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lifted, setLifted] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState<{
    lane: number;
    index: number;
  } | null>(null);

  React.useEffect(() => {
    if (!selected || !root.current) return;
    const element = root.current.querySelector<HTMLElement>(
      `[data-block="${CSS.escape(selected)}"]`,
    );
    if (typeof element?.scrollIntoView === 'function')
      element.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
  }, [selected]);

  const locate = (x: number, y: number) => {
    const under = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>('[data-gap]');
    if (!under) return null;
    const [lane, index] = under.dataset.gap!.split(':').map(Number);
    return { lane: lane!, index: index! };
  };
  const pointer =
    (id: string) => (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!editing || !onMove || disabled) return;
      const element = event.currentTarget;
      hold.current = setTimeout(() => {
        setLifted(id);
        element.setPointerCapture(event.pointerId);
      }, HOLD_MS);
      const clear = () => {
        if (hold.current) clearTimeout(hold.current);
        hold.current = null;
        element.removeEventListener('pointerup', clear);
        element.removeEventListener('pointercancel', clear);
      };
      element.addEventListener('pointerup', clear);
      element.addEventListener('pointercancel', clear);
    };
  const keys =
    (id: string, lane: number, index: number) =>
    (event: React.KeyboardEvent) => {
      if (!editing || !onMove || !event.shiftKey) return;
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        onMove(id, lane, index + 2);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        onMove(id, lane, Math.max(0, index - 1));
      }
    };

  const gap = (lane: number, index: number) => (
    <span
      key={`gap-${lane}-${index}`}
      data-gap={`${lane}:${index}`}
      className="inline-flex items-center"
    >
      {editing && onAdd ? (
        <>
          <Wire className="w-2" />
          <AddTarget
            label={`Add block at position ${index + 1}`}
            active={target?.lane === lane && target.index === index}
            onAdd={() => onAdd(lane, index)}
          />
          <Wire className="w-2" />
        </>
      ) : (
        <Wire />
      )}
    </span>
  );

  const lane = (model: ChainLaneModel, laneIndex: number) => (
    <div key={model.id} data-slot="chain-lane" className="flex items-center">
      {parallel && model.name && (
        <span className="mr-2 w-16 shrink-0 truncate small-caps text-xs font-medium text-muted-foreground">
          {model.name}
        </span>
      )}
      {gap(laneIndex, 0)}
      {model.blocks.map((block, index) => (
        <React.Fragment key={block.id}>
          <span
            onKeyDown={keys(block.id, laneIndex, index)}
            className="inline-flex"
          >
            <ChainBlock
              block={block}
              size={size}
              selected={block.id === selected}
              disabled={disabled}
              lifted={lifted === block.id}
              onSelect={onSelect}
              onPointerDown={pointer(block.id)}
            />
          </span>
          {gap(laneIndex, index + 1)}
        </React.Fragment>
      ))}
      {model.blocks.length === 0 && !editing && (
        <span className="small-caps text-sm text-muted-foreground">Empty</span>
      )}
    </div>
  );

  return (
    <div
      ref={root}
      data-slot="chain"
      data-parallel={parallel || undefined}
      data-editing={editing || undefined}
      role="group"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'flex [scrollbar-width:thin] items-center gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)] px-page py-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
        className,
      )}
      onPointerMove={(event) =>
        lifted && setTarget(locate(event.clientX, event.clientY))
      }
      onPointerUp={() => {
        if (lifted && target && onMove)
          onMove(lifted, target.lane, target.index);
        setLifted(null);
        setTarget(null);
      }}
    >
      <ChainPort label="In" />
      {parallel ? (
        <>
          <Wire />
          <ChainPort label="Split" className="border-wire" />
          <div className="grid gap-2 border-l border-wire pl-1">
            {lanes.map(lane)}
          </div>
          <Wire className="border-r border-wire" />
          <ChainPort label="Merge" className="border-wire" />
          <Wire />
        </>
      ) : (
        lanes.slice(0, 1).map(lane)
      )}
      <ChainPort label="Out" />
    </div>
  );
}
