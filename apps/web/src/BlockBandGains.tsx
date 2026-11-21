import { type ReactNode, useState } from 'react';

import type { AudioState } from './api';
import { formatDb, formatHz } from './lib/venueEq';

type Bands = NonNullable<AudioState['eq']>[number]['eq']['bands'];

/** Frequency and gain are confirmed settings for the six native EQ bands. */
export function BlockBandGains({
  bands,
  enabled,
  children,
}: {
  bands: Bands;
  enabled: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const points = bands.map((band) => ({
    x: Math.min(97, Math.max(3, (100 * Math.log10(band.freqHz / 20)) / 3)),
    y: 50 - Math.min(15, Math.max(-15, band.gainDb)) * 3,
  }));
  return (
    <div className="native-eq-preview min-w-0">
      <button
        type="button"
        aria-label={`EQ band gains${enabled ? '' : ' · bypassed'} · Edit bands`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="block w-full rounded-lg border border-border bg-background p-2 text-left"
      >
        <span className="small-caps text-xs text-muted-foreground">
          EQ band gains{enabled ? '' : ' · bypassed'}
        </span>
        <span className="relative block h-24">
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full"
          >
            {[25, 50, 75].map((y) => (
              <line
                key={y}
                x1="0"
                x2="100"
                y1={y}
                y2={y}
                stroke="currentColor"
                opacity=".2"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="2 3"
              />
            ))}
            <polyline
              points={points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {points.map((p, i) => (
            <span
              key={i}
              title={`${formatHz(bands[i]!.freqHz)} · ${formatDb(bands[i]!.gainDb)}`}
              className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground bg-background"
              style={{ left: p.x + '%', top: p.y + '%' }}
            />
          ))}
        </span>
      </button>
      {open && children}
    </div>
  );
}
