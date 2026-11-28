import { CaretDown } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Button } from '../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Slider } from '../components/ui/slider';
import { cn } from '../lib/cn';

/**
 * The unit's output level, under the OUT meter: "OUT · −6.0 dB ⌄". It opens
 * the master level, Mono and the playing preset's boost (a slot, since the
 * boost has its own flow). The level is the whole unit's, after every
 * preset, and is never saved in a preset. The caller sends each change and
 * shows the level the unit confirms.
 * @see docs/interface.md
 */

/** "−6.0 dB", "+1.5 dB", "Silent" at the bottom of the range. */
function formatLevel(db: number, min: number) {
  if (db <= min) return 'Silent';
  if (db === 0) return '0.0 dB';
  return `${db < 0 ? '−' : '+'}${Math.abs(db).toFixed(1)} dB`;
}

export function OutputLevelControl({
  levelDb,
  onLevel,
  onLevelCommit,
  mono,
  onMono,
  boost,
  min = -60,
  max = 12,
  step = 0.5,
  disabled = false,
  error,
  className,
}: {
  /** Master output level in dB, as the unit reports it. */
  levelDb: number;
  /** While dragging; send it as it moves. */
  onLevel: (db: number) => void;
  /** When the drag ends. */
  onLevelCommit?: (db: number) => void;
  /** Left and right summed to both outputs. */
  mono: boolean;
  onMono: (mono: boolean) => void;
  /** Beside Mono, such as the playing preset's boost. */
  boost?: ReactNode;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** Why the last change was refused, in plain words. */
  error?: string;
  className?: string;
}) {
  const text = formatLevel(levelDb, min);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          title="Output level, mono and boost"
          className={cn('gap-1.5', className)}
        >
          <span className="small-caps text-xs text-muted-foreground">Out</span>
          <span className="font-mono tabular-nums">{text}</span>
          {mono && <span className="text-xs text-muted-foreground">Mono</span>}
          <CaretDown className="size-3.5" aria-hidden="true" />
          <span className="sr-only">. Change the output level</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-80 gap-3">
        <section
          aria-label="Output level"
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2"
        >
          <Slider
            label="Level"
            readout={text}
            min={min}
            max={max}
            step={step}
            value={[levelDb]}
            disabled={disabled}
            aria-valuetext={text}
            onValueChange={([v]) => v != null && onLevel(v)}
            onValueCommit={([v]) => v != null && onLevelCommit?.(v)}
          />
          <Button
            size="sm"
            variant={mono ? 'default' : 'outline'}
            aria-pressed={mono}
            disabled={disabled}
            onClick={() => onMono(!mono)}
          >
            Mono
          </Button>
          {boost ?? <span />}
        </section>
        {error && (
          <p role="alert" className="m-0 text-sm text-danger-ink">
            {error}
          </p>
        )}
        <p className="m-0 text-xs text-muted-foreground">
          The whole unit&apos;s output, after every preset. Not saved in
          presets.
        </p>
      </PopoverContent>
    </Popover>
  );
}
