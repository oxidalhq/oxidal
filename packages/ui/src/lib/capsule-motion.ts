import { useEffect, useRef } from 'react';

/**
 * Motion shared by the floating capsule, the edge lanes and the dock, in one
 * place. Durations scale with `--c2-speed` (set it to 4 to watch every
 * movement slowly). Reduced motion keeps plain short fades; E-paper does not
 * animate at all.
 * @see docs/interface.md
 */

/** A duration in milliseconds, scaled by `--c2-speed`. */
export const duration = (ms: number) => `calc(${ms}ms * var(--c2-speed, 1))`;
/** A light overshoot, for coming back out of the bubble. */
export const SPRING = 'cubic-bezier(0.34, 1.4, 0.64, 1)';
export const EASE_OUT = 'var(--ease-out)';
export const EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)';
/** Reduced motion: only fades. E-paper: nothing moves. */
export const STILL =
  'motion-reduce:scale-100 motion-reduce:translate-x-0 motion-reduce:blur-none motion-reduce:transition-opacity [[data-display=epaper]_&]:transition-none';

/** One soft glow, then hold: for a figure or the bubble when something goes wrong. */
export function useGlowOnce<E extends HTMLElement | SVGElement>(when: boolean) {
  const ref = useRef<E>(null);
  useEffect(() => {
    const el = ref.current;
    if (!when || !el?.animate) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (el.closest('[data-display=epaper]')) return;
    const speed =
      Number(getComputedStyle(el).getPropertyValue('--c2-speed')) || 1;
    el.animate(
      [
        { filter: 'drop-shadow(0 0 0 var(--color-brand))' },
        { filter: 'drop-shadow(0 0 6px var(--color-brand))' },
        { filter: 'drop-shadow(0 0 0 var(--color-brand))' },
      ],
      { duration: 900 * speed, easing: 'ease-out' },
    );
  }, [when]);
  return ref;
}
