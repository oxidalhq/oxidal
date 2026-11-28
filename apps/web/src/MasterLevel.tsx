import { CaretDown } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@oxidal/design-system/components/popover';
import { Slider } from '@oxidal/design-system/components/slider';
import { Switch } from '@oxidal/design-system/components/switch';
import { Caption } from '@oxidal/design-system/components/text';
import { cn } from '@oxidal/design-system/lib/cn';

import { type UnitLevels, unitLevels } from './api';
import {
  formatLevel,
  LEVEL_MAX,
  LEVEL_MIN,
  levelToPosition,
  positionToLevel,
} from './levelTaper';
import { friendlyError } from './lib/friendlyError';
import { useMonitorReadings } from './monitorFeed';

const STEPS = 1000;

/**
 * Master output level for the whole unit: after every rig, kept across presets
 * and engines, never saved in a preset. Moves are sent as they happen; while a
 * request is in flight only the newest value waits, so dragging never queues up.
 * @see docs/audio.md
 */
function useMasterLevel() {
  const [levels, setLevels] = useState<UnitLevels | null>(null);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const waiting = useRef<UnitLevels | null>(null);
  // Key repeats can arrive before React re-renders; step from the newest value.
  const latest = useRef<UnitLevels | null>(null);

  useMonitorReadings(supported ? 1000 : null, ({ snapshot, disconnected }) => {
    const confirmed = snapshot?.audio?.monitoring?.levels;
    if (!confirmed || disconnected || sending.current || latest.current == null)
      return;
    latest.current = confirmed;
    setLevels(confirmed);
  });

  useEffect(() => {
    const abort = new AbortController();
    unitLevels(undefined, abort.signal)
      .then((current) => {
        latest.current = current;
        if (current) setLevels(current);
        else setSupported(false);
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setError(friendlyError(cause, 'read the output level'));
      });
    return () => abort.abort();
  }, []);

  async function send(next: UnitLevels) {
    if (sending.current) {
      waiting.current = next;
      return;
    }
    sending.current = true;
    try {
      let pending: UnitLevels | null = next;
      while (pending) {
        waiting.current = null;
        await unitLevels(pending);
        pending = waiting.current;
      }
      setError('');
    } catch (cause) {
      setError(friendlyError(cause, 'change the output level'));
      // Show what the unit actually has after a refused change.
      unitLevels()
        .then((current) => {
          if (!current) return;
          latest.current = current;
          setLevels(current);
        })
        .catch(() => {});
    } finally {
      sending.current = false;
    }
  }
  function change(db: number) {
    const now = latest.current;
    if (!now || db === now.output_level_db) return;
    update({ ...now, output_level_db: db });
  }
  function update(next: UnitLevels) {
    latest.current = next;
    setLevels(next);
    void send(next);
  }

  return { supported, levels, error, latest, change, update };
}
type Level = ReturnType<typeof useMasterLevel>;

export function MasterLevel({
  disabled = false,
  extra,
  layout = 'row',
}: {
  disabled?: boolean;
  /** A control that belongs beside Level, such as the playing preset's boost. */
  extra?: ReactNode;
  /**
   * "row": Level with a Mono button, for the panel and the OUT popover.
   * "page": Levels › Overview as C2 draws it, Master level beside a Mono
   * switch with its note.
   */
  layout?: 'row' | 'page';
}) {
  const level = useMasterLevel();
  return (
    <LevelFields
      level={level}
      disabled={disabled}
      extra={extra}
      layout={layout}
    />
  );
}

/**
 * The output level under the Rig's OUT meter: "OUT · −6.0 dB ⌄" opens the
 * same Level, Mono and boost as the panel row, with the same taper.
 * @see docs/interface.md
 */
export function OutLevelButton({
  boost,
  className,
}: {
  boost?: ReactNode;
  /** Such as the full row height beside larger buttons (Perform). */
  className?: string;
}) {
  const level = useMasterLevel();
  if (!level.supported || !level.levels) return null;
  const { output_level_db: db, mono } = level.levels;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          title="Output level, mono and boost"
          className={cn('gap-1.5', className)}
        >
          <span className="text-xs small-caps text-muted-foreground">Out</span>
          <span className="font-mono tabular-nums">{formatLevel(db)}</span>
          {mono && <span className="text-xs text-muted-foreground">Mono</span>}
          <CaretDown className="size-3.5" aria-hidden="true" />
          <span className="sr-only">. Change the output level</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
        <section aria-label="Output level" className="grid gap-2">
          <LevelFields level={level} extra={boost} />
        </section>
      </PopoverContent>
    </Popover>
  );
}

function LevelFields({
  level,
  disabled = false,
  extra,
  layout = 'row',
}: {
  level: Level;
  disabled?: boolean;
  extra?: ReactNode;
  layout?: 'row' | 'page';
}) {
  const { supported, levels, error, latest, change, update } = level;
  const monoId = useId();
  if (!supported) return null;
  // Render once loaded so the row never flashes in and out on older daemons.
  if (!levels)
    return error ? (
      <p className="col-span-full text-sm" role="alert">
        {error}
      </p>
    ) : null;
  const db = levels.output_level_db;
  const toggleMono = () => {
    const now = latest.current;
    if (now) update({ ...now, mono: !now.mono });
  };
  const slider = (
    <Slider
      label={layout === 'page' ? 'Master level' : 'Level'}
      readout={formatLevel(db)}
      live
      min={0}
      max={STEPS}
      step={1}
      value={[Math.round(levelToPosition(db) * STEPS)]}
      disabled={disabled}
      aria-valuetext={formatLevel(db)}
      title="Master output for every preset. Not saved in presets."
      onValueChange={([position]) => change(positionToLevel(position! / STEPS))}
      onKeyDown={(e) => {
        // Arrow keys move in whole dB rather than fader steps.
        const delta =
          e.key === 'ArrowUp' || e.key === 'ArrowRight'
            ? 1
            : e.key === 'ArrowDown' || e.key === 'ArrowLeft'
              ? -1
              : 0;
        if (!delta || disabled) return;
        e.preventDefault();
        const from = latest.current?.output_level_db ?? db;
        change(
          Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.round(from) + delta)),
        );
      }}
    />
  );
  if (layout === 'page')
    return (
      <div className="grid min-w-0 gap-x-6 gap-y-4 md:grid-cols-2 md:items-center">
        {slider}
        <div className="flex min-w-0 items-center justify-between gap-3">
          <label htmlFor={monoId} className="grid gap-0.5">
            <span className="text-sm font-medium">Mono</span>
            <Caption as="span" className="text-xs">
              For a single PA or amp feed.
            </Caption>
          </label>
          <Switch
            id={monoId}
            aria-label="Mono"
            checked={levels.mono ?? false}
            disabled={disabled}
            title="Sum left and right: check how the preset sounds on a mono PA, or leave on for mono output"
            onCheckedChange={toggleMono}
          />
        </div>
        {extra && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 md:col-span-2">
            {extra}
          </div>
        )}
        {error && (
          <p className="text-sm md:col-span-2" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      {slider}
      <Button
        type="button"
        size="sm"
        variant={levels.mono ? 'default' : 'outline'}
        aria-pressed={levels.mono ?? false}
        disabled={disabled}
        title="Sum left and right: check how the preset sounds on a mono PA, or leave on for mono output"
        onClick={toggleMono}
      >
        Mono
      </Button>
      {extra && (
        <div className="col-span-full flex min-w-0 flex-wrap items-center gap-2 sm:col-span-1">
          {extra}
        </div>
      )}
      {error && (
        <p className="col-span-full text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
