import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { ActionRow } from '@oxidal/design-system/components/form-layout';
import { Progress } from '@oxidal/design-system/components/states';
import { Caption, Title } from '@oxidal/design-system/components/text';
import { PresetLoudnessChart } from '@oxidal/design-system/patterns/guitar-tools';

import {
  calibration,
  type CalibrationCoverage,
  calibrationCoverage,
  type CalibrationState,
} from './api';
import { friendlyError } from './lib/friendlyError';

const db = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} dB`;

/**
 * Even out all: one button that brings every preset and scene to the same
 * loudness, so switching never jumps. Only new or changed presets are measured
 * again. Hidden on a daemon without calibration.
 * @see docs/audio.md
 */
export function EvenOut({ connected }: { connected: boolean }) {
  const [state, setState] = useState<CalibrationState | null | 'unsupported'>(
    null,
  );
  const [error, setError] = useState('');
  const [coverage, setCoverage] = useState<CalibrationCoverage | null>(null);
  const [details, setDetails] = useState(false);
  const alive = useRef(true);
  const running = state !== 'unsupported' && !!state?.progress.running;
  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const read = async () => {
      try {
        const [next, nextCoverage] = await Promise.all([
          calibration(),
          calibrationCoverage(),
        ]);
        if (!alive.current) return;
        setState(next ?? 'unsupported');
        setCoverage(nextCoverage);
        // Poll while a run is going; one read otherwise.
        if (next?.progress.running) timer = setTimeout(() => void read(), 500);
      } catch (cause) {
        if (alive.current) setError(friendlyError(cause, 'measure the levels'));
      }
    };
    void read();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [running]);
  if (state === 'unsupported' || state == null) return null;
  async function send(action: 'run' | 'run_all' | 'cancel' | 'reset') {
    setError('');
    try {
      const next = await calibration(action);
      if (next && alive.current) setState(next);
    } catch (cause) {
      setError(friendlyError(cause, 'even out the levels'));
    }
  }
  const { progress, entries, target_lufs } = state;
  const presets = entries.map(({ key, name, lufs, offset_db }) => ({
    key,
    name,
    lufs: lufs + offset_db,
  }));
  const levels = presets.map((preset) => preset.lufs);
  const spread = levels.length
    ? Math.max(...levels) - Math.min(...levels)
    : null;
  const pending = (coverage?.stale ?? 0) + (coverage?.unmeasured ?? 0);
  const summary =
    target_lufs == null
      ? 'Not evened out yet: each preset plays at its own level.'
      : pending
        ? `${entries.length} measured at ${target_lufs.toFixed(1)} LUFS; ${pending} new or changed ${pending === 1 ? 'sound needs' : 'sounds need'} Even Out.`
        : `${entries.length} presets and scenes evened out to ${target_lufs.toFixed(1)} LUFS.`;
  return (
    <section className="grid gap-3" aria-label="Even out all">
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        <Title as="h2" size="sm">
          Even out all
        </Title>
        {!running && (
          <Button
            variant="outline"
            disabled={!connected}
            onClick={() => void send('run')}
          >
            {pending ? `Even out ${pending} new or changed` : 'Even out all'}
          </Button>
        )}
      </div>
      {running ? (
        <>
          <p role="status">
            Measuring {Math.min(progress.done + 1, progress.total)} of{' '}
            {progress.total}
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
          <Button variant="outline" onClick={() => void send('cancel')}>
            Stop measuring
          </Button>
        </>
      ) : (
        <>
          <Caption>{summary}</Caption>
          {spread != null && (
            <>
              <p>Loudest to quietest: {spread.toFixed(1)} dB</p>
              <PresetLoudnessChart presets={presets} target={target_lufs} />
              <Caption>Estimated LUFS after stored level corrections.</Caption>
            </>
          )}
          <details className="grid gap-1 text-sm [&>summary]:min-h-touch">
            <summary>How it works</summary>
            <Caption>
              Plays a built-in riff through each new or changed preset and scene
              at Oxidal's fixed factory level for about four seconds, silently,
              then puts back what you were playing. Your guitar profile does not
              change the result. Oxidal chooses a reachable common level within
              its correction range. Boost remains a separate control.
            </Caption>
          </details>
          {entries.length > 0 && (
            <ActionRow>
              <Button variant="outline" onClick={() => setDetails((v) => !v)}>
                {details ? 'Hide levels' : 'Levels'}
              </Button>
              <Button
                variant="outline"
                disabled={!connected}
                onClick={() => void send('run_all')}
              >
                Measure all again
              </Button>
              <Button
                variant="outline"
                disabled={!connected}
                onClick={() => void send('reset')}
              >
                Reset
              </Button>
            </ActionRow>
          )}
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
      {details && !running && (
        <ul
          className="grid list-none p-0 [&>li]:flex [&>li]:justify-between [&>li]:gap-4 [&>li]:border-b [&>li]:border-border [&>li]:py-1.5"
          aria-label="Measured levels"
        >
          {[...entries]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((e) => (
              <li key={e.key}>
                <span>{e.name}</span>
                <span className="font-mono">{db(e.offset_db)}</span>
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
