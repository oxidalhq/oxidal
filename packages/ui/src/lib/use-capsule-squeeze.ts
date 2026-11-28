import { type RefObject, useEffect, useRef, useState } from 'react';

import { useMedia } from './use-media';

/**
 * When the floating capsule squeezes into its bubble, and when it comes
 * back. It squeezes only while a guitar is actually playing (input above
 * −50 dBFS for two seconds, not just audio running), after a quiet time, and
 * never while the player is in the middle of something: the capsule's own
 * menu, an open dialog, menu or list on the page, a focused field, selected
 * text, or a click in the last five seconds. It comes back when the pointer
 * rests near the top, heads up towards it quickly, a key is pressed, or the
 * bubble is tapped. Reaching for it again within five seconds of a squeeze
 * doubles the quiet time, up to 30 seconds. "Keep the menu open while
 * playing" and E-paper stop it squeezing at all.
 * @see docs/interface.md
 */

export type CapsulePhase = 'rest' | 'open' | 'squeezing' | 'bubble';

export const SQUEEZE_RULES = {
  /** How far down from the capsule's top the pointer wakes it, in CSS pixels. */
  wakeBand: 80,
  /** The pointer rests this long in that band to wake it. */
  dwell: 150,
  /** A guitar is playing: input above this level… */
  signalDb: -50,
  /** …for this long. */
  signalFor: 2000,
  /** No squeeze this soon after a click on the page. */
  afterClick: 5000,
  /** Reaching for it again this soon after a squeeze doubles the quiet time… */
  reachAgain: 5000,
  /** …up to this. */
  maxIdle: 30000,
  /** How often the rules are checked. */
  tick: 150,
} as const;

/** Layers that mean the player is in the middle of something. */
const OPEN_LAYERS =
  '[role=dialog], [role=alertdialog], [role=menu], [role=listbox]';
const FIELDS =
  'input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable="true"]';

export type CapsuleSqueezeInput = {
  /** Audio is running. */
  running: boolean;
  /** The guitar's input level in dBFS; null with no reading. */
  inputLevel: number | null;
  /** Settings › Display › Keep the menu open while playing. */
  keepOpen?: boolean;
  /** The capsule itself is open or its menu is: never squeeze then. */
  busy?: boolean;
  /** Quiet time before it squeezes, before any doubling. */
  idleMs?: number;
  /** E-paper does not animate: the capsule stays open. */
  epaper?: boolean;
  /** The capsule's element: the wake band is measured from its top. */
  target?: RefObject<HTMLElement | null>;
  /** Also look at the page for open dialogs, menus, fields and selected text. */
  watchPage?: boolean;
};

export type CapsuleSqueeze = {
  /** It is the bubble now. */
  squeezed: boolean;
  /** It is coming back out of the bubble: a short spring (never with reduced motion). */
  popping: boolean;
  /** The quiet time now, after any doubling. */
  idleMs: number;
  /** The rules apply at all (audio running, not kept open, not E-paper). */
  active: boolean;
  /** Bring it back, as a tap on the bubble does. */
  wake: () => void;
};

