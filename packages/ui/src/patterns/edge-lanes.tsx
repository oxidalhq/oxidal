import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { duration, STILL, useGlowOnce } from '../lib/capsule-motion';
import { cn } from '../lib/cn';
import { Meter } from '../widgets/meter';

/**
 * The lanes along the chain's edges. The left lane is what comes in: the IN
 * meter at the very edge, the guitar under it, and figures such as the input
 * peak, calibration and the foot controller. The right lane is processing
 * and what goes out: the OUT meter, the output level under it, and DSP, CPU,
 * xruns and clips. The meters rest at 60 % until a signal comes through and
 * ease back a few seconds after it stops. The figures are faint while you
 * play and fainter while something moves; a figure that needs attention
 * lights up and glows once. When the lanes are narrower than `figuresFrom`
 * the figures step aside and only the meters and their controls stay.
 * @see docs/interface.md
 */

/** A signal above this level brings a meter forward… */
const SIGNAL_DB = -50;
/** …and it eases back this long after the signal stops. */
const QUIET_AFTER = 3000;

export type EdgeFigure = {
  /** Short, in small capitals: "Input", "DSP", "MIDI". */
  label: string;
  /** "−12 dBFS", "31%", "Chocolate". */
  value: string;
  /** Needs attention: lit in oxide, glows once. */
  attention?: boolean;
  /** A small light before the value, such as a controller being connected. */
  light?: 'on' | 'off';
  /** Makes the figure a button, such as MIDI opening Settings › MIDI. */
  onOpen?: () => void;
  /** The button's tooltip. */
  title?: string;
};

export type EdgeSide = {
  /** Level in dBFS, or null with no reading. */
  level: number | null;
  /** Held peak in dBFS. */
  peak?: number | null;
  clipped?: boolean;
  figures?: EdgeFigure[];
  /** Under the meter, at full strength: the guitar (IN) or the output level (OUT). */
  control?: ReactNode;
};

type Faint = 'idle' | 'busy' | 'full';

/** A figure drawn as a picture: its words are said once more for screen readers. */
function Figure({
  label,
  value,
  attention,
  light,
  faint,
  order,
  align,
}: Omit<EdgeFigure, 'onOpen' | 'title'> & {
  faint: Faint;
  order: number;
  align: 'left' | 'right';
}) {
  const glow = useGlowOnce<SVGSVGElement>(!!attention);
  const x = align === 'left' ? 0 : 96;
  const anchor = align === 'left' ? 'start' : 'end';
  const dim = !attention && faint !== 'full';
  const lit = light !== undefined && align === 'left';
  return (
    <svg
      ref={glow}
      width="96"
      height="40"
      aria-hidden="true"
      data-attention={attention || undefined}
      style={{
        // Fading out to faint is slow and drifts a little; waking up is quick.
        transitionDuration: duration(dim ? 700 : 200),
        transitionDelay: `calc(${order * 35}ms * var(--c2-speed, 1))`,
      }}
      className={cn(
        'overflow-visible transition-[opacity,translate] ease-out',
        attention ? 'text-brand opacity-100' : 'text-foreground',
        dim && faint === 'idle' && 'translate-y-px opacity-35',
        dim && faint === 'busy' && 'translate-y-0.5 opacity-15',
        STILL,
      )}
    >
      <text
        x={x}
        y="12"
        textAnchor={anchor}
        fill="currentColor"
        className="small-caps text-xs"
      >
        {label}
      </text>
      {lit && (
        <circle
          cx="4"
          cy="29"
          r="3.5"
          className={
            light === 'on'
              ? 'fill-led-pedal'
              : 'fill-none stroke-current opacity-60'
          }
        />
      )}
      <text
        x={lit ? 13 : x}
        y="34"
        textAnchor={anchor}
        fill="currentColor"
        className="font-mono text-base tabular-nums"
      >
        {value}
      </text>
    </svg>
  );
}

/** Whether a signal came through in the last few seconds. */
function useSignal(level: number | null) {
  const [live, setLive] = useState(false);
  const loudAt = useRef(0);
  useEffect(() => {
    if (level != null && level > SIGNAL_DB) loudAt.current = Date.now();
  });
  useEffect(() => {
    const id = setInterval(
      () => setLive(Date.now() - loudAt.current < QUIET_AFTER),
      250,
    );
    return () => clearInterval(id);
  }, []);
  return live;
}

