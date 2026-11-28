import { Button } from '../components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { cn } from '../lib/cn';

/**
 * How the chain is being run, as one quiet line in the chain bar's middle:
 * "48 kHz · 128 × 3 · 8.0 ms · NAM Full A2 · 2×". It opens the details with
 * Restart audio and links to Settings › Audio and Settings › NAM engine.
 * Inside a size container (the chain bar's middle is one) it shortens to
 * "48 kHz · 128 × 3" when the room is short and steps aside when there is
 * none; touch tablets and phones leave it out.
 * @see docs/interface.md
 */

export type StreamFigures = {
  sample_rate: number;
  /** Frames per period. */
  period_frames: number;
  periods: number;
};

export type EngineSummary = {
  /** Short, for the line: "NAM Full A2 · 2×". */
  label: string;
  /** For the details: model size, input calibration, oversampling. */
  details: { label: string; value: string }[];
};

const rate = (hz: number) =>
  `${Number.isInteger(hz / 1000) ? hz / 1000 : (hz / 1000).toFixed(1)} kHz`;

/** Device buffer length: period size × periods at the session rate. */
const bufferMs = ({ sample_rate, period_frames, periods }: StreamFigures) =>
  sample_rate > 0 ? (1000 * period_frames * periods) / sample_rate : 0;

function Rows({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt>{r.label}</dt>
          <dd className="m-0 text-right font-mono tabular-nums">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StreamStatus({
  stream,
  engine,
  onRestartAudio,
  onAudioSettings,
  onEngineSettings,
  restarting = false,
  fit = 'container',
  className,
}: {
  stream: StreamFigures;
  /** Left out when the engine does not report a summary. */
  engine?: EngineSummary | null;
  onRestartAudio?: () => void;
  onAudioSettings?: () => void;
  onEngineSettings?: () => void;
  restarting?: boolean;
  /** "container": shortens to its size container; "full": always the whole line. */
  fit?: 'container' | 'full';
  className?: string;
}) {
  const short = `${rate(stream.sample_rate)} · ${stream.period_frames} × ${stream.periods}`;
  const ms = `${bufferMs(stream).toFixed(1)} ms`;
  const full = [short, ms, engine?.label].filter(Boolean).join(' · ');
  const container = fit === 'container';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          title="Stream and engine"
          aria-label={`Stream and engine: ${full}`}
          className={cn(
            'font-mono text-xs font-normal text-muted-foreground tabular-nums max-md:hidden [@media(pointer:coarse)]:hidden',
            container && 'hidden @min-[150px]:inline-flex',
            className,
          )}
        >
          <span className={cn(container && 'hidden @min-[360px]:inline')}>
            {full}
          </span>
          {container && <span className="@min-[360px]:hidden">{short}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="center" className="grid w-80 gap-3">
        <section className="grid gap-1">
          <h3 className="m-0 small-caps text-xs font-medium text-muted-foreground">
            Stream
          </h3>
          <Rows
            rows={[
              { label: 'Sample rate', value: rate(stream.sample_rate) },
              { label: 'Buffer', value: String(stream.period_frames) },
              { label: 'Periods', value: String(stream.periods) },
              { label: 'Buffer time', value: ms },
            ]}
          />
          {(onRestartAudio || onAudioSettings) && (
            <div className="flex flex-wrap gap-2 pt-1">
              {onRestartAudio && (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={restarting}
                  onClick={onRestartAudio}
                >
                  {restarting ? 'Restarting…' : 'Restart audio'}
                </Button>
              )}
              {onAudioSettings && (
                <Button size="xs" variant="ghost" onClick={onAudioSettings}>
                  Settings › Audio
                </Button>
              )}
            </div>
          )}
        </section>
        {engine && (
          <section className="grid gap-1 border-t border-border pt-3">
            <h3 className="m-0 small-caps text-xs font-medium text-muted-foreground">
              NAM engine
            </h3>
            <Rows rows={engine.details} />
            {onEngineSettings && (
              <div className="pt-1">
                <Button size="xs" variant="ghost" onClick={onEngineSettings}>
                  Settings › NAM engine
                </Button>
              </div>
            )}
          </section>
        )}
      </PopoverContent>
    </Popover>
  );
}
