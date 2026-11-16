import type { BlockKind } from './chain';

export type BlockValues = Record<string, number>;

const W = 160;
const H = 56;

function path(points: [number, number][]) {
  return points
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');
}

function bell(x: number, centre: number, width: number) {
  const d = (x - centre) / width;
  return Math.exp(-d * d);
}

/** Tone stack: bass, mid, treble and presence bend a flat line. */
function AmpCurve({ values }: { values: BlockValues }) {
  const v = (id: string) => ((values[id] ?? 5) - 5) / 5; // −1 … 1
  const points: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const x = i / 40; // log-ish frequency axis
    const gain =
      v('bass') * bell(x, 0.15, 0.18) +
      v('mid') * bell(x, 0.5, 0.2) * 0.9 +
      v('treble') * bell(x, 0.8, 0.16) +
      v('presence') * bell(x, 0.95, 0.1) * 0.7;
    points.push([x * W, H / 2 - gain * (H / 2 - 6)]);
  }
  const drive = (values.gain ?? 5) / 10;
  return (
    <>
      <line
        x1="0"
        y1={H / 2}
        x2={W}
        y2={H / 2}
        className="stroke-wire/50"
        strokeDasharray="2 3"
      />
      <path
        d={path(points)}
        fill="none"
        className="stroke-current"
        strokeWidth={1.5 + drive}
        strokeLinejoin="round"
      />
    </>
  );
}

/** Cabinet: a speaker's band, shaped by the low and high cuts. */
function CabCurve({ values }: { values: BlockValues }) {
  const low = Math.log10((values.lowcut ?? 80) / 20) / Math.log10(1000); // 0…1 over 20 Hz–20 kHz
  const high = Math.log10((values.highcut ?? 8000) / 20) / Math.log10(1000);
  const points: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const x = i / 48;
    const body = 0.75 + 0.25 * Math.sin(x * 9) * bell(x, 0.55, 0.3);
    const cut =
      Math.min(1, Math.max(0, (x - low) * 12)) *
      Math.min(1, Math.max(0, (high - x) * 12));
    points.push([x * W, H - 4 - body * cut * (H - 10)]);
  }
  return (
    <>
      <path
        d={`${path(points)} L${W} ${H - 4} L0 ${H - 4} Z`}
        className="fill-current/10"
      />
      <path
        d={path(points)}
        fill="none"
        className="stroke-current"
        strokeWidth={1.5}
      />
    </>
  );
}

/** Delay: repeats spaced by time, shrinking by feedback. */
function DelayTaps({ values }: { values: BlockValues }) {
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
      <line x1="0" y1={H - 4} x2={W} y2={H - 4} className="stroke-wire/50" />
      {taps.map((tap, i) => (
        <rect
          key={i}
          x={tap.x - 2}
          y={H - 4 - tap.h * (H - 10)}
          width="4"
          height={tap.h * (H - 10)}
          rx="1"
          className={i ? 'fill-current/70' : 'fill-current'}
        />
      ))}
    </>
  );
}

/** Reverb: the tail's envelope, longer with decay, fuller with size. */
function ReverbTail({ values }: { values: BlockValues }) {
  const decay = Math.min(1, ((values.decay ?? 3) / 12) ** 0.6);
  const size = (values.size ?? 5) / 10;
  const mix = (values.mix ?? 30) / 100;
  const pre = Math.min(0.2, (values.predelay ?? 0) / 500);
  const points: [number, number][] = [[0, H - 4]];
  for (let i = 0; i <= 48; i++) {
    const x = i / 48;
    const t = Math.max(0, x - pre);
    const env =
      x < pre
        ? 0
        : Math.exp(-t / (0.15 + decay * 1.2)) *
          (0.4 + size * 0.6) *
          (0.3 + mix * 0.7);
    points.push([x * W, H - 4 - env * (H - 10)]);
  }
  return (
    <>
      <path
        d={`${path(points)} L${W} ${H - 4} Z`}
        className="fill-current/10"
      />
      <path
        d={path(points)}
        fill="none"
        className="stroke-current"
        strokeWidth={1.5}
      />
    </>
  );
}

/** Modulation: the LFO, faster with rate, taller with depth. */
function ModWave({ values }: { values: BlockValues }) {
  const rate = 1 + ((values.rate ?? 2) / 10) * 5;
  const depth = (values.depth ?? 5) / 10;
  const points: [number, number][] = [];
  for (let i = 0; i <= 64; i++) {
    const x = i / 64;
    points.push([
      x * W,
      H / 2 - Math.sin(x * Math.PI * 2 * rate) * depth * (H / 2 - 6),
    ]);
  }
  return (
    <path
      d={path(points)}
      fill="none"
      className="stroke-current"
      strokeWidth={1.5}
    />
  );
}

/** Drive: the transfer curve, harder with drive. */
function DriveCurve({ values }: { values: BlockValues }) {
  const drive = 0.5 + ((values.drive ?? 4) / 10) * 6;
  const points: [number, number][] = [];
  for (let i = 0; i <= 48; i++) {
    const x = i / 48;
    const y = Math.tanh((x * 2 - 1) * drive) / Math.tanh(drive);
    points.push([x * W, H / 2 - y * (H / 2 - 6)]);
  }
  return (
    <>
      <line
        x1="0"
        y1={H - 6}
        x2={W}
        y2={6}
        className="stroke-wire/50"
        strokeDasharray="2 3"
      />
      <path
        d={path(points)}
        fill="none"
        className="stroke-current"
        strokeWidth={1.5}
      />
    </>
  );
}

/** Gate: a signal with the threshold drawn across it. */
function GateLine({ values }: { values: BlockValues }) {
  const threshold =
    1 - Math.min(1, Math.max(0, ((values.threshold ?? -48) + 80) / 80));
  const bars = Array.from(
    { length: 24 },
    (_, i) => 0.15 + 0.85 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.4)),
  );
  const y = 6 + threshold * (H - 12);
  return (
    <>
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
            rx="1"
            className={open ? 'fill-current/80' : 'fill-wire/40'}
          />
        );
      })}
      <line
        x1="0"
        y1={y}
        x2={W}
        y2={y}
        className="stroke-brand"
        strokeWidth={1.5}
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
  const body =
    which === 'amp' ? (
      <AmpCurve values={values} />
    ) : which === 'cab' ? (
      <CabCurve values={values} />
    ) : which === 'delay' ? (
      <DelayTaps values={values} />
    ) : which === 'reverb' ? (
      <ReverbTail values={values} />
    ) : which === 'mod' ? (
      <ModWave values={values} />
    ) : which === 'drive' || which === 'pedal' ? (
      <DriveCurve values={values} />
    ) : which === 'gate' ? (
      <GateLine values={values} />
    ) : (
      <AmpCurve values={values} />
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
      {body}
    </svg>
  );
}
