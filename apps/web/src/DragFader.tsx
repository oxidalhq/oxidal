/**
 * A value row's fader: shows position, and drags in place with mouse or touch.
 * Vertical swipes still scroll; values snap to hundredths of the 0–1 range.
 */
export function DragFader({
  value,
  dragging,
  disabled,
  onBegin,
  onMove,
  onEnd,
}: {
  value: number;
  dragging: boolean;
  disabled: boolean;
  onBegin: (value: number) => void;
  onMove: (value: number) => void;
  onEnd: (cancel: boolean) => void;
}) {
  return (
    <span
      className="value-row-fader"
      aria-hidden="true"
      data-dragging={dragging || undefined}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const at = (x: number) =>
          Math.round(
            Math.min(1, Math.max(0, (x - rect.left) / rect.width)) * 100,
          ) / 100;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        let last = at(e.clientX);
        onBegin(last);
        const move = (ev: PointerEvent) => {
          const next = at(ev.clientX);
          if (next === last) return;
          last = next;
          onMove(next);
        };
        const end = (ev: PointerEvent) => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', end);
          window.removeEventListener('pointercancel', end);
          onEnd(ev.type === 'pointercancel');
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
      }}
    >
      <i style={{ width: `${value * 100}%` }} />
      <b style={{ left: `${value * 100}%` }} />
    </span>
  );
}
