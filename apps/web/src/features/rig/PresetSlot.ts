import { useSyncExternalStore } from 'react';

/**
 * Where the Set list tool shows the presets and set list: the dock's Set list
 * tool hands over its element, and the Rig draws its preset panel there with
 * its own unsaved-edit checks.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

export function setPresetSlot(element: HTMLElement | null) {
  if (slot === element) return;
  slot = element;
  for (const listener of listeners) listener();
}

export const usePresetSlot = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => slot,
    () => slot,
  );
