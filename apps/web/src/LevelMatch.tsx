import { useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { ActionRow } from '@oxidal/design-system/components/form-layout';
import { LevelMatch as MatchPanel } from '@oxidal/design-system/patterns/guitar-tools';

import { unitLevels } from './api';
import {
  averageDb,
  MATCH_TARGET_DBFS,
  outputDb,
  outputValue,
  RANGE_DB,
} from './loudnessMatch';
import { useMonitorReadings } from './monitorFeed';

const LISTEN_MS = 8000;
const PLAYING_DBFS = -50;

type Result = { measured: number; from: number; to: number };

/**
 * Level match for the current preset: play normally for eight seconds, then set
 * the preset's own Output level so it sits at the shared reference loudness.
 * Measures the output meter (after Level) and removes Level, so the master
 * fader position never skews the match. Saved with the preset when you save.
 * @see docs/audio.md
 */
export function LevelMatch({
  output,
  preset = 'Current preset',
  stale = false,
  disabled,
  onApply,
  onClose,
}: {
  output: { value: number } | undefined;
  disabled: boolean;
  preset?: string;
  stale?: boolean;
  onApply: (value: number) => Promise<boolean | void> | boolean | void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'listening' | 'done'>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState(0);
  const [kept, setKept] = useState<boolean>();
  const run = useRef<{ until: number; readings: number[] } | null>(null);

  async function finish(readings: number[]) {
    setPhase('done');
    const measured = averageDb(readings);
    if (measured == null || !output) {
      setNote(
        'Not enough playing heard. Play the way you would on stage for the whole eight seconds.',
      );
      return;
    }
    let master = 0;
    try {
      master = (await unitLevels())?.output_level_db ?? 0;
    } catch {
      // An older daemon has no master level; the output is unscaled.
    }
    if (master <= -60) {
      setNote('Level is off. Raise Level, then match again.');
      return;
    }
    const preset = measured - master;
    const from = outputDb(output.value);
    const to =
      Math.round(
        Math.min(
          RANGE_DB,
          Math.max(-RANGE_DB, from + MATCH_TARGET_DBFS - preset),
        ) * 2,
      ) / 2;
    setResult({ measured: preset, from, to });
    setNote(
      Math.abs(from + MATCH_TARGET_DBFS - preset) > RANGE_DB
        ? 'This preset is outside the Output level range; it is set as close as it goes.'
        : '',
    );
  }

  useMonitorReadings(1000, (feed) => {
    const r = run.current;
    if (!r || stale) return;
    setProgress(
      Math.min(
        100,
        Math.max(0, 100 * (1 - (r.until - performance.now()) / LISTEN_MS)),
      ),
    );
    const snapshot = feed.snapshot;
    const audio =
      !feed.disconnected && (snapshot?.audio_age_ms ?? 0) < 3000
        ? snapshot?.audio
        : undefined;
    const input = Math.max(
      ...(audio?.input ?? []).map((c) => c.peak_dbfs ?? -120),
      -120,
    );
    const out = Math.max(
      ...(audio?.output ?? []).map((c) => c.rms_dbfs ?? -120),
      -120,
    );
    if (audio && input > PLAYING_DBFS && out > -100) r.readings.push(out);
    if (performance.now() >= r.until) {
      run.current = null;
      void finish(r.readings);
    }
  });

  const fmt = (db: number, unit = 'dB') =>
    `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} ${unit}`;
  return (
    <div
      className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start"
      aria-label="Match preset level"
    >
      <MatchPanel
        preset={preset}
        disabled={disabled || !output || stale}
        state={
          stale
            ? { step: 'ready' }
            : phase === 'listening'
              ? { step: 'listening', progress }
              : result
                ? {
                    step: 'measured',
                    before: fmt(result.measured, 'dBFS'),
                    target: fmt(MATCH_TARGET_DBFS, 'dBFS'),
                    level: fmt(result.to),
                  }
                : { step: 'ready', kept }
        }
        onStart={() => {
          setNote('');
          setResult(null);
          setKept(undefined);
          setProgress(0);
          setPhase('listening');
          run.current = { until: performance.now() + LISTEN_MS, readings: [] };
        }}
        onKeep={async () => {
          if (!result || stale || disabled) return;
          const confirmed = await onApply(outputValue(result.to));
          if (confirmed === false) {
            setNote(
              'The device did not confirm the output level. Close and reopen Level match to try again.',
            );
            return;
          }
          setKept(true);
          setResult(null);
          setPhase('idle');
          setNote('');
        }}
        onUndo={() => {
          setResult(null);
          setKept(false);
          setPhase('idle');
          setNote('');
        }}
      />
      {stale ? (
        <p role="alert">
          The playing rig changed. Reopen Level match to measure this version.
        </p>
      ) : (
        note && <p role="alert">{note}</p>
      )}
      <ActionRow>
        <Button variant="ghost" onClick={onClose}>
          {kept ? 'Close' : 'Cancel'}
        </Button>
      </ActionRow>
    </div>
  );
}
