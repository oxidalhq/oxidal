import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import type { VenueBand, VenueSettings } from '../../api';
import {
  BANDS,
  GAIN_LIMIT,
  clamp,
  formatDb,
  formatHz,
  isPass,
  responseCurve,
  roundHz,
} from '../../lib/venueEq';

const LEFT = 34;
const RIGHT = 10;
const TOP = 22;
const BOTTOM = 22;
const RANGE = 15;
const GRID = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const NARROW_LABELS = [20, 100, 1000, 10000];
const gridLabel = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

/** A band change from the graph; `done` is the release (or one key press). */
export type GraphChange = (
  index: number,
  change: Partial<VenueBand>,
  done: boolean,
) => void;

/**
 * The venue EQ's combined magnitude response, 20 Hz–20 kHz on a log axis, with
 * one handle per band. Dragging a handle moves its frequency (and gain for
 * shelves and bells); arrow keys do the same one step at a time. On e-paper the
 * graph redraws on release only.
 * @see docs/media.md
 */
export function EqGraph({
  eq,
  saved,
  edited,
  bypass,
  compare,
  selected,
  locked,
  slow,
  label,
  onSelect,
  onChange,
}: {
  /** What the editor holds: the unsaved edit, or the saved profile. */
  eq: VenueSettings;
  saved: VenueSettings;
  edited: boolean;
  bypass: boolean;
  compare: boolean;
  selected: number;
  locked: boolean;
  slow: boolean;
  label: string;
  onSelect: (index: number) => void;
  onChange: GraphChange;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(320);
  const drag = useRef<{
    index: number;
    pointer: number;
    change: Partial<VenueBand> | null;
  } | null>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth > 0)
        setWidth(Math.max(260, element.clientWidth - 2));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const height = width < 560 ? 190 : 230;
  const x = (hz: number) =>
    LEFT + (Math.log10(hz / 20) / 3) * (width - LEFT - RIGHT);
  const y = (db: number) =>
    TOP +
    ((RANGE - clamp(db, -RANGE, RANGE)) / (2 * RANGE)) *
      (height - TOP - BOTTOM);
  const path = (settings: VenueSettings) =>
    responseCurve(settings)
      .map(
        ([hz, db], i) =>
          `${i ? 'L' : 'M'}${x(hz).toFixed(1)},${y(db).toFixed(1)}`,
      )
      .join('');
  const main = compare ? saved : eq;
  const ghost = edited ? (compare ? eq : saved) : null;

  /** The band change a pointer position means. */
  function changeAt(event: PointerEvent<SVGSVGElement>, index: number) {
    const box = event.currentTarget.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    const band = BANDS[index]!;
    const hz = roundHz(
      clamp(
        20 * 10 ** ((3 * (px - LEFT)) / (width - LEFT - RIGHT)),
        band.minHz,
        band.maxHz,
      ),
    );
    const change: Partial<VenueBand> = { freqHz: hz, enabled: true };
    if (!isPass(index))
      change.gainDb = clamp(
        Math.round(
          (RANGE - ((py - TOP) / (height - TOP - BOTTOM)) * 2 * RANGE) * 2,
        ) / 2,
        -GAIN_LIMIT,
        GAIN_LIMIT,
      );
    return change;
  }
  function end(event: PointerEvent<SVGSVGElement>) {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (current.change) onChange(current.index, current.change, true);
  }
  function key(event: KeyboardEvent<SVGGElement>, index: number) {
    if (locked) return;
    const band = eq.bands[index]!;
    const info = BANDS[index]!;
    const octave = event.shiftKey ? 1 / 24 : 1 / 6;
    let change: Partial<VenueBand> | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = event.key === 'ArrowRight' ? octave : -octave;
      change = {
        freqHz: roundHz(clamp(band.freqHz * 2 ** step, info.minHz, info.maxHz)),
      };
    } else if (
      !isPass(index) &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      const step = event.key === 'ArrowUp' ? 0.5 : -0.5;
      change = {
        gainDb: clamp((band.gainDb ?? 0) + step, -GAIN_LIMIT, GAIN_LIMIT),
      };
    }
    if (!change) return;
    event.preventDefault();
    onSelect(index);
    onChange(index, { ...change, enabled: true }, true);
  }

  const caption = bypass
    ? 'Bypassed: you hear the outputs flat'
    : compare
      ? 'Comparing: you hear the saved profile'
      : edited
        ? 'Solid: what you hear · dashed: saved'
        : '';
  const labels = width < 560 ? NARROW_LABELS : GRID;
  return (
    <div className="venue-graph" ref={host} data-locked={locked || undefined}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`Venue EQ response. ${label}${edited ? ', edited' : ''}${bypass ? ', bypassed' : ''}`}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId) return;
          current.change = changeAt(event, current.index);
          if (!slow) onChange(current.index, current.change, false);
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {GRID.map((hz) => (
          <line
            key={hz}
            x1={x(hz)}
            x2={x(hz)}
            y1={TOP}
            y2={height - BOTTOM}
            className="venue-grid"
          />
        ))}
        {[12, 6, 0, -6, -12].map((db) => (
          <g key={db}>
            <line
              x1={LEFT}
              x2={width - RIGHT}
              y1={y(db)}
              y2={y(db)}
              className={db === 0 ? 'venue-grid venue-zero' : 'venue-grid'}
            />
            <text
              x={LEFT - 6}
              y={y(db) + 4}
              textAnchor="end"
              className="venue-axis"
            >
              {db > 0 ? `+${db}` : db < 0 ? `−${-db}` : '0'}
            </text>
          </g>
        ))}
        {labels.map((hz) => (
          <text
            key={hz}
            x={x(hz)}
            y={height - 6}
            textAnchor="middle"
            className="venue-axis"
          >
            {gridLabel(hz)}
          </text>
        ))}
        {ghost && <path d={path(ghost)} className="venue-curve-ghost" />}
        {bypass ? (
          <>
            <line
              x1={LEFT}
              x2={width - RIGHT}
              y1={y(0)}
              y2={y(0)}
              className="venue-curve"
            />
            <path d={path(main)} className="venue-curve-bypassed" />
          </>
        ) : (
          <path
            d={path(main)}
            className="venue-curve"
            data-testid="venue-curve"
          />
        )}
        {eq.bands.map((band, index) => {
          const info = BANDS[index]!;
          const pass = isPass(index);
          const hx = x(band.freqHz);
          const hy = y(pass ? 0 : (band.gainDb ?? 0));
          const chosen = selected === index;
          const value = pass
            ? `${formatHz(band.freqHz)}${band.enabled ? '' : ', off'}`
            : `${formatHz(band.freqHz)}, ${formatDb(band.gainDb ?? 0)}${band.enabled ? '' : ', off'}`;
          return (
            <g
              key={info.short}
              role="slider"
              tabIndex={locked ? -1 : 0}
              aria-label={`${info.name} handle`}
              aria-valuemin={info.minHz}
              aria-valuemax={info.maxHz}
              aria-valuenow={band.freqHz}
              aria-valuetext={value}
              aria-disabled={locked || undefined}
              className="venue-handle"
              data-selected={chosen || undefined}
              data-off={!band.enabled || undefined}
              onKeyDown={(event) => key(event, index)}
              onFocus={() => onSelect(index)}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                onSelect(index);
                if (locked || drag.current) return;
                event.preventDefault();
                const svg = event.currentTarget.ownerSVGElement;
                svg?.setPointerCapture(event.pointerId);
                drag.current = {
                  index,
                  pointer: event.pointerId,
                  change: null,
                };
              }}
            >
              <circle cx={hx} cy={hy} r={18} className="venue-hit" />
              {pass ? (
                <rect
                  x={hx - 6}
                  y={hy - 6}
                  width={12}
                  height={12}
                  className="venue-dot"
                />
              ) : (
                <circle
                  cx={hx}
                  cy={hy}
                  r={chosen ? 7 : 6}
                  className="venue-dot"
                />
              )}
              <text
                x={hx}
                y={pass ? hy + 20 : hy - 11}
                textAnchor="middle"
                className="venue-handle-label"
                aria-hidden="true"
              >
                {info.short}
              </text>
            </g>
          );
        })}
      </svg>
      {caption && <span className="venue-graph-caption">{caption}</span>}
    </div>
  );
}
