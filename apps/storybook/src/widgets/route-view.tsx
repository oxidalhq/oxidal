import * as React from 'react';
import { GitFork, Plus } from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import {
  addBranch,
  branchWith,
  isSplit,
  joinSplit,
  moveStep,
  setBranchLevel,
  type ListPath,
  type Split,
  type Step,
} from '../lib/route';
import { Button } from '../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Slider } from '../components/ui/slider';
import { Caption } from '../components/ui/text';
import { ChainBlock, ChainPort, type ChainBlockModel } from './chain';

export type RouteBlock = ChainBlockModel;
export type Route = Step<RouteBlock>[];

const HOLD_MS = 320;
const LETTERS = 'ABCDEFGH';

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
function Wire({ level, vertical }: { level?: number; vertical: boolean }) {
  const hot = level !== undefined && level > -1;
  if (vertical)
    return (
      <div
        aria-hidden="true"
        className="flex h-6 items-center gap-2 pl-[1.6rem]"
      >
        <span className="h-full w-px bg-wire" />
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
    <span
      aria-hidden="true"
      className="relative flex w-6 shrink-0 flex-col items-center justify-center gap-1"
    >
      <span className="h-px w-full bg-wire" />
      {level !== undefined && (
        <span className="absolute top-[calc(50%+4px)] h-0.5 w-5 overflow-hidden rounded-full bg-wire/30">
          <span
            className={cn(
              'absolute inset-y-0 left-0',
              hot ? 'bg-brand' : 'bg-foreground',
            )}
            style={{ width: `${fraction(level) * 100}%` }}
          />
        </span>
      )}
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
      <PopoverContent className="grid w-72 gap-3">
        <span className="text-sm font-semibold">Branches</span>
        {split.branches.map((branch, b) => (
          <Slider
            key={b}
            label={`${LETTERS[b]} · ${branch.length ? branch.map((s) => (isSplit(s) ? 'split' : s.label)).join(', ') : 'Dry'}`}
            min={-60}
            max={6}
            step={0.5}
            value={[levels[b] ?? 0]}
            onValueChange={([value]) =>
              value !== undefined &&
              onChange((r) => setBranchLevel(r, split.id, b, value))
            }
            readout={`${(levels[b] ?? 0) <= -60 ? '−∞' : (levels[b] ?? 0).toFixed(1)} dB`}
          />
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
 * splits that fan into lettered branches (an empty branch is the dry
 * signal), joins, and splits again, nested as deep as needed. Laptops draw
 * it left to right; phones top to bottom, so nothing scrolls sideways.
 *
 * Playing: tap a block to select it; hold it to hear the sound without it
 * until you let go. A small meter on every wire shows the level after the
 * block before it. Editing: + targets in every gap; long-press a block to
 * lift it and drop it in a gap, or on "Parallel" under another block to
 * run the two side by side (Quad Cortex's second row, without fixed rows).
 * The split node's popover sets branch levels, adds a branch or joins back.
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
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = React.useRef(false);
  const [lifted, setLifted] = React.useState<string | null>(null);
  const [heard, setHeard] = React.useState<string | null>(null);
  const [target, setTarget] = React.useState<string | null>(null);
  const change = (edit: (r: Route) => Route) => onChange(edit(route));

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  React.useEffect(() => clear, []);

  const press = (id: string) => (event: React.PointerEvent) => {
    if (disabled) return;
    held.current = false;
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

  const drop = () => {
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
      className={cn(
        'relative',
        vertical ? 'grid' : 'inline-grid justify-items-center',
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

  const list = (steps: Route, path: ListPath): React.ReactNode[] => {
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
            className={cn(vertical ? 'grid gap-1' : 'flex items-center')}
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
                  : 'grid gap-3 border-y-0 border-l border-wire py-1 pl-2',
              )}
            >
              {step.branches.map((branch, b) => (
                <div
                  key={b}
                  className={cn(
                    vertical
                      ? 'ml-3 grid border-l-2 border-wire pl-3'
                      : 'flex items-center',
                  )}
                >
                  <span
                    className={cn(
                      'small-caps text-xs font-medium text-muted-foreground',
                      vertical ? 'py-1' : 'mr-2 w-5 text-center',
                    )}
                  >
                    {vertical
                      ? `Branch ${LETTERS[b]}${branch.length ? '' : ' · dry'}`
                      : LETTERS[b]}
                  </span>
                  {branch.length ? (
                    list(branch, [...path, index, b])
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
                </div>
              ))}
            </div>
            {vertical ? (
              <span className="justify-self-start rounded-full border border-wire px-2.5 py-1 small-caps text-xs text-muted-foreground">
                Join
              </span>
            ) : (
              <span
                className="mr-1 h-full border-r border-wire"
                aria-hidden="true"
              />
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
      <ChainPort label="In" className={cn(vertical && 'justify-self-start')} />
      <Wire level={inputLevel} vertical={vertical} />
      {list(route, [])}
      <Wire level={last ? levels?.[last.id] : undefined} vertical={vertical} />
      <ChainPort label="Out" className={cn(vertical && 'justify-self-start')} />
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
