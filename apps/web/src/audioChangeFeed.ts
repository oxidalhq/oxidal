import { useEffect, useState, useSyncExternalStore } from 'react';

import {
  audioChange,
  type AudioChangeRequest,
  type AudioChangeState,
} from './api';
import { friendlyError } from './lib/friendlyError';

type Feed = {
  state?: AudioChangeState;
  receivedAt: number;
  error: string;
  pending: boolean;
  readFailed: boolean;
  pendingAction?: AudioChangeRequest['kind'];
};
let current: Feed = {
  receivedAt: 0,
  error: '',
  pending: false,
  readFailed: false,
};
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let reading = false;
let generation = 0;
let writeGeneration = 0;
const active = (state: AudioChangeState | undefined) =>
  !!state && ['restarting', 'proving', 'reverting'].includes(state.phase);
function schedule(delay: number) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void read();
  }, delay);
}
function publish(next: Feed) {
  current = next;
  for (const listener of listeners) listener();
}
async function read() {
  if (reading || current.pending || !listeners.size) return;
  reading = true;
  const turn = generation;
  try {
    const state = await audioChange();
    if (turn === generation)
      publish({
        ...current,
        state,
        receivedAt: performance.now(),
        error: '',
        readFailed: false,
      });
  } catch (cause) {
    if (turn === generation)
      publish({
        ...current,
        error: friendlyError(cause, 'read audio confirmation'),
        readFailed: true,
      });
  } finally {
    reading = false;
    if (listeners.size && !current.pending)
      schedule(turn !== generation ? 200 : active(current.state) ? 400 : 1500);
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    generation++;
    void read();
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      generation++;
      clearTimeout(timer);
      timer = undefined;
    }
  };
}

export async function changeAudio(request: AudioChangeRequest): Promise<void> {
  if (current.pending && request.kind !== 'stop') return;
  // Invalidate an earlier GET before sending a write; it cannot undo its receipt.
  generation++;
  const turn = ++writeGeneration;
  clearTimeout(timer);
  timer = undefined;
  publish({
    ...current,
    pending: true,
    pendingAction: request.kind,
    error: '',
  });
  try {
    const state = await audioChange(request);
    if (turn === writeGeneration)
      publish({
        state,
        pending: false,
        receivedAt: performance.now(),
        error: '',
        readFailed: false,
      });
  } catch (cause) {
    if (turn === writeGeneration)
      publish({
        ...current,
        pending: false,
        pendingAction: undefined,
        error: friendlyError(cause, 'change audio settings'),
      });
    throw cause;
  } finally {
    if (turn === writeGeneration && listeners.size) schedule(200);
  }
}

/** One read owner across all hardware forms; interpolation changes only the display. */
export function useAudioChange() {
  const feed = useSyncExternalStore(subscribe, () => current);
  const [now, setNow] = useState(() => performance.now());
  const running = active(feed.state);
  useEffect(() => {
    if (!running) return;
    const clock = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(clock);
  }, [running]);
  const remaining = Math.max(
    0,
    (feed.state?.remaining_ms ?? 0) - Math.max(0, now - feed.receivedAt),
  );
  return { ...feed, active: running, secondsLeft: Math.ceil(remaining / 1000) };
}
