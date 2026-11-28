import { useEffect, useRef, useState } from 'react';

import { Button } from '../components/ui/button';
import { ActionRow } from '../components/ui/form-layout';
import { Progress } from '../components/ui/states';
import { Caption, Title } from '../components/ui/text';
import {
  LoudnessStrip,
  LoudnessTable,
  type MeasuredSound,
} from './loudness-table';
import { SettingDisclosure } from './settings-page';

export type EvenOutAction = 'run' | 'run_all' | 'cancel' | 'reset';

/** Where a measuring run is, as the device reports it. */
export type EvenOutProgress = {
  running: boolean;
  done: number;
  total: number;
  current?: string | null;
  measured?: number;
  failed?: string[] | null;
  error?: string | null;
};

/**
 * Even out all: one riff through every preset and scene, each set to the
 * same loudness. The actions sit together; "Show each sound" opens the
 * table right under them and scrolls it into view, and the strip shows the
 * whole set around the target in one line. Shared by Levels › Loudness and
 * its story; the app passes the device's state and runs the actions.
 * @see docs/audio.md
 */
export function EvenOutPanel({
  sounds,
  target,
  pending,
  progress,
  connected = true,
  error,
  onAction,
}: {
  sounds: MeasuredSound[];
  /** The common level in LUFS, once a run has set one. */
  target: number | null;
  /** New or changed sounds waiting to be measured. */
  pending: number;
  progress: EvenOutProgress;
  connected?: boolean;
  error?: string;
  onAction: (action: EvenOutAction) => void;
}) {
  const [details, setDetails] = useState(false);
  const table = useRef<HTMLDivElement>(null);
  // What "Show each sound" opened must be seen, not left below the fold.
  useEffect(() => {
    if (details)
      table.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [details]);
  const running = progress.running;
  const levels = sounds.map((s) => s.lufs + s.offset_db);
  const spread = levels.length
    ? Math.max(...levels) - Math.min(...levels)
    : null;
  const target_lufs = target;
  const summary =
    target_lufs == null
      ? 'Not evened out yet: each preset plays at its own level.'
      : pending
        ? `${sounds.length} measured at ${target_lufs.toFixed(1)} LUFS; ${pending} new or changed ${pending === 1 ? 'sound needs' : 'sounds need'} Even Out.`
        : `${sounds.length} presets and scenes evened out to ${target_lufs.toFixed(1)} LUFS.`;
  return (
    <section
      className="grid gap-3 rounded-lg border border-border bg-card p-4"
      aria-label="Even out all"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <Title as="h2" size="sm">
            Even out all
          </Title>
          <Caption>
            Plays one riff through every preset and scene and sets each to the
            same loudness, so changing presets never jumps.
          </Caption>
        </div>
        {!running && (
          <Button
            variant="outline"
            disabled={!connected}
            onClick={() => onAction('run')}
          >
            {pending ? `Even out ${pending} new or changed` : 'Even out all'}
          </Button>
        )}
      </div>
      {running ? (
        <>
          <p role="status">
            Measuring in the background:{' '}
            {Math.min(progress.done + 1, progress.total)} of {progress.total}
            {progress.current ? `: ${progress.current}` : ''}…
          </p>
          <Progress
            label="Evening out"
            value={
              progress.total
                ? (100 * progress.done) / progress.total
                : undefined
            }
            aria-valuetext={`${progress.done} of ${progress.total}`}
          />
          <Button variant="outline" onClick={() => onAction('cancel')}>
            Stop measuring
          </Button>
        </>
      ) : (
        <>
          {sounds.length > 0 && (
            <ActionRow>
              <Button
                variant="outline"
                aria-expanded={details}
                aria-controls="even-out-levels"
                onClick={() => setDetails((v) => !v)}
              >
                {details
                  ? 'Hide each sound'
                  : `Show each sound (${sounds.length})`}
              </Button>
              <Button
                variant="outline"
                disabled={!connected}
                onClick={() => onAction('run_all')}
              >
                Measure all again
              </Button>
              <Button
                variant="outline"
                disabled={!connected}
                onClick={() => onAction('reset')}
              >
                Reset
              </Button>
            </ActionRow>
          )}
          {details && (
            <div id="even-out-levels" ref={table} className="scroll-mt-24">
              <LoudnessTable sounds={sounds} target={target} />
            </div>
          )}
          <Caption>{summary}</Caption>
          {spread != null && (
            <>
              <p className="m-0 text-sm">
                Loudest to quietest: {spread.toFixed(1)} dB
              </p>
              {target != null && (
                <LoudnessStrip sounds={sounds} target={target} />
              )}
              <Caption>
                Each tick is one preset or scene after its stored correction.
              </Caption>
            </>
          )}
          <SettingDisclosure label="How it works">
            <Caption>
              Plays a built-in riff through each new or changed preset and scene
              at Oxidal's fixed factory level in a separate background worker.
              You can keep playing your current rig while it measures.
              Measurements follow the Mono or Stereo output setting. Changing it
              requires measuring again. Your guitar profile does not change the
              result. Oxidal chooses a reachable common level within its
              correction range. Boost remains a separate control. This is a
              reference-riff estimate; playing dynamics and long effect tails
              can still change perceived loudness.
            </Caption>
          </SettingDisclosure>

          {progress.total > 0 &&
            !progress.error &&
            !progress.failed?.length && (
              <p role="status">
                {progress.measured
                  ? `Measured ${progress.measured}; the rest were already even.`
                  : 'Everything was already even.'}
              </p>
            )}
        </>
      )}
      {!running && !!progress.failed?.length && (
        <div role="alert">
          <p>
            {progress.failed.length === 1
              ? 'One could not be measured:'
              : `${progress.failed.length} could not be measured:`}
          </p>
          <Caption as="ul">
            {progress.failed.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </Caption>
        </div>
      )}
      {progress.error && <p role="alert">{progress.error}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
