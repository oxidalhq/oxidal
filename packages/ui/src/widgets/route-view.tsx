import { CaretDown, CaretUp, GitFork, Plus } from '@phosphor-icons/react';
import * as React from 'react';

import { Button } from '../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Slider } from '../components/ui/slider';
import { Caption } from '../components/ui/text';
import { cn } from '../lib/cn';
import {
  addBranch,
  blocksOf,
  branchName,
  branchWith,
  isSplit,
  joinSplit,
  type ListPath,
  moveStep,
  nameBranch,
  setBranchLevel,
  type Split,
  type Step,
} from '../lib/route';
import { useFlip } from '../lib/use-flip';
import { ChainBlock, type ChainBlockModel, ChainPort } from './chain';

export type RouteBlock = ChainBlockModel;
export type Route = Step<RouteBlock>[];

const HOLD_MS = 320;
const SILENT_DB = -60;

/** True below `md`: the chain runs top to bottom so a phone never scrolls sideways. */
function usePhone() {
  const [phone, setPhone] = React.useState(false);
  React.useEffect(() => {
    const query = window.matchMedia('(max-width: 47.99rem)');
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return phone;
}

function fraction(db: number) {
  return Math.min(1, Math.max(0, (db + 60) / 60));
}

/**
 * The wire between two steps with the level after the step before it: a
 * thin bar that fills with the signal and turns oxide when it clips, so a
 * quiet or clipping block is visible in place. Vertical wires also print
 * the level.
 */
/** The arrowhead at the end of a wire: which way the signal goes, even when nothing moves. */
function Arrow({ down = false }: { down?: boolean }) {
  return (
    <span
      data-arrow
      aria-hidden="true"
      className={cn(
        'size-1.5 shrink-0 border-foreground/75',
        down
          ? '-mt-1 rotate-45 border-r-2 border-b-2'
          : '-ml-1 rotate-45 border-t-2 border-r-2',
      )}
    />
  );
}

/** In the top-to-bottom route: centres a port or pill on the wire, whatever its width. */
function OnWire({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-7 pl-[1.6rem]">
      <span className="relative flex flex-col items-center">
        <span className="invisible flex flex-col items-center">
          <span className="h-3 w-0.5" />
          <Arrow down />
        </span>
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap">
          {children}
        </span>
      </span>
    </div>
  );
}

function Wire({ level, vertical }: { level?: number; vertical: boolean }) {
  const hot = level !== undefined && level > -1;
  if (vertical)
    return (
      <div
        aria-hidden="true"
        className="flex h-6 items-center gap-2 pl-[1.6rem]"
      >
        <span className="relative flex h-full flex-col items-center">
          <span
            data-line
            className="w-0.5 flex-1 wire-flow-down rounded-full"
          />
          <Arrow down />
        </span>
        {level !== undefined && (
          <>
            <span className="relative h-1 w-10 overflow-hidden rounded-full bg-wire/30">
              <span
                className={cn(
                  'absolute inset-y-0 left-0',
                  hot ? 'bg-brand' : 'bg-foreground',
                )}
                style={{ width: `${fraction(level) * 100}%` }}
              />
            </span>
            <span
              className={cn(
                'font-mono text-2xs text-muted-foreground tabular-nums',
                hot && 'text-brand',
              )}
            >
              {level <= -60 ? '−∞' : `${level.toFixed(0)} dB`}
            </span>
          </>
        )}
      </div>
    );
  return (
    <span aria-hidden="true" className="flex w-10 shrink-0 items-center">
      <span
        data-line
        className="relative h-0.5 flex-1 overflow-hidden rounded-full bg-wire/40"
      >
        <span
          data-meter
          className="absolute inset-y-0 left-0 wire-flow rounded-full transition-[width] duration-150"
          style={{
            width:
              level === undefined
                ? '100%'
                : `${Math.max(12, fraction(level) * 100)}%`,
            ...(hot ? { backgroundColor: 'var(--color-brand)' } : {}),
          }}
        />
      </span>
      <Arrow />
    </span>
  );
}

function Gap({
  path,
  index,
  vertical,
  active,
  onAdd,
}: {
  path: ListPath;
  index: number;
  vertical: boolean;
  active: boolean;
  onAdd?: () => void;
}) {
  return (
    <button
      type="button"
      data-drop={`gap:${JSON.stringify(path)}:${index}`}
      aria-label={`Add a block here (${index + 1})`}
      onClick={onAdd}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-wire text-muted-foreground hover:border-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        vertical ? 'mx-auto my-1 h-7 w-24 gap-1 text-xs' : 'size-7',
        active &&
          'border-solid border-foreground bg-foreground text-background',
      )}
    >
      <Plus weight="bold" className="size-3.5" />
      {vertical && <span className="small-caps">Add</span>}
    </button>
  );
}

