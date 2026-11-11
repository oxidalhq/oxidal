import { useEffect, useState } from 'react';

/**
 * The rig canvas's display hook, beside RouteTree.
 * @see docs/interface.md
 */
/** Whether the display is E-paper, following the Settings choice live. */
export function useEpaper() {
  const read = () =>
    typeof document !== 'undefined' &&
    document.documentElement.dataset.display === 'epaper';
  const [epaper, setEpaper] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setEpaper(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-display'],
    });
    return () => observer.disconnect();
  }, []);
  return epaper;
}
