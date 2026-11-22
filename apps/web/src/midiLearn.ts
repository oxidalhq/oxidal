import { useEffect, useRef } from 'react';

import { learnMidi } from './api';

const gate = async (on: boolean) => learnMidi(on);

/**
 * The first message received after `after`, in arrival order. A burst between
 * polls therefore learns the first press, not whichever message arrived last.
 */
export function firstAfter<T>(
  status:
    | {
        events: number;
        last?: T | null;
        recent?: { seq: number; message: T; source?: number }[];
      }
    | null
    | undefined,
  after: number,
  /** Only accept a message from this controller (0 is the first). */
  source?: number,
  accepts: (message: T) => boolean = () => true,
): T | undefined {
  if (!status || status.events <= after) return undefined;
  if (status.recent) {
    return status.recent.find(
      (item) =>
        item.seq > after &&
        (source === undefined || (item.source ?? 0) === source) &&
        accepts(item.message),
    )?.message;
  }
  // Older workers only report a last message from their primary input.
  const last = status.last;
  return (source === undefined || source === 0) && last != null && accepts(last)
    ? last
    : undefined;
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
