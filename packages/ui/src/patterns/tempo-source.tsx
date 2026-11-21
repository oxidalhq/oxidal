import { Button } from '../components/ui/button';

type Source = 'tap' | 'song' | 'preset';
export interface PerformanceTempo {
  source: Source;
  bpm?: number | null;
  reason?: string | null;
}
export function TempoSource({
  state,
  disabled,
  onSelect,
}: {
  state?: PerformanceTempo;
  disabled?: boolean;
  onSelect: (source: Source) => void;
}) {
  const labels = { tap: 'Tap', song: 'Song', preset: 'Preset' };
  return (
    <section aria-label="Performance tempo" className="space-y-2">
      <p aria-live="polite">
        <strong>
          {state ? labels[state.source] + ' tempo' : 'Tempo unavailable'}
        </strong>
        {state?.bpm != null && ' · ' + Number(state.bpm.toFixed(1)) + ' BPM'}
        {state?.reason && ' · ' + state.reason}
      </p>
      <div
        role="group"
        aria-label="Tempo source"
        className="flex flex-wrap gap-2"
      >
        {(['tap', 'song', 'preset'] as const).map((source) => (
          <Button
            key={source}
            variant="outline"
            aria-pressed={state?.source === source}
            disabled={disabled || !state}
            onClick={() => onSelect(source)}
          >
            {source === 'tap' ? 'Tap tempo' : labels[source]}
          </Button>
        ))}
      </div>
    </section>
  );
}
