import { Metronome } from '@phosphor-icons/react';
import * as React from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { cn } from '../lib/cn';
import { tempoFromTaps } from '../lib/tempo';

/**
 * Tap tempo with the tempo shown large; the beat light pulses at the tempo.
 * "From track" sets it from the backing track's beat grid when there is one.
 */
export function TapTempo({
  bpm,
  onBpm,
  trackBpm,
  size = 'md',
  className,
}: {
  bpm: number;
  onBpm: (bpm: number) => void;
  trackBpm?: number;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const taps = React.useRef<number[]>([]);
  const [beat, setBeat] = React.useState(false);
  React.useEffect(() => {
    const timer = setInterval(
      () => {
        setBeat(true);
        setTimeout(() => setBeat(false), 90);
      },
      60000 / Math.max(30, bpm),
    );
    return () => clearInterval(timer);
  }, [bpm]);
  return (
    <div
      data-slot="tap-tempo"
      className={cn('flex items-center gap-2', className)}
    >
      <Button
        variant="outline"
        size={size === 'lg' ? 'lg' : 'md'}
        aria-label={`Tap tempo, now ${Math.round(bpm)} BPM`}
        onClick={() => {
          const now = performance.now();
          const last = taps.current[taps.current.length - 1];
          taps.current =
            last && now - last > 2000
              ? [now]
              : [...taps.current.slice(-7), now];
          const next = tempoFromTaps(taps.current);
          if (next && next >= 30 && next <= 300) onBpm(next);
        }}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-2.5 rounded-full border border-current transition-colors duration-75',
            beat ? 'border-brand bg-brand' : 'bg-transparent',
          )}
        />
        <Metronome /> Tap
      </Button>
      <span className="grid leading-none">
        <span
          className={cn(
            'font-mono font-semibold tabular-nums',
            size === 'lg' ? 'text-2xl' : 'text-lg',
          )}
        >
          {Math.round(bpm)}
        </span>
        <span className="small-caps text-xs text-muted-foreground">BPM</span>
      </span>
      {trackBpm && Math.round(trackBpm) !== Math.round(bpm) && (
        <button
          type="button"
          onClick={() => onBpm(trackBpm)}
          className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Badge>From track {trackBpm}</Badge>
        </button>
      )}
    </div>
  );
}
