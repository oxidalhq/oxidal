import { useEffect, useRef, type ReactNode } from 'react';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { useSessionState } from '../lib/sessionState';

/**
 * The selected block's controls as a sheet under the chain (7.28), in the page
 * flow so it never covers the chain. Hide collapses it to a one-line bar with
 * the block name; Esc inside it does the same. The choice is kept for this
 * browser tab.
 * @see docs/interface.md
 */
export function RigSheet({
  title,
  detail,
  actions,
  children,
}: {
  title: string;
  detail?: string;
  /** Header controls such as the block's on/off switch. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useSessionState('rig-sheet-open', true);
  const body = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const sheet = body.current?.parentElement;
    const close = (event: KeyboardEvent) => {
      // A dialog opened from the sheet handles its own Esc first.
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const focused = document.activeElement;
      if (!sheet?.contains(focused)) return;
      if (focused?.closest('dialog, [role="dialog"]')) return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open, setOpen]);
  return (
    <section
      className="rig-sheet"
      data-open={open || undefined}
      aria-label="Block controls"
    >
      <header className="rig-sheet-header">
        <span className="rig-sheet-handle" aria-hidden="true" />
        <div className="rig-sheet-title">
          <strong>{title}</strong>
          {detail && <span className="caption">{detail}</span>}
        </div>
        {open && actions}
        <button
          ref={toggle}
          type="button"
          className="rig-sheet-toggle"
          aria-expanded={open}
          aria-label={open ? 'Hide controls' : `Show controls: ${title}`}
          onClick={() => setOpen(!open)}
        >
          {open ? (
            <CaretDown aria-hidden="true" />
          ) : (
            <CaretUp aria-hidden="true" />
          )}
        </button>
      </header>
      <div ref={body} className="rig-sheet-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** Children in the sheet when a block is selected, else in place. */
export function MaybeSheet({
  sheet,
  children,
}: {
  sheet: { label: string; detail?: string } | null;
  children: ReactNode;
}) {
  return sheet ? (
    <RigSheet title={sheet.label} detail={sheet.detail}>
      {children}
    </RigSheet>
  ) : (
    <>{children}</>
  );
}
