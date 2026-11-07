/**
 * Page state that survives refresh and Back in this tab (7.5): search, filters,
 * scroll and where to return after signing in. Stored in sessionStorage, so it
 * is per tab and never reaches the device; a blocked store falls back to memory.
 * @see docs/interface.md
 */
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';

const prefix = 'oxidal-page:';

function read<T>(key: string, initial: T): T {
  try {
    const raw = sessionStorage.getItem(prefix + key);
    return raw === null ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
}
function write(key: string, value: unknown) {
  try {
    sessionStorage.setItem(prefix + key, JSON.stringify(value));
  } catch {
    /* optional memory */
  }
}

/** Like useState, kept for this tab under `key`; a null key keeps it in memory only. */
export function useSessionState<T>(
  key: string | null,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() =>
    key === null ? initial : read(key, initial),
  );
  useEffect(() => {
    if (key !== null) write(key, value);
  }, [key, value]);
  return [value, setValue];
}

/**
 * Returns the page to its last scroll position once `ready`, then keeps it.
 * Restores once per mount so loading more rows never jumps the page.
 */
export function useScrollMemory(key: string, ready: boolean) {
  const restored = useRef(false);
  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    const top = read<number>(`${key}:scroll`, 0);
    if (top > 0) window.scrollTo({ top });
  }, [key, ready]);
  useEffect(() => {
    let frame = 0;
    const save = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (restored.current)
          write(`${key}:scroll`, Math.round(window.scrollY));
      });
    };
    window.addEventListener('scroll', save, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', save);
    };
  }, [key]);
}

/** Where to go back to after a detour such as signing in to TONE3000. */
export type ReturnTarget = { hash: string; label: string };
const returnKey = 'return-target';
export function setReturnTarget(target: ReturnTarget) {
  write(returnKey, target);
}
export function readReturnTarget(): ReturnTarget | null {
  const found = read<ReturnTarget | null>(returnKey, null);
  return found &&
    typeof found.hash === 'string' &&
    found.hash.startsWith('#') &&
    typeof found.label === 'string'
    ? found
    : null;
}
export function clearReturnTarget() {
  try {
    sessionStorage.removeItem(prefix + returnKey);
  } catch {
    /* optional memory */
  }
}

/** What a remote catalog failure needs: signing in, or only the internet. */
export function remoteProblem(message: string): 'account' | 'offline' | null {
  if (/connect|authoriz|sign-in|sign in|disconnect to reset/i.test(message))
    return 'account';
  if (/cannot reach|internet|network|failed to fetch/i.test(message))
    return 'offline';
  return null;
}
