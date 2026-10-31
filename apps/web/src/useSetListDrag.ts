import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from 'react';
import type { LibraryCatalog } from './api';
type Entry = LibraryCatalog['items'][number];
const key = (item: Pick<Entry, 'kind' | 'id'>) => `${item.kind}:${item.id}`;
/** A dedicated hold handle leaves the rest of the row available for touch scrolling.
 * @see docs/presets/format.md
 */
export function useSetListDrag(
  root: RefObject<HTMLElement | null>,
  onDrop: (item: Entry, before: Entry | null) => void,
) {
  const state = useRef<{
    item: Entry;
    x: number;
    y: number;
    active: boolean;
    timer: ReturnType<typeof setTimeout>;
    before: Entry | null;
    valid: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  useEffect(
    () => () => {
      if (state.current) clearTimeout(state.current.timer);
    },
    [],
  );
  function clear() {
    if (state.current) clearTimeout(state.current.timer);
    state.current = null;
    setDragging(null);
    setBefore(null);
  }
  return {
    dragging,
    before,
    start(e: PointerEvent<HTMLButtonElement>, item: Entry) {
      if (e.button !== 0 || !e.isPrimary) return;
      clear();
      e.currentTarget.setPointerCapture(e.pointerId);
      const pending: NonNullable<typeof state.current> = {
        item,
        x: e.clientX,
        y: e.clientY,
        active: e.pointerType !== 'touch',
        timer: setTimeout(() => {
          if (state.current === pending) {
            pending.active = true;
            setDragging(key(item));
          }
        }, 300),
        before: null as Entry | null,
        valid: false,
      };
      state.current = pending;
      if (pending.active) setDragging(key(item));
    },
    move(e: PointerEvent<HTMLButtonElement>) {
      const active = state.current;
      if (!active) return;
      if (!active.active) {
        if (Math.hypot(e.clientX - active.x, e.clientY - active.y) > 8) clear();
        return;
      }
      if (!root.current) return;
      e.preventDefault();
      const rows = [
        ...root.current.querySelectorAll<HTMLElement>(
          '[data-library-entry][data-library-kind]',
        ),
      ].filter((row) => row.dataset.libraryKind !== 'graph');
      const target = rows.find(
        (row) =>
          e.clientY <
          row.getBoundingClientRect().top +
            row.getBoundingClientRect().height / 2,
      );
      const bounds = root.current.getBoundingClientRect();
      active.valid =
        e.clientY >= bounds.top - 40 && e.clientY <= bounds.bottom + 40;
      active.before = target
        ? {
            kind: target.dataset.libraryKind as Entry['kind'],
            id: target.dataset.libraryEntry!,
            name: '',
            source_name: '',
            archived: false,
          }
        : null;
      setBefore(
        target
          ? `${target.dataset.libraryKind}:${target.dataset.libraryEntry}`
          : null,
      );
      if (e.clientY < 70) window.scrollBy(0, -20);
      else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 20);
    },
    end() {
      const active = state.current;
      clear();
      if (
        active?.active &&
        active.valid &&
        (!active.before || key(active.before) !== key(active.item))
      )
        onDrop(active.item, active.before);
    },
    cancel: clear,
  };
}
