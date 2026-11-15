/**
 * One place for app-wide errors and information. Any component posts a notice
 * while a condition holds with `useNotice`; the tray shows them floating
 * under the resource strip, so a notice coming and going never moves the page.
 * (NoticeTray.tsx). A notice stays up for at least `HOLD_MS`, so a state that flaps between two
 * polls does not blink.
 *
 * @see docs/interface.md
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';

export type Notice = {
  tone: 'error' | 'warning' | 'info';
  text: string;
  action?: { label: string; run: () => void };
};

type Posted = Notice & { id: string; shown: number };

const HOLD_MS = 2000;
const TONE_ORDER = { error: 0, warning: 1, info: 2 };

const posted = new Map<string, Posted>();
const leaving = new Map<string, ReturnType<typeof setTimeout>>();
/** `id` + text the viewer closed; the same notice stays closed until it changes. */
const dismissed = new Set<string>();
const listeners = new Set<() => void>();
let snapshot: Posted[] = [];

function publish() {
  snapshot = [...posted.values()]
    .filter((notice) => !dismissed.has(`${notice.id}\n${notice.text}`))
    .sort(
      (a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone] || b.shown - a.shown,
    );
  for (const listener of listeners) listener();
}

function post(id: string, notice: Notice) {
  clearTimeout(leaving.get(id));
  leaving.delete(id);
  const previous = posted.get(id);
  posted.set(id, {
    ...notice,
    id,
    shown:
      previous && previous.text === notice.text ? previous.shown : Date.now(),
  });
  publish();
}

/** Withdraw after the hold, or `now` when the component that posted it goes. */
function withdraw(id: string, now = false) {
  const notice = posted.get(id);
  if (!notice || (leaving.has(id) && !now)) return;
  clearTimeout(leaving.get(id));
  const remove = () => {
    leaving.delete(id);
    posted.delete(id);
    for (const key of dismissed)
      if (key.startsWith(`${id}\n`)) dismissed.delete(key);
    publish();
  };
  const left = HOLD_MS - (Date.now() - notice.shown);
  if (now || left <= 0) remove();
  else leaving.set(id, setTimeout(remove, left));
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Post `notice` under `id` while it is not null; withdraw it when it is. */
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

/** The notices to show, most urgent first. */
export function useNotices() {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/** Close a notice for this viewer until its text changes. */
export function dismissNotice(notice: Posted) {
  dismissed.add(`${notice.id}\n${notice.text}`);
  publish();
}
