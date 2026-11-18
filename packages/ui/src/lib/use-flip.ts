import * as React from 'react';

import { useMotion } from './use-media';

/**
 * Glides things to their new places when their order changes, instead of
 * jumping: remembers where each `[data-flip="<id>"]` inside `root` was, and
 * when `order` changes plays each from its old place to its new one.
 *
 * `snapshot()` remembers the places as they look right now (for a dragged
 * item, where the finger left it); `play()` glides from the remembered
 * places to the current ones. Nothing moves when motion is unwelcome
 * (reduced motion, E-paper) or the browser cannot animate.
 */
export function useFlip(
  root: React.RefObject<HTMLElement | null>,
  order: string,
  /** The CSS zoom of the content, when it is scaled to fit. */
  zoom = 1,
) {
  const motion = useMotion();
  const places = React.useRef(new Map<string, { x: number; y: number }>());
  const state = React.useRef({ motion, zoom });
  React.useEffect(() => {
    state.current = { motion, zoom };
  }, [motion, zoom]);

  const measure = React.useCallback(() => {
    const now = new Map<string, { x: number; y: number }>();
    const host = root.current;
    if (!host) return now;
    const origin = host.getBoundingClientRect();
    for (const node of host.querySelectorAll<HTMLElement>('[data-flip]')) {
      const box = node.getBoundingClientRect();
      now.set(node.dataset.flip!, {
        x: box.left - origin.left + host.scrollLeft,
        y: box.top - origin.top + host.scrollTop,
      });
    }
    return now;
  }, [root]);

  const snapshot = React.useCallback(() => {
    places.current = measure();
  }, [measure]);

  const play = React.useCallback(() => {
    const host = root.current;
    const before = places.current;
    const now = measure();
    places.current = now;
    if (!host || !state.current.motion) return;
    for (const node of host.querySelectorAll<HTMLElement>('[data-flip]')) {
      const was = before.get(node.dataset.flip!);
      const is = now.get(node.dataset.flip!);
      if (!was || !is || typeof node.animate !== 'function') continue;
      const dx = (was.x - is.x) / state.current.zoom;
      const dy = (was.y - is.y) / state.current.zoom;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      node.animate(
        [{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }],
        { duration: 240, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }
  }, [measure, root]);

  React.useLayoutEffect(() => {
    play();
  }, [order, play]);

  return { snapshot, play };
}
