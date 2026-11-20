import { X } from '@phosphor-icons/react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as React from 'react';

import { cn } from '../../lib/cn';
import { Button } from './button';

/**
 * Edit many controls while the screen stays visible: a block's controls,
 * the player, the stems. Rises from the bottom on phones and slides in from
 * the right on `md+` (`side="auto"`), or is pinned to one side. A bottom
 * sheet has a drag handle and closes on a downward swipe; every sheet
 * closes on Escape, the scrim and its Close button. A sheet may open a
 * popover or a confirm dialog, nothing more.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

const SWIPE_TO_CLOSE = 80;

export function SheetContent({
  className,
  children,
  side = 'auto',
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  side?: 'auto' | 'bottom' | 'right';
  /** Called with false when the handle is swiped down. */
  onOpenChange?: (open: boolean) => void;
}) {
  const start = React.useRef<number | null>(null);
  const [offset, setOffset] = React.useState(0);
  const handle = {
    onPointerDown: (event: React.PointerEvent) => {
      start.current = event.clientY;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (start.current === null) return;
      setOffset(Math.max(0, event.clientY - start.current));
    },
    onPointerUp: () => {
      if (offset > SWIPE_TO_CLOSE) onOpenChange?.(false);
      start.current = null;
      setOffset(0);
    },
  };
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-sheet bg-foreground/40"
      />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        style={offset ? { transform: `translateY(${offset}px)` } : undefined}
        className={cn(
          'group fixed z-sheet grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden border-border bg-raised text-foreground shadow-raised transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] outline-none',
          side === 'bottom' &&
            'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-lg border-t pb-[var(--safe-bottom)]',
          side === 'right' &&
            'inset-y-0 right-0 w-[min(28rem,100vw)] grid-rows-[auto_minmax(0,1fr)_auto] border-l',
          side === 'auto' &&
            'max-md:inset-x-0 max-md:bottom-0 max-md:max-h-[85dvh] max-md:rounded-t-lg max-md:border-t max-md:pb-[var(--safe-bottom)] md:inset-y-0 md:right-0 md:w-[min(28rem,100vw)] md:grid-rows-[auto_minmax(0,1fr)_auto] md:border-l',
          className,
        )}
        {...props}
      >
        <div
          data-slot="sheet-handle"
          aria-hidden="true"
          className={cn(
            'flex h-5 touch-none items-center justify-center',
            side === 'right' && 'hidden',
            side === 'auto' && 'md:hidden',
          )}
          {...handle}
        >
          <span className="h-1 w-10 rounded-full bg-wire" />
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetHeader({
  className,
  title,
  description,
  actions,
  children,
  ...props
}: React.ComponentProps<'header'> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small controls beside Close, such as where to keep the sheet. */
  actions?: React.ReactNode;
}) {
  return (
    <header
      data-slot="sheet-header"
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border px-4 pt-1 pb-3 md:pt-4',
        className,
      )}
      {...props}
    >
      <div className="grid gap-0.5">
        <DialogPrimitive.Title className="m-0 text-lg font-semibold">
          {title}
        </DialogPrimitive.Title>
        <DialogPrimitive.Description
          className={cn(
            'm-0 text-sm text-muted-foreground',
            !description && 'sr-only',
          )}
        >
          {description ?? title}
        </DialogPrimitive.Description>
        {children}
      </div>
      <div className="flex items-center gap-0.5">
        {actions}
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Close">
            <X />
          </Button>
        </DialogPrimitive.Close>
      </div>
    </header>
  );
}

export function SheetBody({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-body"
      className={cn(
        'grid content-start gap-4 overflow-y-auto px-4 py-4',
        className,
      )}
      {...props}
    />
  );
}

export function SheetFooter({
  className,
  ...props
}: React.ComponentProps<'footer'>) {
  return (
    <footer
      data-slot="sheet-footer"
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3',
        className,
      )}
      {...props}
    />
  );
}
