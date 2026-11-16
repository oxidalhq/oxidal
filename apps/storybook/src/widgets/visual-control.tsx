import * as React from 'react';
import { cn } from '../lib/cn';
import type { BlockControl } from './block-editor';
import { BlockVisual } from './block-visuals';
import type { BlockKind } from './chain';

type Axis = { control: string; log?: boolean };
type Handle = {
  id: string;
  label: string;
  x?: Axis;
  y?: Axis;
  /** A fixed position (0–1) on an axis the handle does not change. */
  at?: { x?: number; y?: number };
};

/** Which controls each drawing's handles move. Unknown controls are skipped. */
const HANDLES: Record<string, Handle[]> = {
  delay: [
    {
      id: 'taps',
      label: 'Time and feedback',
      x: { control: 'time', log: true },
      y: { control: 'feedback' },
    },
  ],
  reverb: [
    {
      id: 'tail',
      label: 'Decay and mix',
      x: { control: 'decay', log: true },
      y: { control: 'mix' },
    },
  ],
  cab: [
    {
      id: 'low',
      label: 'Low cut',
      x: { control: 'lowcut', log: true },
      at: { y: 0.2 },
    },
    {
      id: 'high',
      label: 'High cut',
      x: { control: 'highcut', log: true },
      at: { y: 0.2 },
    },
  ],
  amp: [
    { id: 'bass', label: 'Bass', y: { control: 'bass' }, at: { x: 0.15 } },
    { id: 'mid', label: 'Mid', y: { control: 'mid' }, at: { x: 0.5 } },
    { id: 'treble', label: 'Treble', y: { control: 'treble' }, at: { x: 0.8 } },
    {
      id: 'presence',
      label: 'Presence',
      y: { control: 'presence' },
      at: { x: 0.95 },
    },
  ],
  drive: [
    {
      id: 'drive',
      label: 'Drive and tone',
      x: { control: 'tone' },
      y: { control: 'drive' },
    },
  ],
  gate: [
    {
      id: 'threshold',
      label: 'Threshold',
      y: { control: 'threshold' },
      at: { x: 0.85 },
    },
  ],
  mod: [
    {
      id: 'lfo',
      label: 'Rate and depth',
      x: { control: 'rate' },
      y: { control: 'depth' },
    },
  ],
};

function toUnit(control: BlockControl, log?: boolean) {
  if (log && control.min > 0)
    return (
      Math.log(control.value / control.min) /
      Math.log(control.max / control.min)
    );
  return (control.value - control.min) / (control.max - control.min);
}

function fromUnit(control: BlockControl, unit: number, log?: boolean) {
  const u = Math.min(1, Math.max(0, unit));
  const raw =
    log && control.min > 0
      ? control.min * Math.pow(control.max / control.min, u)
      : control.min + u * (control.max - control.min);
  const step = control.step ?? 0.1;
  return Math.min(
    control.max,
    Math.max(control.min, Math.round(raw / step) * step),
  );
}

function format(control: BlockControl) {
  return `${control.label} ${control.value.toFixed(control.step && control.step >= 1 ? 0 : 1)}${control.unit ? ` ${control.unit}` : ''}`;
}

/**
 * The block's drawing, made touchable: drag the delay's repeats sideways for
 * time and up for feedback, the reverb tail for decay and mix, the cab's two
 * cut-offs, the amp's four tone points, the drive curve, the gate line. Each
 * handle is a slider for the keyboard too (arrows; Shift for fine). The
 * drawing redraws as you drag, so the eye and the ear agree.
 */
