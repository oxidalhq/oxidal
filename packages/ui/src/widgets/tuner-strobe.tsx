import { useEffect, useId, useRef } from 'react';

import { useMotion } from '../lib/use-media';

/** Bars on the coarse strobe ring; the fine ring has twice as many. */
const BARS = 24;
/** Coarse bars passed per second for each cent of error. */
const DRIFT = 0.08;
/** Length of one wave of the sine trace, in dial units. */
const WAVE = 44;
/** One sine trace, wide enough to slide a whole wave either way. */
const TRACE =
  '-44,178.00 -42,179.97 -40,181.78 -38,183.29 -36,184.37 -34,184.93 -32,184.93 -30,184.37 -28,183.29 -26,181.78 -24,179.97 -22,178.00 -20,176.03 -18,174.22 -16,172.71 -14,171.63 -12,171.07 -10,171.07 -8,171.63 -6,172.71 -4,174.22 -2,176.03 0,178.00 2,179.97 4,181.78 6,183.29 8,184.37 10,184.93 12,184.93 14,184.37 16,183.29 18,181.78 20,179.97 22,178.00 24,176.03 26,174.22 28,172.71 30,171.63 32,171.07 34,171.07 36,171.63 38,172.71 40,174.22 42,176.03 44,178.00 46,179.97 48,181.78 50,183.29 52,184.37 54,184.93 56,184.93 58,184.37 60,183.29 62,181.78 64,179.97 66,178.00 68,176.03 70,174.22 72,172.71 74,171.63 76,171.07 78,171.07 80,171.63 82,172.71 84,174.22 86,176.03 88,178.00 90,179.97 92,181.78 94,183.29 96,184.37 98,184.93 100,184.93 102,184.37 104,183.29 106,181.78 108,179.97 110,178.00 112,176.03 114,174.22 116,172.71 118,171.63 120,171.07 122,171.07 124,171.63 126,172.71 128,174.22 130,176.03 132,178.00 134,179.97 136,181.78 138,183.29 140,184.37 142,184.93 144,184.93 146,184.37 148,183.29 150,181.78 152,179.97 154,178.00 156,176.03 158,174.22 160,172.71 162,171.63 164,171.07 166,171.07 168,171.63 170,172.71 172,174.22 174,176.03 176,178.00 178,179.97 180,181.78 182,183.29 184,184.37 186,184.93 188,184.93 190,184.37 192,183.29 194,181.78 196,179.97 198,178.00 200,176.03 202,174.22 204,172.71 206,171.63 208,171.07 210,171.07 212,171.63 214,172.71 216,174.22 218,176.03 220,178.00 222,179.97 224,181.78 226,183.29 228,184.37 230,184.93 232,184.93 234,184.37 236,183.29 238,181.78 240,179.97 242,178.00 244,176.03 246,174.22 248,172.71 250,171.63 252,171.07 254,171.07 256,171.63 258,172.71 260,174.22 262,176.03 264,178.00 266,179.97 268,181.78 270,183.29 272,184.37 274,184.93 276,184.93 278,184.37 280,183.29 282,181.78 284,179.97';

/**
 * The dial. Two strobe rings turn clockwise when the note is sharp and the
 * other way when it is flat, faster the further out it is, and stand still in
 * tune. Below the note a sine trace slides the same way against a fixed, dim
 * reference trace; in tune the two lie on top of each other. On E-paper
 * nothing animates: rings and trace sit offset by the error.
 */
export function TunerStrobe({
  cents,
  name,
  octave,
  still,
}: {
  cents: number | null;
  name: string;
  octave: string;
  still: boolean;
}) {
  const windowId = useId();
  const motion = useMotion();
  const rings = useRef<SVGGElement | null>(null);
  const trace = useRef<SVGPolylineElement | null>(null);
  const target = useRef(cents);
  const fixed = still || !motion || typeof requestAnimationFrame !== 'function';
  const moving = !fixed && cents !== null && Math.abs(cents) > 1;
  useEffect(() => {
    target.current = cents !== null && Math.abs(cents) > 1 ? cents : 0;
    // Without motion: half a bar and half a wave out at 50 cents.
    if (!moving)
      place(rings.current, trace.current, (target.current / 100) * 0.5);
  }, [cents, moving]);
  useEffect(() => {
    if (!moving) return;
    let phase = 0;
    let before = performance.now();
    let frame = requestAnimationFrame(function step(now: number) {
      const elapsed = Math.min(0.1, (now - before) / 1000);
      before = now;
      phase += (target.current ?? 0) * DRIFT * elapsed;
      place(rings.current, trace.current, phase);
      frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [moving]);
  return (
    <svg
      className="h-[clamp(7rem,36dvh,22rem)] w-full min-w-0"
      viewBox="0 0 240 240"
      data-idle={cents === null}
    >
      <defs>
        <clipPath id={windowId}>
          <circle cx="120" cy="120" r="80" />
        </clipPath>
      </defs>
      <g
        ref={rings}
        className={
          cents === null
            ? 'fill-none stroke-current opacity-25'
            : 'fill-none stroke-current'
        }
        aria-hidden="true"
      >
        <circle
          cx="120"
          cy="120"
          r="104"
          pathLength={BARS * 2}
          strokeDasharray="1 1"
          strokeWidth="9"
        />
        <circle
          cx="120"
          cy="120"
          r="92"
          pathLength={BARS * 4}
          strokeDasharray="1 1"
          strokeWidth="6"
        />
      </g>
      <path
        className="fill-current"
        d="M113 0 L127 0 L120 11 Z"
        aria-hidden="true"
      />
      <g
        opacity={cents === null ? 0 : 1}
        clipPath={`url(#${windowId})`}
        aria-hidden="true"
      >
        <polyline
          className="fill-none stroke-current opacity-25"
          strokeWidth="2.5"
          points={TRACE}
        />
        <polyline
          ref={trace}
          className="fill-none stroke-current"
          strokeWidth="2.5"
          points={TRACE}
        />
      </g>
      <text
        className="fill-current font-mono text-[64px] font-semibold tracking-tight"
        textAnchor="middle"
        x="120"
        y="138"
        aria-label="Detected note"
      >
        <tspan>{name}</tspan>
        <tspan className="text-[24px] tracking-normal opacity-70" dy="-2">
          {octave}
        </tspan>
      </text>
    </svg>
  );
}

/** Turns the rings and slides the trace; `phase` is in coarse bars passed. */
function place(
  rings: SVGGElement | null,
  trace: SVGPolylineElement | null,
  phase: number,
) {
  rings?.setAttribute(
    'transform',
    `rotate(${(((phase * 360) / BARS) % 360).toFixed(2)} 120 120)`,
  );
  const slide = (((phase * WAVE) % WAVE) + WAVE) % WAVE;
  trace?.setAttribute('transform', `translate(${slide.toFixed(2)} 0)`);
}
