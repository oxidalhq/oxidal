import { useEffect, useRef, useSyncExternalStore } from 'react';
import { monitoring, type Monitoring } from './api';

/** One monitor reading shared by every view. */
export type MonitorReading = {
  snapshot: Monitoring | null;
  /** Request round trip of the latest successful reading, in ms. */
  link: number | null;
  /** True after a failed request or a sampler whose sequence stopped advancing. */
  disconnected: boolean;
  error: string;
  /** performance.now() of the latest successful reading. */
  at: number | null;
};

const STALE_MS = 3000;
const HIDDEN_MS = 5000;
const empty: MonitorReading = {
  snapshot: null,
  link: null,
  disconnected: false,
  error: '',
  at: null,
};

let reading = empty;
const listeners = new Set<() => void>();
// Each mounted consumer asks for an interval; the feed polls at the fastest one.
const intervals = new Map<symbol, number>();
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: AbortController | null = null;
let sequence: number | undefined;
let advanced = 0;

function publish(next: MonitorReading) {
  reading = next;
  for (const listener of listeners) listener();
}
function interval() {
  if (typeof document !== 'undefined' && document.hidden) return HIDDEN_MS;
  return Math.min(...intervals.values());
}
async function refresh() {
  if (intervals.size === 0) return;
  clearTimeout(timer);
  pending?.abort();
  const abort = new AbortController();
  pending = abort;
  const deadline = setTimeout(() => abort.abort(), 4000);
  const started = performance.now();
  try {
    const next = await monitoring(abort.signal);
    if (pending !== abort) return;
    const now = performance.now();
    if (sequence !== next.sequence) {
      sequence = next.sequence;
      advanced = now;
    }
    const stale = now - advanced >= STALE_MS;
    publish({
      snapshot: next,
      link: now - started,
      disconnected: stale,
      error: stale ? 'Monitoring sampler is stale' : '',
      at: now,
    });
  } catch (error) {
    if (pending === abort)
      publish({
        ...reading,
        link: null,
        disconnected: true,
        error: String(error),
      });
  } finally {
    clearTimeout(deadline);
    if (pending === abort && intervals.size > 0)
      timer = setTimeout(() => void refresh(), interval());
  }
}
function start() {
  advanced = performance.now();
  void refresh();
}
function stop() {
  pending?.abort();
  pending = null;
  clearTimeout(timer);
  sequence = undefined;
}

/**
 * Shared monitor feed: one request loop however many views read it.
 * @see docs/monitoring.md
 */
export function useMonitorFeed(everyMs: number): MonitorReading {
  useFeedInterval(everyMs);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => reading,
  );
}

/**
 * Fetch now instead of waiting for the next tick. The app's existing control
 * event stream calls this for lifecycle changes, avoiding a second permanent
 * HTTP connection in every browser tab.
 */
export function refreshMonitorFeed() {
  if (intervals.size > 0) void refresh();
}

/** Receive each shared reading as it arrives, for views that accumulate history. */
export function useMonitorReadings(
  everyMs: number,
  onReading: (reading: MonitorReading) => void,
) {
  useFeedInterval(everyMs);
  const latest = useRef(onReading);
  useEffect(() => {
    latest.current = onReading;
  });
  useEffect(() => {
    const listener = () => latest.current(reading);
    listeners.add(listener);
    // A view that mounts mid-stream starts from the newest reading, not a blank.
    if (reading.at != null) listener();
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

function useFeedInterval(everyMs: number) {
  useEffect(() => {
    const key = Symbol('monitor');
    const first = intervals.size === 0;
    intervals.set(key, everyMs);
    if (first) start();
    return () => {
      intervals.delete(key);
      if (intervals.size === 0) stop();
    };
  }, [everyMs]);
}
