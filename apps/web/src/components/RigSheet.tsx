import { CaretDown, CaretUp, X } from '@phosphor-icons/react';
import { type ReactNode, useRef } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { DockableSheet } from '@oxidal/design-system/patterns/tool-dock';

import { useSessionState } from '../lib/sessionState';

/**
 * The selected block's controls as a sheet under the chain (7.28), in the page
 * flow so it never covers the chain. Hide collapses it to a one-line bar with
 * the block name; Esc inside it does the same. The choice is kept for this
 * browser tab. With `onClose` it has a Close button that clears the selected
 * block, and on a phone it is a bottom sheet over the page.
 * @see docs/interface.md
 */
export function RigSheet({
  title,
  detail,
  actions,
  onClose,
  children,
}: {
  title: string;
  detail?: string;
  /** Header controls such as the block's on/off switch. */
  actions?: ReactNode;
  /** Closes the sheet by clearing the selected block. */
  onClose?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useSessionState('rig-sheet-open', true);
  const toggle = useRef<HTMLButtonElement>(null);
  return (
    <DockableSheet
      id="block-controls"
      title={title}
      open
      onOpenChange={(next) => {
        if (!next) onClose?.();
      }}
      renderSheet={(placement) => (
        <section
          className="rig-sheet group/sheet shadow-lg -mx-1 flex min-w-0 flex-col rounded-t-xl border border-b-0 border-border bg-background max-sm:data-closable:data-open:sticky max-sm:data-closable:data-open:bottom-0 max-sm:data-closable:data-open:z-5 max-sm:data-closable:data-open:max-h-[60dvh] max-sm:data-closable:data-open:overflow-y-auto max-sm:data-closable:data-open:overscroll-contain max-sm:data-closable:data-open:pb-[env(safe-area-inset-bottom)] [[data-display=epaper]_&]:border-2 [[data-display=epaper]_&]:border-foreground [[data-display=epaper]_&]:shadow-none"
          data-open={open || undefined}
          data-closable={onClose ? true : undefined}
          aria-label="Block controls"
          onKeyDown={(event) => {
            if (!open || event.key !== 'Escape' || event.defaultPrevented)
              return;
            const target = event.target as HTMLElement;
            if (
              !event.currentTarget.contains(target) ||
              target.closest('dialog, [role="dialog"]')
            )
              return;
            setOpen(false);
            toggle.current?.focus();
          }}
        >
          <header className="relative flex min-h-touch items-center gap-2 px-3 pt-3 pb-2 group-data-open/sheet:border-b group-data-open/sheet:border-border">
            <span
              className="absolute top-1 left-1/2 h-1 w-10 -translate-x-1/2 rounded-full bg-border"
              aria-hidden="true"
            />
            <div className="rig-sheet-title grid min-w-0 flex-1 [&>strong]:truncate">
              <strong title={title}>{title}</strong>
              {detail && <span className="caption">{detail}</span>}
            </div>
            {open && actions}
            <Button
              variant="outline"
              size="icon"
              ref={toggle}
              type="button"
              className="shrink-0"
              aria-expanded={open}
              aria-label={open ? 'Hide controls' : `Show controls: ${title}`}
              onClick={() => setOpen(!open)}
            >
              {open ? (
                <CaretDown aria-hidden="true" />
              ) : (
                <CaretUp aria-hidden="true" />
              )}
            </Button>
            {onClose && (
              <Button
                variant="outline"
                size="icon"
                type="button"
                className="shrink-0"
                aria-label="Close block panel"
                onClick={onClose}
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </header>
          {open && placement}
          <div className="space-y-3 p-3" hidden={!open}>
            {children}
          </div>
        </section>
      )}
    >
      {detail && <p className="caption">{detail}</p>}
      {actions}
      {children}
    </DockableSheet>
  );
}

/** Children in the sheet when a block is selected, else in place. */
export function MaybeSheet({
  sheet,
  children,
}: {
  sheet: { label: string; detail?: string; onClose?: () => void } | null;
  children: ReactNode;
}) {
  return sheet ? (
    <RigSheet title={sheet.label} detail={sheet.detail} onClose={sheet.onClose}>
      {children}
    </RigSheet>
  ) : (
    <>{children}</>
  );
}
