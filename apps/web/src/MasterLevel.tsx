import { useEffect, useRef, useState } from 'react';
import { unitLevels, type UnitLevels } from './api';
import {
  LEVEL_MAX,
  LEVEL_MIN,
  formatLevel,
  levelToPosition,
  positionToLevel,
} from './levelTaper';
import './MasterLevel.css';

const STEPS = 1000;

/**
 * Master output level for the whole unit: after every rig, kept across presets
 * and engines, never saved in a preset. Moves are sent as they happen; while a
 * request is in flight only the newest value waits, so dragging never queues up.
 * @see docs/audio.md
 */
export function MasterLevel({ disabled = false }: { disabled?: boolean }) {
  const [levels, setLevels] = useState<UnitLevels | null>(null);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const waiting = useRef<UnitLevels | null>(null);
  // Key repeats can arrive before React re-renders; step from the newest value.
  const latest = useRef<UnitLevels | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    unitLevels(undefined, abort.signal)
      .then((current) => {
        latest.current = current;
        if (current) setLevels(current);
        else setSupported(false);
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(String(cause));
      });
    return () => abort.abort();
  }, []);

  async function send(next: UnitLevels) {
    if (sending.current) {
      waiting.current = next;
      return;
    }
    sending.current = true;
    try {
      let pending: UnitLevels | null = next;
      while (pending) {
        waiting.current = null;
        await unitLevels(pending);
        pending = waiting.current;
      }
      setError('');
    } catch (cause) {
      setError(String(cause));
      // Show what the unit actually has after a refused change.
      unitLevels()
        .then((current) => {
          if (!current) return;
          latest.current = current;
          setLevels(current);
        })
        .catch(() => {});
    } finally {
      sending.current = false;
    }
  }
  function change(db: number) {
    const now = latest.current;
    if (!now || db === now.output_level_db) return;
    const next = { ...now, output_level_db: db };
    latest.current = next;
    setLevels(next);
    void send(next);
  }

  if (!supported) return null;
  const db = levels?.output_level_db ?? 0;
  return (
    <div className="master-level" data-off={db <= LEVEL_MIN || undefined}>
      <label htmlFor="master-level">Level</label>
      <input
        id="master-level"
        type="range"
        min={0}
        max={STEPS}
        step={1}
        value={Math.round(levelToPosition(db) * STEPS)}
        disabled={disabled || !levels}
        aria-valuetext={formatLevel(db)}
        title="Master output for every preset. Not saved in presets."
        onChange={(e) =>
          change(positionToLevel(Number(e.target.value) / STEPS))
        }
        onKeyDown={(e) => {
          // Arrow keys move in whole dB rather than fader steps.
          const delta =
            e.key === 'ArrowUp' || e.key === 'ArrowRight'
              ? 1
              : e.key === 'ArrowDown' || e.key === 'ArrowLeft'
                ? -1
                : 0;
          if (!delta) return;
          e.preventDefault();
          const from = latest.current?.output_level_db ?? db;
          change(
            Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.round(from) + delta)),
          );
        }}
        style={{ '--level': levelToPosition(db) } as React.CSSProperties}
      />
      <output htmlFor="master-level" aria-live="off">
        {levels ? formatLevel(db) : '—'}
      </output>
      {error && (
        <p className="master-level-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
