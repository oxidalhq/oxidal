import { useSyncExternalStore } from 'react';

/**
 * Whether the player is in Perform, and which screen of it. One shared answer
 * for every engine's rig view: choosing a preset can hand the sound to another
 * engine, and the player stays in Perform, on the same screen, when it does.
 * @see docs/interface.md
 */
export type PerformState = { on: boolean; mode: 'play' | 'presets' };
const KEY = 'oxidal.perform';

function read(): PerformState {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(KEY) ?? 'null',
    ) as Partial<PerformState> | null;
    return {
      on: saved?.on === true,
      mode: saved?.mode === 'presets' ? 'presets' : 'play',
    };
  } catch {
    return { on: false, mode: 'play' };
  }
}

let current = read();
const listeners = new Set<() => void>();

export function setPerform(next: Partial<PerformState>) {
  current = { ...current, ...next };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* Perform still works for this page without it. */
  }
  for (const listener of listeners) listener();
}

export function usePerform() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
