import { Caption } from '../components/ui/text';
import { cn } from '../lib/cn';
import type { BlockSource } from './block-source';

const lengthOf = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;

/**
 * What a cab block's IR is, from the WAV file itself: an IR is a fixed
 * recording of a cabinet, from TONE3000 or uploaded by the player, so there is
 * no microphone to move. Another sound is another IR, or two on parallel paths.
 */
export function IrFacts({
  source,
  hint = false,
  className,
}: {
  source?: BlockSource;
  /** Also say how to change the sound. */
  hint?: boolean;
  className?: string;
}) {
  const audio = source?.kind === 'file' ? source.audio : undefined;
  const from = source?.kind === 'tone3000' ? 'From TONE3000' : 'Your IR';
  const facts = audio
    ? [
        `${audio.sampleRate / 1000} kHz`,
        `${audio.bits}-bit`,
        audio.channels === 1 ? 'mono' : `${audio.channels} channels`,
        lengthOf(audio.durationMs),
      ]
    : [];
  return (
    <div data-slot="ir-facts" className={cn('grid gap-0.5', className)}>
      <span className="font-mono text-xs tabular-nums">
        {[from, ...facts].join(' · ')}
      </span>
      {hint && (
        <Caption className="text-xs">
          To change the sound, choose another IR with Change…, or blend two cabs
          on parallel paths.
        </Caption>
      )}
    </div>
  );
}
