import { useEffect, useRef } from 'react';
import { learnMidi } from './api';

const gate = async (on: boolean) => learnMidi(on);

type Observed = { seq: number; message: unknown };

/**
 * The first message received after `after`, in arrival order. A burst between
 * polls therefore learns the first press, not whichever message arrived last.
 */
export function firstAfter<T>(
  status:
    | {
        events: number;
        last?: T | null;
        recent?: { seq: number; message: T }[];
      }
    | null
    | undefined,
  after: number,
): T | undefined {
  if (!status || status.events <= after) return undefined;
  const recent = status.recent as Observed[] | undefined;
  const found = recent?.find((item) => item.seq > after)?.message as
    T | undefined;
  return found ?? status.last ?? undefined;
}

/**
 * Holds the device's passive-learn gate open while `active`, so learning a
 * switch does not run its current assignment. The device also ends the window
 * by itself, so a closed tab cannot leave the controller disabled.
 */
export function useLearnGate(
  active: boolean,
  onError?: (error: unknown) => void,
) {
  const report = useRef(onError);
  useEffect(() => {
    report.current = onError;
  });
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    gate(true).catch((error: unknown) => {
      if (!cancelled) report.current?.(error);
    });
    const keepOpen = window.setInterval(() => {
      gate(true).catch(() => undefined);
    }, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(keepOpen);
      void gate(false).catch(() => undefined);
    };
  }, [active]);
}