function SplitNode({
  split,
  vertical,
  editing,
  onChange,
}: {
  split: Split<RouteBlock>;
  vertical: boolean;
  editing: boolean;
  onChange: (change: (route: Route) => Route) => void;
}) {
  const levels = split.levels ?? split.branches.map(() => 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-split={split.id}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full border border-foreground bg-background px-2.5 small-caps text-xs font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            vertical ? 'h-8 justify-self-start' : 'h-7',
          )}
        >
          <GitFork className="size-3.5 rotate-90" />
          Split{' '}
          <span className={cn(!vertical && 'sr-only')}>
            · {split.branches.length} branches
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="grid max-h-[70dvh] w-72 gap-3 overflow-y-auto">
        <span className="text-sm font-semibold">Branches</span>
        {split.branches.map((branch, b) => (
          <div key={b} className="grid gap-1">
            {editing && (
              <input
                aria-label={`Name of branch ${branchName({ ...split, names: [] }, b)}`}
                value={split.names?.[b] ?? ''}
                placeholder={`Branch ${branchName({ ...split, names: [] }, b)}`}
                onChange={(event) =>
                  onChange((r) =>
                    nameBranch(r, split.id, b, event.target.value),
                  )
                }
                className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
              />
            )}
            <Slider
              label={`${branchName(split, b)} · ${branch.length ? branch.map((s) => (isSplit(s) ? 'split' : s.label)).join(', ') : 'Dry'}`}
              min={SILENT_DB}
              max={6}
              step={0.5}
              value={[levels[b] ?? 0]}
              onValueChange={([value]) =>
                value !== undefined &&
                onChange((r) => setBranchLevel(r, split.id, b, value))
              }
              readout={`${(levels[b] ?? 0) <= SILENT_DB ? '−∞' : (levels[b] ?? 0).toFixed(1)} dB`}
            />
          </div>
        ))}
        {editing && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange((r) => addBranch(r, split.id))}
            >
              Add a branch
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange((r) => joinSplit(r, split.id))}
            >
              Join back to one path
            </Button>
          </div>
        )}
        <Caption className="text-xs">
          Each branch gets the same signal; the join adds them at these levels.
          An empty branch is the dry signal.
        </Caption>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The signal route, drawn as the engine stores it: blocks on the main line,
 * splits that fan into named branches (an empty branch is the dry
 * signal), joins, and splits again, nested as deep as needed. Laptops draw
 * it left to right; phones top to bottom, so nothing scrolls sideways.
 *
 * Playing: tap a block to select it; hold it to hear the sound without it
 * until you let go. A small meter on every wire shows the level after the
 * block before it. Editing: + targets in every gap; long-press a block to
 * lift it and drop it in a gap, or on "Parallel" under another block to
 * run the two side by side (Quad Cortex's second row, without fixed rows).
 * The split node's popover sets branch levels, adds a branch or joins back,
 * and while editing names each branch ("Clean", "Lead"); unnamed branches
 * use letters. A split with more than three branches folds its silent ones
 * into one row: by default on phones, on request on laptops.
 */
export function RouteView<B extends RouteBlock = RouteBlock>({
  route: routeIn,
  onChange: onChangeIn,
  selected,
  onSelect,
  editing = false,
  orientation = 'auto',
  levels,
  inputLevel,
  onAudition,
  sceneChanged,
  sceneColour,
  onAdd,
  disabled = false,
  label = 'Signal route',
  className,
}: {
  route: Step<B>[];
  onChange: (route: Step<B>[]) => void;
  selected?: string | null;
  onSelect: (id: string) => void;
  editing?: boolean;
  orientation?: 'auto' | 'horizontal' | 'vertical';
  /** Level after each block, dBFS, by block id. */
  levels?: Record<string, number>;
  inputLevel?: number;
  /** A block held out of the sound (hold-to-hear), or null when released. */
  onAudition?: (id: string | null) => void;
  /** Blocks the playing scene changes. */
  sceneChanged?: string[];
  /**
   * The playing scene's colour: a faint wash behind the branches and
   * blocks it plays. Never changes a size.
   */
  sceneColour?: string;
  onAdd?: (path: ListPath, index: number) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
}) {
  // The edits only move steps; blocks pass through unchanged, so the caller's block type is kept.
  const route = routeIn as unknown as Route;
  const onChange = (next: Route) => onChangeIn(next as unknown as Step<B>[]);
  const phone = usePhone();
  const vertical =
    orientation === 'vertical' || (orientation === 'auto' && phone);
  const root = React.useRef<HTMLDivElement>(null);
  const inner = React.useRef<HTMLDivElement>(null);
  // Laptops: scale a wide route down to fit (not below 75 %), then scroll.
  const [scale, setScale] = React.useState(1);
  React.useLayoutEffect(() => {
    if (vertical) return;
    const outer = root.current;
    const content = inner.current;
    if (!outer || !content) return;
    const fit = () => {
      const style = getComputedStyle(outer);
      const room =
        outer.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const zoom = parseFloat(getComputedStyle(content).zoom || '1') || 1;
      const natural = content.getBoundingClientRect().width / zoom;
      const next =
        natural > room + 1
          ? Math.max(0.75, Math.floor((room / natural) * 50) / 50)
          : 1;
      setScale((now) => (Math.abs(now - next) < 0.02 ? now : next));
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    observer.observe(content);
    return () => observer.disconnect();
  }, [vertical]);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = React.useRef(false);
  const [lifted, setLifted] = React.useState<string | null>(null);
  const grabbed = React.useRef({ x: 0, y: 0 });
  const [heard, setHeard] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState<string | null>(null);
  const [unfolded, setUnfolded] = React.useState<Record<string, boolean>>({});
  // Big splits fold their silent branches into one row: by default on
  // phones, on request on laptops. Editing always shows every branch.
  const silentOf = (split: Split<RouteBlock>) =>
    split.branches
      .map((branch, b) => ({ branch, b }))
      .filter(
        ({ branch, b }) =>
          (split.levels?.[b] ?? 0) <= SILENT_DB &&
          !blocksOf(branch).some((x) => x.id === selected),
      )
      .map(({ b }) => b);
  const foldable = (split: Split<RouteBlock>) =>
    !editing && split.branches.length > 3 && silentOf(split).length > 0;
  const folded = (split: Split<RouteBlock>) =>
    foldable(split) && !(unfolded[split.id] ?? !vertical);
  const change = (edit: (r: Route) => Route) => onChange(edit(route));
  // Blocks glide to their new places when the order or the folding changes.
  const flip = useFlip(
    root,
    `${blocksOf(route)
      .map((b) => b.id)
      .join('|')}#${JSON.stringify(unfolded)}`,
    scale,
  );

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  React.useEffect(() => clear, []);

  const press = (id: string) => (event: React.PointerEvent) => {
    if (disabled) return;
    held.current = false;
    grabbed.current = { x: event.clientX, y: event.clientY };
    const element = event.currentTarget as HTMLElement;
    const pointer = event.pointerId;
    timer.current = setTimeout(() => {
      held.current = true;
      if (editing) {
        setLifted(id);
        root.current?.setPointerCapture(pointer);
      } else {
        setHeard(id);
        onAudition?.(id);
      }
    }, HOLD_MS);
    void element;
  };
  const release = () => {
    clear();
    if (heard) {
      setHeard(null);
      onAudition?.(null);
    }
  };

  const dragged = () =>
    lifted
      ? root.current?.querySelector<HTMLElement>(`[data-flip="${lifted}"]`)
      : null;
  const drop = () => {
    // Glide from where the finger left the block to where it lands.
    flip.snapshot();
    const node = dragged();
    if (node) node.style.translate = '';
    setTimeout(flip.play, 0);
    if (lifted && target) {
      if (target.startsWith('gap:')) {
        const [, path, index] = /^gap:(.*):(\d+)$/.exec(target) ?? [];
        if (path && index)
          change((r) =>
            moveStep(r, lifted, JSON.parse(path) as ListPath, Number(index)),
          );
      } else if (target.startsWith('branch:')) {
        change((r) => branchWith(r, target.slice(7), lifted));
      }
    }
    setLifted(null);
    setTarget(null);
  };

  const select = (id: string) => {
    if (held.current) {
      held.current = false;
      return;
    }
    onSelect(id);
  };

  const block = (step: RouteBlock) => (
    <div
      key={step.id}
      data-flip={step.id}
      className={cn(
        'relative',
        vertical ? 'grid' : 'inline-grid justify-items-center',
        lifted === step.id && 'pointer-events-none z-20',
      )}
    >
      <span
        className="contents"
        onPointerDown={press(step.id)}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={() => !lifted && release()}
      >
        <ChainBlock
          block={step}
          selected={step.id === selected}
          disabled={disabled}
          lifted={lifted === step.id}
          muted={heard === step.id}
          sceneMark={sceneChanged?.includes(step.id)}
          onSelect={select}
          className={cn(vertical && 'w-full')}
        />
      </span>
      {editing && lifted && lifted !== step.id && (
        <span
          data-drop={`branch:${step.id}`}
          className={cn(
            'inline-flex items-center justify-center gap-1 rounded-full border border-dashed border-wire px-2 small-caps text-2xs text-muted-foreground',
            vertical
              ? 'absolute top-1/2 right-2 h-7 -translate-y-1/2 bg-background'
              : 'mt-1 h-6',
            target === `branch:${step.id}` &&
              'border-solid border-foreground bg-foreground text-background',
          )}
        >
          <GitFork className="size-3 rotate-90" /> Parallel
        </span>
      )}
    </div>
  );

  const list = (
    steps: Route,
    path: ListPath,
    audible = true,
  ): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    const gap = (index: number) =>
      editing ? (
        <Gap
          key={`gap-${index}`}
          path={path}
          index={index}
          vertical={vertical}
          active={target === `gap:${JSON.stringify(path)}:${index}`}
          onAdd={onAdd ? () => onAdd(path, index) : undefined}
        />
      ) : null;
    steps.forEach((step, index) => {
      out.push(gap(index));
      if (isSplit(step)) {
        out.push(
          <div
            key={step.id}
            className={cn(
              vertical ? 'grid gap-1' : 'flex shrink-0 items-center',
            )}
          >
            <SplitNode
              split={step}
              vertical={vertical}
              editing={editing}
              onChange={change}
            />
            <div
              className={cn(
                vertical
                  ? 'grid gap-3'
                  : 'grid shrink-0 grid-cols-[max-content_max-content] gap-y-3 py-1',
              )}
            >
              {step.branches
                .map((branch, b) => ({ branch, b }))
                .filter(({ branch, b }) => {
                  if (!folded(step)) return true;
                  return (
                    (step.levels?.[b] ?? 0) > SILENT_DB ||
                    blocksOf(branch).some((x) => x.id === selected)
                  );
                })
                .map(({ branch, b }, row, rows) => (
                  <div
                    key={b}
                    data-in-scene={
                      (sceneColour &&
                        audible &&
                        (step.levels?.[b] ?? 0) > SILENT_DB) ||
                      undefined
                    }
                    className={cn(
                      'relative',
                      vertical
                        ? 'ml-3 grid border-l-2 border-wire pl-3'
                        : 'col-span-2 grid grid-cols-subgrid items-center',
                      (step.levels?.[b] ?? 0) <= SILENT_DB &&
                        '[&_[data-arrow]]:border-wire [&_[data-line]]:h-px [&_[data-line]]:animate-none [&_[data-line]]:bg-wire [&_[data-line]]:bg-none [&_[data-meter]]:hidden [&_[data-slot=chain-block]]:border-dashed [&_[data-slot=chain-block]]:bg-transparent [&_[data-slot=chain-block]]:text-muted-foreground',
                    )}
                    data-silent={
                      (step.levels?.[b] ?? 0) <= SILENT_DB || undefined
                    }
                  >
                    {sceneColour &&
                      audible &&
                      (step.levels?.[b] ?? 0) > SILENT_DB && (
                        // The playing scene's band: inside the split's
                        // bars, behind the blocks, never changing a size.
                        <span
                          aria-hidden="true"
                          className={cn(
                            'pointer-events-none absolute inset-y-0 rounded-md',
                            vertical ? 'right-0 left-1' : 'right-1.5 left-1.5',
                          )}
                          style={{
                            backgroundColor: `color-mix(in oklab, ${sceneColour} 7%, transparent)`,
                          }}
                        />
                      )}
                    {!vertical &&
                      (['left-0', 'right-0'] as const).map((side) => (
                        // The split's side bars, from the first branch's wire
                        // to the last one's, with no tail past either.
                        <span
                          key={side}
                          aria-hidden="true"
                          className={cn('absolute w-px bg-wire', side)}
                          style={{
                            top: row === 0 ? '50%' : '-0.375rem',
                            bottom:
                              row === rows.length - 1 ? '50%' : '-0.375rem',
                          }}
                        />
                      ))}
                    {vertical ? (
                      <span className="py-1 small-caps text-xs font-medium text-muted-foreground">
                        {`${step.names?.[b]?.trim() ? '' : 'Branch '}${branchName(step, b)}${branch.length ? '' : ' · dry'}${(step.levels?.[b] ?? 0) <= SILENT_DB ? ' · silent' : ''}`}
                      </span>
                    ) : (
                      <span className="flex items-center">
                        <span
                          data-line
                          aria-hidden="true"
                          className="h-0.5 w-2 wire-flow rounded-full"
                        />
                        <span
                          className="max-w-24 truncate px-1.5 small-caps text-xs font-medium text-muted-foreground"
                          title={branchName(step, b)}
                        >
                          {branchName(step, b)}
                        </span>
                        <span
                          data-line
                          aria-hidden="true"
                          className="h-0.5 min-w-2 flex-1 wire-flow rounded-full"
                        />
                        <Arrow />
                      </span>
                    )}
                    <span
                      className={cn(
                        vertical ? 'contents' : 'flex items-center',
                      )}
                    >
                      {branch.length ? (
                        list(
                          branch,
                          [...path, index, b],
                          audible && (step.levels?.[b] ?? 0) > SILENT_DB,
                        )
                      ) : (
                        <>
                          {editing ? (
                            <Gap
                              path={[...path, index, b]}
                              index={0}
                              vertical={vertical}
                              active={
                                target ===
                                `gap:${JSON.stringify([...path, index, b])}:0`
                              }
                              onAdd={
                                onAdd
                                  ? () => onAdd([...path, index, b], 0)
                                  : undefined
                              }
                            />
                          ) : null}
                          <span
                            className={cn(
                              'small-caps text-xs text-muted-foreground',
                              vertical
                                ? 'py-2'
                                : 'w-24 border-t border-dashed border-wire pt-1 text-center',
                            )}
                          >
                            Dry
                          </span>
                        </>
                      )}
                      {!vertical && (
                        <span
                          data-line
                          aria-hidden="true"
                          className="h-0.5 min-w-3 flex-1 wire-flow rounded-full"
                        />
                      )}
                    </span>
                  </div>
                ))}
              {foldable(step) && (
                <button
                  type="button"
                  aria-expanded={!folded(step)}
                  onClick={() =>
                    setUnfolded((all) => ({ ...all, [step.id]: folded(step) }))
                  }
                  className={cn(
                    'col-span-2 ml-2 inline-flex min-h-8 items-center gap-1.5 justify-self-start rounded-full border border-dashed border-wire px-3 text-left text-xs text-muted-foreground hover:border-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    vertical && 'ml-3',
                  )}
                >
                  {folded(step) ? (
                    <>
                      <CaretDown aria-hidden="true" className="size-3.5" />
                      {`Show ${silentOf(step).length} silent: ${silentOf(step)
                        .map((b) => branchName(step, b))
                        .join(', ')}`}
                    </>
                  ) : (
                    <>
                      <CaretUp aria-hidden="true" className="size-3.5" />
                      {`Fold ${silentOf(step).length} silent branches`}
                    </>
                  )}
                </button>
              )}
            </div>
            {vertical ? (
              <OnWire>
                <span className="rounded-full border border-wire bg-background px-2.5 py-1 small-caps text-xs text-muted-foreground">
                  Join
                </span>
              </OnWire>
            ) : (
              <span className="flex items-center" aria-hidden="true">
                <span className="h-px w-2 bg-wire" />
                <span className="rounded-full border border-wire px-2 py-0.5 small-caps text-2xs text-muted-foreground">
                  Join
                </span>
              </span>
            )}
          </div>,
        );
      } else out.push(block(step));
      if (index < steps.length - 1 || !editing) {
        const after = isSplit(step) ? undefined : levels?.[step.id];
        if (index < steps.length - 1)
          out.push(
            <Wire key={`wire-${index}`} level={after} vertical={vertical} />,
          );
      }
    });
    out.push(gap(steps.length));
    return out.filter(Boolean);
  };

  const last = [...route].reverse().find((s) => !isSplit(s)) as
    RouteBlock | undefined;
  return (
    <div
      ref={root}
      data-slot="route"
      data-orientation={vertical ? 'vertical' : 'horizontal'}
      data-editing={editing || undefined}
      role="group"
      aria-label={label}
      tabIndex={vertical ? undefined : 0}
      onPointerMove={(event) => {
        if (!lifted) return;
        // The lifted block follows the finger.
        const node = dragged();
        if (node)
          node.style.translate = `${(event.clientX - grabbed.current.x) / scale}px ${(event.clientY - grabbed.current.y) / scale}px`;
        const under = document
          .elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>('[data-drop]');
        setTarget(under?.dataset.drop ?? null);
      }}
      onPointerUp={() => lifted && drop()}
      className={cn(
        vertical
          ? 'relative grid min-w-0 gap-0 px-page py-2'
          : 'relative flex min-w-0 [scrollbar-width:thin] items-center gap-0 overflow-x-auto [mask-image:linear-gradient(to_right,transparent,black_1rem,black_calc(100%-1rem),transparent)] px-page py-3 outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
        lifted && 'cursor-grabbing select-none',
        className,
      )}
    >
      <div
        ref={inner}
        data-scale={scale < 1 ? scale.toFixed(2) : undefined}
        className={cn(
          vertical ? 'contents' : 'flex w-max shrink-0 items-center',
        )}
        style={!vertical && scale < 1 ? { zoom: scale } : undefined}
      >
        {vertical ? (
          <OnWire>
            <ChainPort label="In" />
          </OnWire>
        ) : (
          <ChainPort label="In" />
        )}
        <Wire level={inputLevel} vertical={vertical} />
        {list(route, [])}
        <Wire
          level={last ? levels?.[last.id] : undefined}
          vertical={vertical}
        />
        {vertical ? (
          <OnWire>
            <ChainPort label="Out" />
          </OnWire>
        ) : (
          <ChainPort label="Out" />
        )}
      </div>
      {heard && (
        <span role="status" className="sr-only">
          Hearing the sound without{' '}
          {(
            route.find((s) => !isSplit(s) && s.id === heard) as
              RouteBlock | undefined
          )?.label ?? 'this block'}
        </span>
      )}
    </div>
  );
}