export function useCapsuleSqueeze({
  running,
  inputLevel,
  keepOpen = false,
  busy = false,
  idleMs = 3000,
  epaper = false,
  target,
  watchPage = true,
}: CapsuleSqueezeInput): CapsuleSqueeze {
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  const [squeezed, setSqueezed] = useState(false);
  const [popping, setPopping] = useState(false);
  const [doublings, setDoublings] = useState(0);
  const idle = Math.min(SQUEEZE_RULES.maxIdle, idleMs * 2 ** doublings);
  const active = running && !keepOpen && !epaper;

  const level = useRef(inputLevel);
  const isBusy = useRef(busy);
  const isSqueezed = useRef(squeezed);
  const lastActivity = useRef(0);
  const collapsedAt = useRef(0);
  useEffect(() => {
    level.current = inputLevel;
    isBusy.current = busy;
    isSqueezed.current = squeezed;
  });

  const wake = () => {
    if (
      isSqueezed.current &&
      Date.now() - collapsedAt.current < SQUEEZE_RULES.reachAgain
    )
      setDoublings((d) => d + 1);
    isSqueezed.current = false;
    setPopping(!reduced);
    setSqueezed(false);
    lastActivity.current = Date.now();
  };
  const wakeRef = useRef(wake);
  useEffect(() => {
    wakeRef.current = wake;
  });

  useEffect(() => {
    if (!active) return;
    const now = () => Date.now();
    lastActivity.current = now();
    let lastClick = 0;
    let signalSince: number | null = null;
    let dwell: ReturnType<typeof setTimeout> | null = null;
    let previous: { x: number; y: number; t: number } | null = null;
    const wakeUp = () => {
      if (dwell) clearTimeout(dwell);
      dwell = null;
      if (isSqueezed.current) wakeRef.current();
    };
    const onMove = (e: PointerEvent) => {
      const t = now();
      const before = previous;
      previous = { x: e.clientX, y: e.clientY, t };
      if (!isSqueezed.current) {
        lastActivity.current = t;
        return;
      }
      // Dragging a block across the top is not a reach for the menu.
      if (e.buttons) return;
      const box = target?.current?.getBoundingClientRect();
      const top = box?.top ?? 0;
      const y = e.clientY - top;
      if (y < SQUEEZE_RULES.wakeBand) {
        dwell ??= setTimeout(wakeUp, SQUEEZE_RULES.dwell);
      } else if (dwell) {
        clearTimeout(dwell);
        dwell = null;
      }
      // Heading clearly up towards the capsule wakes it before it arrives.
      if (before && t > before.t) {
        const speed = (e.clientY - before.y) / (t - before.t);
        const centre = box
          ? box.left + box.width / 2
          : (globalThis.innerWidth ?? 0) / 2;
        if (speed < -0.8 && y < 200 && Math.abs(e.clientX - centre) < 300)
          wakeUp();
      }
    };
    const onKey = () => {
      if (isSqueezed.current) wakeUp();
      else lastActivity.current = now();
    };
    const onDown = () => {
      lastClick = now();
      if (!isSqueezed.current) lastActivity.current = now();
    };
    const onWheel = () => {
      if (!isSqueezed.current) lastActivity.current = now();
    };
    /** Something the player is in the middle of: never squeeze then. */
    const inTheMiddle = () => {
      if (isBusy.current) return true;
      if (now() - lastClick < SQUEEZE_RULES.afterClick) return true;
      if (!watchPage) return false;
      if (document.querySelector(OPEN_LAYERS)) return true;
      if ((window.getSelection?.()?.toString() ?? '').length > 0) return true;
      return !!document.activeElement?.matches(FIELDS);
    };
    const tick = setInterval(() => {
      const t = now();
      const l = level.current;
      // Playing means a guitar is coming in, not just audio running.
      if (l != null && l > SQUEEZE_RULES.signalDb) signalSince ??= t;
      else signalSince = null;
      const playing =
        signalSince !== null && t - signalSince >= SQUEEZE_RULES.signalFor;
      if (
        !isSqueezed.current &&
        playing &&
        !inTheMiddle() &&
        t - lastActivity.current >= idle
      ) {
        collapsedAt.current = t;
        isSqueezed.current = true;
        setPopping(false);
        setSqueezed(true);
      }
    }, SQUEEZE_RULES.tick);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('wheel', onWheel);
    window.addEventListener('keydown', onKey);
    return () => {
      clearInterval(tick);
      if (dwell) clearTimeout(dwell);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, [active, idle, target, watchPage]);

  return {
    squeezed: squeezed && active,
    popping: popping && !reduced,
    idleMs: idle,
    active,
    wake,
  };
}
