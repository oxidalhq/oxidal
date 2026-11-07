import { useEffect, useState } from 'react';

const query = '(max-width: 640px)';
const matches = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;

/**
 * Phone-width layout (7.28), following window resizes and rotation. Matches the
 * CSS breakpoint where Rig header labels hide.
 * @see docs/interface.md
 */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setNarrow(list.matches);
    list.addEventListener('change', update);
    update();
    return () => list.removeEventListener('change', update);
  }, []);
  return narrow;
}
