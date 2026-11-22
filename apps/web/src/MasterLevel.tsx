import { type ReactNode, useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Slider } from '@oxidal/design-system/components/slider';

import { type UnitLevels, unitLevels } from './api';
import {
  formatLevel,
  LEVEL_MAX,
  LEVEL_MIN,
  levelToPosition,
  positionToLevel,
} from './levelTaper';
import { friendlyError } from './lib/friendlyError';
import { useMonitorReadings } from './monitorFeed';

const STEPS = 1000;

/**
 * Master output level for the whole unit: after every rig, kept across presets
 * and engines, never saved in a preset. Moves are sent as they happen; while a
 * request is in flight only the newest value waits, so dragging never queues up.
 * @see docs/audio.md
 */
export function MasterLevel({
  disabled = false,
  extra,
}: {
  disabled?: boolean;
  /** A control that belongs beside Level, such as the playing preset's boost. */
  extra?: ReactNode;
}) {
  const [levels, setLevels] = useState<UnitLevels | null>(null);
  const [supported, setSupported] = useState(true);
  const [error, setError] = useState('');
  const sending = useRef(false);
  const waiting = useRef<UnitLevels | null>(null);
  // Key repeats can arrive before React re-renders; step from the newest value.
  const latest = useRef<UnitLevels | null>(null);

  useMonitorReadings(supported ? 1000 : null, ({ snapshot, disconnected }) => {
    const confirmed = snapshot?.audio?.monitoring?.levels;
    if (!confirmed || disconnected || sending.current || latest.current == null)
      return;
    latest.current = confirmed;
    setLevels(confirmed);
  });

  useEffect(() => {
    const abort = new AbortController();
    unitLevels(undefined, abort.signal)
      .then((current) => {
        latest.current = current;
        if (current) setLevels(current);
        else setSupported(false);
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setError(friendlyError(cause, 'read the output level'));
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
      setError(friendlyError(cause, 'change the output level'));
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
    update({ ...now, output_level_db: db });
  }
  function update(next: UnitLevels) {
    latest.current = next;
    setLevels(next);
    void send(next);
  }

  if (!supported) return null;
  // Render once loaded so the row never flashes in and out on older daemons.
  if (!levels)
    return error ? (
      <p className="col-span-full text-sm" role="alert">
        {error}
      </p>
    ) : null;
  const db = levels.output_level_db;
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border py-1 sm:auto-cols-auto sm:grid-flow-col">
      <Slider
        label="Level"
        readout={formatLevel(db)}
        live
        min={0}
        max={STEPS}
        step={1}
        value={[Math.round(levelToPosition(db) * STEPS)]}
        disabled={disabled}
        aria-valuetext={formatLevel(db)}
        title="Master output for every preset. Not saved in presets."
        onValueChange={([position]) =>
          change(positionToLevel(position! / STEPS))
        }
        onKeyDown={(e) => {
          // Arrow keys move in whole dB rather than fader steps.
          const delta =
            e.key === 'ArrowUp' || e.key === 'ArrowRight'
              ? 1
              : e.key === 'ArrowDown' || e.key === 'ArrowLeft'
                ? -1
                : 0;
          if (!delta || disabled) return;
          e.preventDefault();
          const from = latest.current?.output_level_db ?? db;
          change(
            Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.round(from) + delta)),
          );
        }}
      />
      <Button
        type="button"
        variant={levels.mono ? 'default' : 'outline'}
        aria-pressed={levels.mono ?? false}
        disabled={disabled}
        title="Sum left and right: check how the preset sounds on a mono PA, or leave on for mono output"
        onClick={() => {
          const now = latest.current;
          if (now) update({ ...now, mono: !now.mono });
        }}
      >
        Mono
      </Button>
      {extra && (
        <div className="col-span-full grid auto-cols-fr grid-flow-col items-center gap-2 sm:col-span-1 sm:flex">
          {extra}
        </div>
      )}
      {error && (
        <p className="col-span-full text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
