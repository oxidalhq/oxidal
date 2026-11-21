import * as React from 'react';

/** True while the media query matches; false before the first check and in tests without matchMedia. */
export function useMedia(query: string): boolean {
  const [matches, setMatches] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/**
 * True when movement is welcome: not when the system asks for reduced
 * motion, and not in the E-paper display mode, where every redraw flashes.
 */
export function useMotion(): boolean {
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const [epaper, setEpaper] = React.useState(false);
  React.useEffect(() => {
    const root = document.documentElement;
    const read = () => setEpaper(root.dataset.display === 'epaper');
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-display'],
    });
    return () => observer.disconnect();
  }, []);
  return !reduced && !epaper;
}

/** Phone-sized Rig routes read from input to output down the screen. */
export function useVerticalRig() {
  return useMedia('(max-width: 47.99rem)');
}
