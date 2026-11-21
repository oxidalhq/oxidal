import { cn } from '@oxidal/design-system/lib/cn';
import { blockPanelVisualClass } from '@oxidal/design-system/widgets/selected-block-panel';

import type { AudioState } from './api';
import { formatDb, formatHz } from './lib/venueEq';

type Bands = NonNullable<AudioState['eq']>[number]['eq']['bands'];

/** Frequency and gain are confirmed settings for the six native EQ bands. */
export function BlockBandGains({
  bands,
  enabled,
  compact,
  onOpen,
}: {
  bands: Bands;
  enabled: boolean;
  compact?: boolean;
  onOpen: () => void;
}) {
  const points = bands.map((band) => ({
    x: Math.min(97, Math.max(3, (100 * Math.log10(band.freqHz / 20)) / 3)),
    y: 50 - Math.min(15, Math.max(-15, band.gainDb)) * 3,
  }));
  return (
    <button
      type="button"
      aria-label={`EQ band gains${enabled ? '' : ' · bypassed'} · Edit bands`}
      aria-haspopup="dialog"
      onClick={onOpen}
      className={cn(
        'block w-full text-left',
        blockPanelVisualClass,
        compact && 'h-20',
      )}
    >
      <span className="small-caps text-xs text-muted-foreground">
        EQ band gains{enabled ? '' : ' · bypassed'}
      </span>
      <span className={`relative block ${compact ? 'h-12' : 'h-24'}`}>
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
        {points.map((point, index) => (
          <span
            key={index}
            title={`${formatHz(bands[index]!.freqHz)} · ${formatDb(bands[index]!.gainDb)}`}
            className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground bg-background"
            style={{ left: point.x + '%', top: point.y + '%' }}
          />
        ))}
      </span>
    </button>
  );
}
