import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import type { ChainCanvasControl } from '../lib/chain-canvas-control';
import { cn } from '../lib/cn';

/**
 * Any drawing that is moved like the chain map: drag the empty space to pan,
 * pinch or ⌘-scroll to zoom, scroll to move, and the chain bar's zoom, Fit
 * and Centre drive it through the same control. The Rig's tree view sits in
 * one so it behaves as the map does. `still` keeps the drawing in the page's
 * own scrolling (a phone's tree runs down the page); Fit and Centre then
 * scroll to it.
 * @see docs/interface.md
 */

type View = { x: number; y: number; s: number };
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
/** Keep at least a little of the drawing in view so it cannot be flung away. */
const keepInView = (v: View, w: number, h: number, cw: number, ch: number) => ({
  ...v,
  x: clamp(v.x, 120 - cw * v.s, w - 120),
  y: clamp(v.y, 120 - ch * v.s, h - 120),
});
/** What a press on these starts is their own: it does not pan. */
const OWN =
  'button, input, select, textarea, a, label, [role=slider], [data-tile], [data-block]';

export function PanZoom({
  control,
  selected,
  insetTop = 0,
  insetSide = 0,
  still = false,
  label,
  className,
  children,
}: {
  control?: ChainCanvasControl;
  /** The selected block's id; Centre and Follow find it by `data-tile` or `data-block`. */
  selected?: string | null;
  /** Room kept clear along the top (a header over the drawing). */
  insetTop?: number;
  /** Room kept clear down each side (the edge lanes). */
  insetSide?: number;
  still?: boolean;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, s: 1 });
  const [smooth, setSmooth] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const content = useRef({ w: 0, h: 0 });
  // Until the player moves or zooms the drawing, it keeps fitting its space,
  // as the map does while the panel opens or the window changes.
  const touched = useRef(false);
  // After Fit, the drawing keeps fitting whole as it grows or shrinks.
  const whole = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef(0);
  const drag = useRef<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    moved: boolean;
  } | null>(null);

  const fit = useCallback(
    (w: number, h: number, whole = true) => {
      const c = content.current;
      if (!w || !c.w) return;
      const all = clamp(
        Math.min((w - 64 - 2 * insetSide) / c.w, (h - insetTop - 32) / c.h),
        0.3,
        1.5,
      );
      // On opening a long chain starts readable from its left end, as the map does.
      const s = whole ? all : Math.max(all, 0.6);
      setSmooth(whole);
      setView({
        s,
        x: s > all ? 24 + insetSide : (w - c.w * s) / 2,
        y: insetTop + Math.max(16, (h - insetTop - c.h * s) / 2),
      });
    },
    [insetTop, insetSide],
  );

  useLayoutEffect(() => {
    if (still) return;
    const el = box.current;
    const drawing = inner.current;
    if (!el || !drawing || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      content.current = { w: drawing.offsetWidth, h: drawing.offsetHeight };
      setSize({ w: r.width, h: r.height });
      if (!touched.current && r.width && content.current.w)
        fit(r.width, r.height, whole.current);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(drawing);
    return () => ro.disconnect();
  }, [still, fit]);

  const zoomAt = (cx: number, cy: number, f: number, animate = false) => {
    touched.current = true;
    setSmooth(animate);
    setView((v) => {
      const s = clamp(v.s * f, 0.3, 1.6);
      return {
        s,
        x: cx - (cx - v.x) * (s / v.s),
        y: cy - (cy - v.y) * (s / v.s),
      };
    });
  };
  const panTo = (v: View) =>
    keepInView(v, size.w, size.h, content.current.w, content.current.h);

  const focus = (id: string) => {
    const tile = inner.current?.querySelector<HTMLElement>(
      `[data-tile="${CSS.escape(id)}"], [data-block="${CSS.escape(id)}"]`,
    );
    if (!tile) return;
    if (still) {
      tile.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    // The tile's place in the drawing, unscaled.
    let x = tile.offsetWidth / 2;
    let y = tile.offsetHeight / 2;
    for (
      let el: HTMLElement | null = tile;
      el && el !== inner.current;
      el = el.offsetParent as HTMLElement | null
    ) {
      x += el.offsetLeft;
      y += el.offsetTop;
    }
    setSmooth(true);
    setView((v) => ({
      ...v,
      x: size.w / 2 - x * v.s,
      y: insetTop + (size.h - insetTop) / 2 - y * v.s,
    }));
  };

  useEffect(() => {
    const el = box.current;
    if (!el || still) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey)
        zoomAt(
          e.clientX - r.left,
          e.clientY - r.top,
          Math.exp(-e.deltaY * 0.01),
        );
      else {
        touched.current = true;
        setSmooth(false);
        setView((v) =>
          keepInView(
            { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY },
            r.width,
            r.height,
            content.current.w,
            content.current.h,
          ),
        );
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [still]);

  useEffect(() => {
    control?.reportZoom(still ? 1 : view.s);
  }, [control, still, view.s]);
  useEffect(() => {
    if (!control) return;
    control.attach({
      zoomIn: () => !still && zoomAt(size.w / 2, size.h / 2, 1.25, true),
      zoomOut: () => !still && zoomAt(size.w / 2, size.h / 2, 0.8, true),
      fit: () => {
        if (still) {
          box.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
          return;
        }
        touched.current = false;
        whole.current = true;
        fit(size.w, size.h);
      },
      centre: () => {
        if (selected) focus(selected);
      },
      panBy: (dx, dy) => {
        if (still) return;
        touched.current = true;
        setSmooth(true);
        setView((v) => panTo({ ...v, x: v.x + dx, y: v.y + dy }));
      },
    });
    return () => control.attach(null);
  });
  // Follow: a newly selected block comes into view.
  const follow = control?.follow ?? false;
  const lastSelected = useRef(selected);
  useEffect(() => {
    if (selected && selected !== lastSelected.current && follow)
      focus(selected);
    lastSelected.current = selected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, follow]);

  if (still)
    return (
      <div ref={box} className={className}>
        <div ref={inner}>{children}</div>
      </div>
    );

  return (
    <div
      ref={box}
      tabIndex={0}
      role="group"
      aria-label={
        label ??
        'Drag the space to pan, pinch or press plus and minus to zoom, 0 to fit.'
      }
      data-slot="pan-zoom"
      className={cn(
        'relative h-full min-h-0 cursor-grab touch-none overflow-clip outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing',
        className,
      )}
      onKeyDown={(e) => {
        if ((e.target as HTMLElement) !== e.currentTarget) return;
        const m: Record<string, () => void> = {
          '+': () => zoomAt(size.w / 2, size.h / 2, 1.25, true),
          '=': () => zoomAt(size.w / 2, size.h / 2, 1.25, true),
          '-': () => zoomAt(size.w / 2, size.h / 2, 0.8, true),
          '0': () => {
            touched.current = false;
            whole.current = true;
            fit(size.w, size.h);
          },
        };
        const f = m[e.key];
        if (f) {
          e.preventDefault();
          f();
        }
      }}
      // A control reached with Tab is brought into view, so nothing in the
      // drawing is out of reach of the keyboard.
      onFocus={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const at = (e.target as HTMLElement).getBoundingClientRect();
        if (e.target === e.currentTarget || !at.width) return;
        const dx =
          at.left < box.left + insetSide
            ? box.left + insetSide + 16 - at.left
            : at.right > box.right - insetSide
              ? box.right - insetSide - 16 - at.right
              : 0;
        const dy =
          at.top < box.top + insetTop
            ? box.top + insetTop + 16 - at.top
            : at.bottom > box.bottom
              ? box.bottom - 16 - at.bottom
              : 0;
        if (!dx && !dy) return;
        touched.current = true;
        setSmooth(true);
        setView((v) => panTo({ ...v, x: v.x + dx, y: v.y + dy }));
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest(OWN)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          vx: view.x,
          vy: view.y,
          moved: false,
        };
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          pinch.current = Math.hypot(a!.x - b!.x, a!.y - b!.y);
        }
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size === 2) {
          const [a, b] = [...pointers.current.values()];
          const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
          const rect = box.current!.getBoundingClientRect();
          if (pinch.current)
            zoomAt(
              (a!.x + b!.x) / 2 - rect.left,
              (a!.y + b!.y) / 2 - rect.top,
              d / pinch.current,
            );
          pinch.current = d;
          if (drag.current) drag.current.moved = true;
          return;
        }
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.hypot(dx, dy) > 4) {
          d.moved = true;
          box.current?.setPointerCapture?.(e.pointerId);
        }
        if (d.moved) {
          touched.current = true;
          setSmooth(false);
          setView((v) => panTo({ ...v, x: d.vx + dx, y: d.vy + dy }));
        }
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = 0;
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId);
        pinch.current = 0;
      }}
      onClickCapture={(e) => {
        if (drag.current?.moved) {
          e.stopPropagation();
          drag.current.moved = false;
        }
      }}
    >
      <div
        ref={inner}
        className={cn(
          'absolute top-0 left-0 w-max origin-top-left',
          smooth && 'transition-transform duration-300 ease-out',
        )}
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