/** One lane: the meter at the edge, its figures on the inner side, its control below. */
export function EdgeLane({
  side,
  level,
  peak,
  clipped = false,
  figures = [],
  control,
  stopped = false,
  faint = 'idle',
  showFigures = true,
  className,
}: EdgeSide & {
  side: 'left' | 'right';
  /** Audio stopped: the meter drops out and a faint note stays. */
  stopped?: boolean;
  /** How the figures sit: faint while playing, fainter while something moves, or full. */
  faint?: Faint;
  showFigures?: boolean;
  className?: string;
}) {
  const live = useSignal(level);
  const label = side === 'left' ? 'In' : 'Out';
  const meter = stopped ? (
    <Figure label="Audio" value="stopped" faint="idle" order={0} align={side} />
  ) : (
    <div
      data-live={live || undefined}
      style={{ transitionDuration: duration(live ? 300 : 800) }}
      className={cn(
        'grid h-full grid-rows-[minmax(0,1fr)_auto] justify-items-center gap-1 transition-opacity ease-out',
        live ? 'opacity-100' : 'opacity-60',
        // The fill eases: up fast, down slower. Its label is drawn as a
        // picture, so a resting meter keeps the contrast rules.
        '[&_[data-slot=meter]>div>div]:transition-[height] [&_[data-slot=meter]>div>div]:duration-150 [&_[data-slot=meter]>div>div]:ease-out [&_[data-slot=meter]>span]:hidden',
        STILL,
      )}
    >
      <Meter
        label={label}
        value={level}
        peak={peak}
        clipped={clipped}
        orientation="vertical"
        size="md"
        showValue={false}
      />
      {!control && (
        <svg width="32" height="14" aria-hidden="true">
          <text
            x="16"
            y="11"
            textAnchor="middle"
            fill="currentColor"
            className="small-caps text-xs text-muted-foreground"
          >
            {label}
          </text>
        </svg>
      )}
    </div>
  );
  return (
    <div
      data-slot="edge-lane"
      data-side={side}
      className={cn(
        'pointer-events-none absolute inset-y-0 z-10 flex flex-col gap-2 py-4',
        side === 'left' ? 'left-0 items-start pl-2' : 'right-0 items-end pr-2',
        className,
      )}
    >
      <div
        className={cn(
          'flex min-h-0 flex-1 gap-3',
          side === 'right' && 'flex-row-reverse',
        )}
      >
        <div className={stopped ? 'w-max' : 'w-8'}>{meter}</div>
        {showFigures && !stopped && figures.length > 0 && (
          <div
            role="group"
            aria-label={side === 'left' ? 'Input' : 'Processing and output'}
            className="flex flex-col justify-center gap-4"
          >
            {figures.map((f, i) => {
              const figure = (
                <Figure
                  key={f.label}
                  label={f.label}
                  value={f.value}
                  attention={f.attention}
                  light={f.light}
                  faint={faint}
                  order={i}
                  align={side}
                />
              );
              const words = `${f.label} ${f.value}${f.attention ? ', needs attention' : ''}`;
              return f.onOpen ? (
                <button
                  key={f.label}
                  type="button"
                  title={f.title}
                  onClick={f.onOpen}
                  className="pointer-events-auto rounded-lg text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-touch"
                >
                  {figure}
                  <span className="sr-only">{words}</span>
                </button>
              ) : (
                <span key={f.label} className="block">
                  {figure}
                  <span className="sr-only">{words}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>
      {control && <div className="pointer-events-auto">{control}</div>}
    </div>
  );
}

/** How wide the lanes are, so the figures can step aside when there is no room. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Both lanes over the chain area. Place it inside the chain's positioned
 * box; give it a top offset (`className="top-14"`) to clear a header.
 */
export function EdgeLanes({
  input,
  output,
  stopped = false,
  playing = false,
  moving = false,
  figuresFrom = 1200,
  className,
}: {
  /** The IN lane: what comes in. */
  input: EdgeSide;
  /** The OUT lane: processing and what goes out. */
  output: EdgeSide;
  stopped?: boolean;
  /** Audio is running: the figures sit faint. */
  playing?: boolean;
  /** The pointer or a drag is moving: the figures fade further. */
  moving?: boolean;
  /** The lanes' width from which the figures show beside the meters, in CSS pixels. */
  figuresFrom?: number;
  className?: string;
}) {
  const [ref, width] = useWidth();
  const showFigures = width == null || width >= figuresFrom;
  const faint: Faint = !playing ? 'full' : moving ? 'busy' : 'idle';
  return (
    <div
      ref={ref}
      data-slot="edge-lanes"
      data-figures={showFigures || undefined}
      className={cn('pointer-events-none absolute inset-0', className)}
    >
      <EdgeLane
        side="left"
        {...input}
        stopped={stopped}
        faint={faint}
        showFigures={showFigures}
      />
      <EdgeLane
        side="right"
        {...output}
        stopped={stopped}
        faint={faint}
        showFigures={showFigures}
      />
    </div>
  );
}
