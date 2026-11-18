import * as React from 'react';
import type { BlockKind } from './chain';

export type BlockValues = Record<string, number>;

type Drawing = { values: BlockValues; fill: string };

const W = 160;
const H = 56;

type Point = [number, number];

/** A smooth line through the points (a Catmull-Rom spline as Béziers), with no corners. */
function path(points: Point[]) {
  if (points.length < 3)
    return points
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(' ');
  const out = [`M${points[0]![0].toFixed(2)} ${points[0]![1].toFixed(2)}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    const c1: Point = [
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
    ];
    const c2: Point = [
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
    ];
    out.push(
      `C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`,
    );
  }
  return out.join(' ');
}

/** The line itself: one weight at any size, with round ends. */
const LINE = {
  fill: 'none',
  className: 'stroke-current',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  vectorEffect: 'non-scaling-stroke',
} as const;

/** A quiet dotted grid behind every drawing, so a curve has a scale to read against. */
function Grid({ centre = false }: { centre?: boolean }) {
  return (
    <g
      className="stroke-wire/45"
      strokeWidth={1}
      strokeDasharray="1 4"
      strokeLinecap="round"
      vectorEffect="non-scaling-stroke"
    >
      {[0.25, 0.5, 0.75].map((y) => (
        <line
          key={`h${y}`}
          x1="0"
          x2={W}
          y1={4 + y * (H - 8)}
          y2={4 + y * (H - 8)}
          vectorEffect="non-scaling-stroke"
          strokeDasharray={centre && y === 0.5 ? '4 4' : undefined}
        />
      ))}
      {[0.2, 0.4, 0.6, 0.8].map((x) => (
        <line
          key={`v${x}`}
          x1={x * W}
          x2={x * W}
          y1="4"
          y2={H - 4}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
}

function bell(x: number, centre: number, width: number) {
  const d = (x - centre) / width;
  return Math.exp(-d * d);
}

/** The block's EQ: bass, middle and treble bend a flat line. */
function AmpCurve({ values, fill }: Drawing) {
  const v = (id: string) => ((values[id] ?? 5) - 5) / 5; // −1 … 1
  const points: Point[] = [];
  for (let i = 0; i <= 40; i++) {
    const x = i / 40; // log-ish frequency axis
    const gain =
      v('bass') * bell(x, 0.15, 0.18) +
      v('mid') * bell(x, 0.5, 0.2) * 0.9 +
      v('treble') * bell(x, 0.8, 0.16);
    points.push([x * W, H / 2 - gain * (H / 2 - 6)]);
  }
  return (
    <>
      <Grid centre />
      <path d={`${path(points)} L${W} ${H} L0 ${H} Z`} fill={fill} />
      <path d={path(points)} {...LINE} />
    </>
  );
}

/** Delay: repeats spaced by time, shrinking by feedback. */
function DelayTaps({ values }: Drawing) {
  const spacing = Math.max(
    8,
    Math.min(60, ((values.time ?? 380) / 2000) * 120),
  );
  const feedback = (values.feedback ?? 35) / 100;
  const mix = (values.mix ?? 25) / 100;
  const taps: { x: number; h: number }[] = [{ x: 6, h: 1 }];
  let level = mix;
  for (let x = 6 + spacing; x < W - 4 && level > 0.03; x += spacing) {
    taps.push({ x, h: level });
    level *= feedback;
  }
  return (
    <>
      <Grid />
      {taps.length > 2 && (
        // How the repeats die away: a fine dashed line over their tops.
        <path
          d={path(
            taps.slice(1).map((t): Point => [t.x, H - 4 - t.h * (H - 10)]),
          )}
          fill="none"
          className="stroke-current/50"
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {taps.map((tap, i) => (
        <rect
          key={i}
          x={tap.x - 2.5}
          y={H - 4 - tap.h * (H - 10)}
          width="5"
          height={tap.h * (H - 10)}
          rx="2.5"
          className={i ? 'fill-current/75' : 'fill-current'}
        />
      ))}
    </>
  );
}

/** Reverb: the tail's envelope, longer with decay, fuller with size. */
function ReverbTail({ values, fill }: Drawing) {
  const decay = Math.min(1, ((values.decay ?? 3) / 12) ** 0.6);
  const size = (values.size ?? 5) / 10;
  const mix = (values.mix ?? 30) / 100;
  const pre = Math.min(0.2, (values.predelay ?? 0) / 500);
  const points: Point[] = [];
  for (let i = 0; i <= 96; i++) {
    const x = i / 96;
    const t = Math.max(0, x - pre);
    // The room builds up for a moment, then dies away.
    const env =
      x < pre
        ? 0
        : (1 - Math.exp(-t / (0.012 + size * 0.03))) *
          Math.exp(-t / (0.15 + decay * 1.2)) *
          (0.4 + size * 0.6) *
          (0.3 + mix * 0.7);
    points.push([x * W, H - 4 - env * (H - 10)]);
  }
  return (
    <>
      <Grid />
      <path d={`${path(points)} L${W} ${H - 4} L0 ${H - 4} Z`} fill={fill} />
      <path d={path(points)} {...LINE} />
    </>
  );
}

/** Modulation: the LFO, faster with rate, taller with depth. */
function ModWave({ values, fill }: Drawing) {
  const rate = 1 + ((values.rate ?? 2) / 10) * 5;
  const depth = (values.depth ?? 5) / 10;
  const points: Point[] = [];
  for (let i = 0; i <= 64; i++) {
    const x = i / 64;
    points.push([
      x * W,
      H / 2 - Math.sin(x * Math.PI * 2 * rate) * depth * (H / 2 - 6),
    ]);
  }
  return (
    <>
      <Grid centre />
      <path d={`${path(points)} L${W} ${H / 2} L0 ${H / 2} Z`} fill={fill} />
      <path d={path(points)} {...LINE} />
    </>
  );
}

/** Drive: the transfer curve, harder with drive. */
function DriveCurve({ values, fill }: Drawing) {
  const drive = 0.5 + ((values.drive ?? 4) / 10) * 6;
  const points: Point[] = [];
  for (let i = 0; i <= 48; i++) {
    const x = i / 48;
    const y = Math.tanh((x * 2 - 1) * drive) / Math.tanh(drive);
    points.push([x * W, H / 2 - y * (H / 2 - 6)]);
  }
  return (
    <>
      <Grid centre />
      <line
        x1="0"
        y1={H - 6}
        x2={W}
        y2={6}
        className="stroke-wire"
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
      />
      <path d={`${path(points)} L${W} ${H} L0 ${H} Z`} fill={fill} />
      <path d={path(points)} {...LINE} />
    </>
  );
}

/** Gate: a signal with the threshold drawn across it. */
function GateLine({ values }: Drawing) {
  const threshold =
    1 - Math.min(1, Math.max(0, ((values.threshold ?? -48) + 80) / 80));
  const bars = Array.from(
    { length: 24 },
    (_, i) => 0.15 + 0.85 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.4)),
  );
  const y = 6 + threshold * (H - 12);
  return (
    <>
      <Grid />
      <rect x="0" y={y} width={W} height={H - y} className="fill-brand/5" />
      {bars.map((h, i) => {
        const top = H / 2 - (h * (H - 12)) / 2;
        const open = top < y;
        return (
          <rect
            key={i}
            x={i * (W / 24) + 1}
            y={top}
            width={W / 24 - 2}
            height={h * (H - 12)}
            rx="2"
            className={open ? 'fill-current/85' : 'fill-wire/50'}
          />
        );
      })}
      <line
        x1="0"
        y1={y}
        x2={W}
        y2={y}
        className="stroke-brand"
        strokeWidth={2}
        strokeDasharray="6 4"
        vectorEffect="non-scaling-stroke"
      />
    </>
  );
}

/**
 * A small drawing of what a block's values do: a tone stack, a cabinet's
 * band, delay repeats, a reverb tail, an LFO, a drive curve, a gate's
 * threshold. Data, not decoration: every line moves with a control.
 */
export function BlockVisual({
  kind,
  role,
  values,
  className,
}: {
  kind: BlockKind;
  /** The block's role when its kind is broad: 'reverb' | 'delay' | 'drive' | 'gate'. */
  role?: string;
  values: BlockValues;
  className?: string;
}) {
  const which = role ?? kind;
  const gradient = React.useId();
  const fill = `url(#${gradient})`;
  const body =
    which === 'amp' || which === 'cab' || which === 'capture' ? (
      <AmpCurve values={values} fill={fill} />
    ) : which === 'delay' ? (
      <DelayTaps values={values} fill={fill} />
    ) : which === 'reverb' ? (
      <ReverbTail values={values} fill={fill} />
    ) : which === 'mod' ? (
      <ModWave values={values} fill={fill} />
    ) : which === 'drive' || which === 'pedal' ? (
      <DriveCurve values={values} fill={fill} />
    ) : which === 'gate' ? (
      <GateLine values={values} fill={fill} />
    ) : (
      <AmpCurve values={values} fill={fill} />
    );
  return (
    <svg
      data-slot="block-visual"
      data-kind={which}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className={className}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.14} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      {body}
    </svg>
  );
}
