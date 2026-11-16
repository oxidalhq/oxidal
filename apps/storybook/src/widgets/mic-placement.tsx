import * as React from 'react';
import { cn } from '../lib/cn';
import { Caption } from '../components/ui/text';

export type Mic = {
  /** The microphone, as captured (SM57, R121, MD421…). */
  name: string;
  /** 0 = centre of the dust cap, 1 = outer edge of the cone. */
  position: number;
  /** Where around the cone, in degrees; shown only, the sound is the same all round. */
  angle: number;
  /** Distance from the grille, cm. */
  distance: number;
};

const ZONES = [
  { to: 0.22, label: 'Cap' },
  { to: 0.38, label: 'Cap edge' },
  { to: 0.78, label: 'Cone' },
  { to: 1, label: 'Edge' },
];
function zoneOf(position: number) {
  return ZONES.find((z) => position <= z.to)?.label ?? 'Edge';
}

const MAX_CM = 30;
const R = 64; // cone radius in the 160-unit drawing

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Where the microphones sit on the speaker, drawn as you would see them:
 * the speaker from the front (drag a mic from the dust cap out to the
 * edge — bright to dark) and from the side (drag it closer or further —
 * more bass and attack close, more room further back). A second mic is
 * drawn hollow; the blend sets how much of each you hear. Arrow keys move
 * the focused mic: left and right for position or distance, up and down
 * around the cone. The cab picks the captured impulse response nearest to
 * each spot and blends between neighbours.
 */