export function VisualControl({
  kind,
  role,
  controls,
  onControl,
  disabled = false,
  className,
}: {
  kind: BlockKind;
  role?: string;
  controls: BlockControl[];
  onControl: (control: string, value: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState<string | null>(null);
  const byId = Object.fromEntries(controls.map((c) => [c.id, c]));
  const values = Object.fromEntries(controls.map((c) => [c.id, c.value]));
  const handles = (HANDLES[role ?? kind] ?? HANDLES[kind] ?? []).filter(
    (h) => (!h.x || byId[h.x.control]) && (!h.y || byId[h.y.control]),
  );

  const move = (handle: Handle, clientX: number, clientY: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const ux = (clientX - rect.left) / rect.width;
    const uy = 1 - (clientY - rect.top) / rect.height;
    if (handle.x)
      onControl(
        handle.x.control,
        fromUnit(byId[handle.x.control]!, ux, handle.x.log),
      );
    if (handle.y)
      onControl(
        handle.y.control,
        fromUnit(byId[handle.y.control]!, uy, handle.y.log),
      );
  };

  const nudge = (
    handle: Handle,
    axis: 'x' | 'y',
    sign: 1 | -1,
    fine: boolean,
  ) => {
    const a = handle[axis];
    if (!a) return;
    const control = byId[a.control]!;
    const unit = toUnit(control, a.log) + sign * (fine ? 0.01 : 0.05);
    onControl(a.control, fromUnit(control, unit, a.log));
  };

  return (
    <div
      ref={box}
      data-slot="visual-control"
      className={cn('relative touch-none select-none', className)}
    >
      <BlockVisual
        kind={kind}
        role={role}
        values={values}
        className="size-full"
      />
      {!disabled &&
        handles.map((handle) => {
          const x = handle.x
            ? toUnit(byId[handle.x.control]!, handle.x.log)
            : (handle.at?.x ?? 0.5);
          const y = handle.y
            ? toUnit(byId[handle.y.control]!, handle.y.log)
            : (handle.at?.y ?? 0.5);
          const main = byId[(handle.x ?? handle.y)!.control]!;
          const text = [handle.x, handle.y]
            .filter(Boolean)
            .map((a) => format(byId[a!.control]!))
            .join(', ');
          return (
            <span
              key={handle.id}
              role="slider"
              tabIndex={0}
              aria-label={handle.label}
              aria-valuemin={main.min}
              aria-valuemax={main.max}
              aria-valuenow={main.value}
              aria-valuetext={text}
              data-active={active === handle.id || undefined}
              onPointerDown={(event) => {
                event.preventDefault();
                (event.currentTarget as HTMLElement).setPointerCapture(
                  event.pointerId,
                );
                setActive(handle.id);
              }}
              onPointerMove={(event) =>
                active === handle.id &&
                move(handle, event.clientX, event.clientY)
              }
              onPointerUp={() => setActive(null)}
              onPointerCancel={() => setActive(null)}
              onKeyDown={(event) => {
                const fine = event.shiftKey;
                if (event.key === 'ArrowRight')
                  nudge(handle, handle.x ? 'x' : 'y', 1, fine);
                else if (event.key === 'ArrowLeft')
                  nudge(handle, handle.x ? 'x' : 'y', -1, fine);
                else if (event.key === 'ArrowUp')
                  nudge(handle, handle.y ? 'y' : 'x', 1, fine);
                else if (event.key === 'ArrowDown')
                  nudge(handle, handle.y ? 'y' : 'x', -1, fine);
                else return;
                event.preventDefault();
              }}
              className={cn(
                'absolute grid size-8 -translate-x-1/2 translate-y-1/2 cursor-grab place-items-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-ring',
                active === handle.id && 'cursor-grabbing',
              )}
              style={{ left: `${x * 100}%`, bottom: `${y * 100}%` }}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'size-3.5 rounded-full border-2 border-foreground bg-background transition-transform duration-[var(--duration-fast)]',
                  active === handle.id && 'scale-125 bg-foreground',
                )}
              />
            </span>
          );
        })}
      {active && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 left-1 rounded-md bg-raised px-1.5 py-0.5 font-mono text-2xs tabular-nums shadow-raised"
        >
          {(() => {
            const handle = handles.find((h) => h.id === active)!;
            return [handle.x, handle.y]
              .filter(Boolean)
              .map((a) => format(byId[a!.control]!))
              .join(' · ');
          })()}
        </span>
      )}
    </div>
  );
}
