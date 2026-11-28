import { useSyncExternalStore } from 'react';

import type { PresetChoice } from './presetChoices';

/**
 * What the one search can do beyond going to a screen. A screen that is
 * showing registers its own commands (the Rig: scenes and choosing a preset)
 * and takes them back when it goes away.
 * @see docs/interface.md
 */
export type AppCommand = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
};

const sources = new Map<string, AppCommand[]>();
const listeners = new Set<() => void>();
let snapshot: AppCommand[] = [];
let chooser: ((choice: PresetChoice) => void) | null = null;
let chooserSnapshot: ((choice: PresetChoice) => void) | null = null;

const emit = () => {
  snapshot = [...sources.values()].flat();
  chooserSnapshot = chooser;
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Set the commands one source offers; null takes them back. */
export function setCommands(source: string, commands: AppCommand[] | null) {
  if (commands) sources.set(source, commands);
  else sources.delete(source);
  emit();
}

/** The way to play a preset from the search, set by the screen that can (with its unsaved-edit checks). */
export function setPresetChooser(fn: ((choice: PresetChoice) => void) | null) {
  chooser = fn;
  emit();
}

export const useCommands = () =>
  useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
export const usePresetChooser = () =>
  useSyncExternalStore(
    subscribe,
    () => chooserSnapshot,
    () => chooserSnapshot,
  );