export function MicPlacement({
  mics,
  onChange,
  blend,
  onBlend,
  compact = false,
  disabled = false,
  className,
}: {
  mics: Mic[];
  onChange: (index: number, mic: Mic) => void;
  /** 0–100: how much of the second mic. */
  blend?: number;
  onBlend?: (blend: number) => void;
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const front = React.useRef<SVGSVGElement>(null);
  const side = React.useRef<SVGSVGElement>(null);
  const [drag, setDrag] = React.useState<{
    mic: number;
    view: 'front' | 'side';
  } | null>(null);

  const fromFront = (index: number, clientX: number, clientY: number) => {
    const box = front.current?.getBoundingClientRect();
    if (!box) return;
    const x = ((clientX - box.left) / box.width) * 160 - 80;
    const y = ((clientY - box.top) / box.height) * 160 - 80;
    const position = clamp(Math.hypot(x, y) / R, 0, 1);
    const angle = (Math.atan2(y, x) * 180) / Math.PI;
    onChange(index, {
      ...mics[index]!,
      position: Math.round(position * 100) / 100,
      angle: Math.round(angle),
    });
  };
  const fromSide = (index: number, clientX: number) => {
    const box = side.current?.getBoundingClientRect();
    if (!box) return;
    const unit =
      clamp(((clientX - box.left) / box.width) * 200 - 30, 0, 160) / 160;
    onChange(index, { ...mics[index]!, distance: Math.round(unit * MAX_CM) });
  };

  const size = compact ? 'w-36' : 'w-44';
  return (
    <div data-slot="mic-placement" className={cn('grid gap-2', className)}>
      <div className="flex flex-wrap items-center gap-3">
        {/* Front: the speaker as you look at it. */}
        <svg
          ref={front}
          viewBox="0 0 160 160"
          className={cn(
            'aspect-square shrink-0 touch-none text-foreground select-none',
            size,
          )}
          role="group"
          aria-label="Speaker, front"
          onPointerMove={(event) =>
            drag?.view === 'front' &&
            fromFront(drag.mic, event.clientX, event.clientY)
          }
          onPointerUp={() => setDrag(null)}
        >
          <circle
            cx="80"
            cy="80"
            r={R + 10}
            className="fill-card stroke-border"
          />
          <circle
            cx="80"
            cy="80"
            r={R}
            className="fill-none stroke-wire"
            strokeWidth="1.5"
          />
          {[0.78, 0.6, 0.45].map((r) => (
            <circle
              key={r}
              cx="80"
              cy="80"
              r={R * r}
              className="fill-none stroke-wire/50"
              strokeDasharray="2 3"
            />
          ))}
          <circle
            cx="80"
            cy="80"
            r={R * 0.22}
            className="fill-muted stroke-wire"
          />
          <line
            x1="80"
            y1="80"
            x2={80 + R}
            y2="80"
            className="stroke-wire/40"
          />
          {mics.map((mic, i) => {
            const x =
              80 + Math.cos((mic.angle * Math.PI) / 180) * mic.position * R;
            const y =
              80 + Math.sin((mic.angle * Math.PI) / 180) * mic.position * R;
            return (
              <g
                key={i}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                aria-label={`${mic.name}, position on the speaker`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(mic.position * 100)}
                aria-valuetext={`${zoneOf(mic.position)}, ${Math.round(mic.position * 100)}% from the centre`}
                className="cursor-grab outline-none focus-visible:[&>circle:first-child]:stroke-ring"
                onPointerDown={(event) => {
                  if (disabled) return;
                  (
                    event.currentTarget.ownerSVGElement ?? event.currentTarget
                  ).setPointerCapture?.(event.pointerId);
                  setDrag({ mic: i, view: 'front' });
                }}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 0.01 : 0.05;
                  const change =
                    event.key === 'ArrowRight'
                      ? { position: clamp(mic.position + step, 0, 1) }
                      : event.key === 'ArrowLeft'
                        ? { position: clamp(mic.position - step, 0, 1) }
                        : event.key === 'ArrowUp'
                          ? { angle: mic.angle - 15 }
                          : event.key === 'ArrowDown'
                            ? { angle: mic.angle + 15 }
                            : null;
                  if (!change) return;
                  event.preventDefault();
                  onChange(i, {
                    ...mic,
                    ...change,
                    position:
                      Math.round((change.position ?? mic.position) * 100) / 100,
                  });
                }}
              >
                <circle
                  cx={x}
                  cy={y}
                  r="14"
                  className="fill-transparent stroke-transparent"
                  strokeWidth="3"
                />
                <circle
                  cx={x}
                  cy={y}
                  r="7"
                  className={cn(
                    'stroke-foreground',
                    i === 0 ? 'fill-foreground' : 'fill-card',
                  )}
                  strokeWidth="2.5"
                />
                <text
                  x={x}
                  y={y - 11}
                  textAnchor="middle"
                  className="fill-foreground text-[9px] font-semibold"
                >
                  {i === 0 ? 'A' : 'B'}
                </text>
              </g>
            );
          })}
        </svg>
        {/* Side: distance from the grille. */}
        <div className="grid min-w-40 flex-1 gap-1">
          <svg
            ref={side}
            viewBox="0 0 200 60"
            className="h-16 w-full touch-none select-none"
            role="group"
            aria-label="Speaker, side"
            onPointerMove={(event) =>
              drag?.view === 'side' && fromSide(drag.mic, event.clientX)
            }
            onPointerUp={() => setDrag(null)}
          >
            <rect
              x="0"
              y="4"
              width="22"
              height="52"
              rx="2"
              className="fill-card stroke-border"
            />
            <line
              x1="30"
              y1="4"
              x2="30"
              y2="56"
              className="stroke-wire"
              strokeDasharray="2 2"
            />
            {[0, 10, 20, 30].map((cm) => (
              <text
                key={cm}
                x={30 + (cm / MAX_CM) * 160}
                y="58"
                textAnchor="middle"
                className="fill-muted-foreground text-[7px]"
              >
                {cm}
              </text>
            ))}
            {mics.map((mic, i) => {
              const x = 30 + (mic.distance / MAX_CM) * 160;
              const y = i === 0 ? 20 : 36;
              return (
                <g
                  key={i}
                  role="slider"
                  tabIndex={disabled ? -1 : 0}
                  aria-label={`${mic.name}, distance from the grille`}
                  aria-valuemin={0}
                  aria-valuemax={MAX_CM}
                  aria-valuenow={mic.distance}
                  aria-valuetext={`${mic.distance} cm`}
                  className="cursor-grab outline-none focus-visible:[&>rect]:stroke-ring"
                  onPointerDown={(event) => {
                    if (disabled) return;
                    (
                      event.currentTarget.ownerSVGElement ?? event.currentTarget
                    ).setPointerCapture?.(event.pointerId);
                    setDrag({ mic: i, view: 'side' });
                  }}
                  onKeyDown={(event) => {
                    const by =
                      event.key === 'ArrowRight'
                        ? 1
                        : event.key === 'ArrowLeft'
                          ? -1
                          : 0;
                    if (!by) return;
                    event.preventDefault();
                    onChange(i, {
                      ...mic,
                      distance: clamp(
                        mic.distance + by * (event.shiftKey ? 1 : 2),
                        0,
                        MAX_CM,
                      ),
                    });
                  }}
                >
                  <rect
                    x={x}
                    y={y - 5}
                    width="34"
                    height="10"
                    rx="5"
                    className={cn(
                      'stroke-foreground',
                      i === 0 ? 'fill-foreground' : 'fill-card',
                    )}
                    strokeWidth="2"
                  />
                  <line
                    x1={x + 34}
                    y1={y}
                    x2="200"
                    y2={y}
                    className="stroke-wire"
                  />
                </g>
              );
            })}
          </svg>
          <dl className="m-0 grid gap-0.5">
            {mics.map((mic, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <dt className="flex items-center gap-1.5 font-medium">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-block size-2.5 rounded-full border-2 border-foreground',
                      i === 0 ? 'bg-foreground' : 'bg-card',
                    )}
                  />
                  {i === 0 ? 'A' : 'B'} · {mic.name}
                </dt>
                <dd className="m-0 font-mono text-xs tabular-nums">
                  {zoneOf(mic.position)} · {mic.distance} cm
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      {mics.length > 1 && onBlend && blend !== undefined && (
        <label className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 text-sm">
          <span className="font-medium">A</span>
          <input
            type="range"
            min={0}
            max={100}
            value={blend}
            aria-label="Blend of mic A and mic B"
            aria-valuetext={`${100 - blend}% A, ${blend}% B`}
            onChange={(e) => onBlend(Number(e.target.value))}
            className="accent-[var(--foreground)]"
          />
          <span className="font-medium">B</span>
        </label>
      )}
      {!compact && (
        <Caption className="text-xs">
          Cap is brightest; the edge is darkest. Closer gives more bass and
          attack; further back adds air.
        </Caption>
      )}
    </div>
  );
}
