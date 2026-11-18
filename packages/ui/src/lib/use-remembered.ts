import * as React from 'react';

/**
 * A choice this browser keeps by itself, with no Save button. If the browser
 * will not store it, the choice still works until the page closes.
 */
export function useRemembered<T>(key: string, initial: T) {
  const [value, setValue] = React.useState<T>(() => {
    try {
      const saved = window.localStorage.getItem(key);
      return saved === null ? initial : (JSON.parse(saved) as T);
    } catch {
      return initial;
    }
  });
  const remember = React.useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private windows can refuse; the choice lasts for this visit.
      }
    },
    [key],
  );
  return [value, remember] as const;
}
