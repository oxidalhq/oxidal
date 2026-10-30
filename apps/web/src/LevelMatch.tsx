import { useRef, useState } from 'react';
import { unitLevels } from './api';
import { Button } from './components/ui/button';
import {
  MATCH_TARGET_DBFS,
  RANGE_DB,
  averageDb,
  outputDb,
  outputValue,
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
  disabled,
  onApply,
  onClose,
}: {
  output: { value: number } | undefined;
  disabled: boolean;
  onApply: (value: number) => Promise<void> | void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<'idle' | 'listening' | 'done'>('idle');
  const [result, setResult] = useState<Result | null>(null);
  const [note, setNote] = useState('');
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
    if (!r) return;
    const audio = feed.snapshot?.audio;
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

  const fmt = (db: number) =>
    `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`;
  return (
    <div className="control-stack" aria-label="Match preset level">
      <p>
        Play the way you would on stage for eight seconds. Oxidal sets this
        preset’s Output level so it sits at the same loudness as your other
        matched presets. Save the preset to keep it.
      </p>
      {phase === 'listening' && <p role="status">Listening… keep playing.</p>}
      {result && (
        <p role="status">
          This preset plays at {fmt(result.measured)} on average. Output level{' '}
          {fmt(result.from)} → {fmt(result.to)}.
        </p>
      )}
      {note && <p role="alert">{note}</p>}
      <div className="action-row">
        {result ? (
          <Button
            disabled={disabled}
            onClick={async () => {
              await onApply(outputValue(result.to));
              onClose();
            }}
          >
            Apply
          </Button>
        ) : (
          <Button
            disabled={disabled || phase === 'listening' || !output}
            onClick={() => {
              setNote('');
              setResult(null);
              setPhase('listening');
              run.current = {
                until: performance.now() + LISTEN_MS,
                readings: [],
              };
            }}
          >
            {phase === 'done' ? 'Listen again' : 'Start listening'}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
