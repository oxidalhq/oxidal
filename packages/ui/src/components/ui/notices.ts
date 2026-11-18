import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * App-wide notices in one place (the tray under the resource strip), so a
 * message never shifts the layout. Two kinds:
 *
 * - A state notice (`useNotice`): posted while a condition holds, such as
 *   "Connection lost · reconnecting", and withdrawn when it clears. Held
 *   for at least two seconds so flapping states do not blink.
 * - A toast (`notify`): a one-off message that leaves by itself after a
 *   few seconds, such as "Saved" or "Could not split: disk full".
 *
 * Dismissing hides a notice until its text changes.
 */
export type Notice = {
  tone: 'error' | 'warning' | 'info' | 'success';
  text: string;
  action?: { label: string; run: () => void };
};

type Entry = Notice & { id: string; since: number; toast: boolean };

const HOLD_MS = 2000;
const TOAST_MS = 4000;

const posted = new Map<string, Entry>();
const leaving = new Map<string, ReturnType<typeof setTimeout>>();
const dismissed = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: Entry[] = [];
let counter = 0;

function key(entry: Pick<Entry, 'id' | 'text'>) {
  return `${entry.id}\u0000${entry.text}`;
}

function publish() {
  snapshot = [...posted.values()]
    .filter((entry) => !dismissed.has(key(entry)))
    .sort(
      (a, b) =>
        Number(b.tone === 'error') - Number(a.tone === 'error') ||
        b.since - a.since,
    );
  listeners.forEach((listener) => listener());
}

function post(id: string, notice: Notice, toast = false) {
  const timer = leaving.get(id);
  if (timer) {
    clearTimeout(timer);
    leaving.delete(id);
  }
  const previous = posted.get(id);
  posted.set(id, {
    ...notice,
    id,
    toast,
    since:
      previous && previous.text === notice.text ? previous.since : Date.now(),
  });
  publish();
}

function withdraw(id: string, now = false) {
  const entry = posted.get(id);
  if (!entry) return;
  const remaining = now ? 0 : HOLD_MS - (Date.now() - entry.since);
  const remove = () => {
    clearTimeout(leaving.get(id));
    posted.delete(id);
    leaving.delete(id);
    for (const closed of dismissed)
      if (closed.startsWith(`${id}\u0000`)) dismissed.delete(closed);
    publish();
  };
  if (remaining <= 0) {
    remove();
    return;
  }
  if (leaving.has(id)) return;
  leaving.set(id, setTimeout(remove, remaining));
}

/** Post a notice while `notice` is set; withdraw it when null or unmounted. */
export function useNotice(id: string, notice: Notice | null) {
  const run = useRef(notice?.action?.run);
  useEffect(() => {
    run.current = notice?.action?.run;
  });
  const text = notice?.text;
  const tone = notice?.tone;
  const label = notice?.action?.label;
  useEffect(() => () => withdraw(id, true), [id]);
  useEffect(() => {
    if (!text || !tone) {
      withdraw(id);
      return;
    }
    post(id, {
      tone,
      text,
      action: label ? { label, run: () => run.current?.() } : undefined,
    });
  }, [id, text, tone, label]);
}

/** A one-off message that leaves on its own. Returns a function that removes it early. */
export function notify(notice: Notice, ttl = TOAST_MS) {
  const id = `toast-${++counter}`;
  post(id, notice, true);
  const timer = setTimeout(() => withdraw(id, true), ttl);
  return () => {
    clearTimeout(timer);
    withdraw(id, true);
  };
}

export function useNotices() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}

export function dismissNotice(notice: Pick<Entry, 'id' | 'text'>) {
  const entry = posted.get(notice.id);
  if (entry?.toast) {
    posted.delete(notice.id);
  } else {
    dismissed.add(key(notice));
  }
  publish();
}

/** Tests only. */
export function resetNotices() {
  posted.clear();
  leaving.forEach((timer) => clearTimeout(timer));
  leaving.clear();
  dismissed.clear();
  publish();
}
