import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from '@phosphor-icons/react';
import { cn } from '../../lib/cn';
import { Button } from './button';

/**
 * A decision that must be answered before going on: confirm a delete,
 * change the audio buffer, name a new mix. One dialog surface for the
 * whole product; `AdjustmentDialog` and `SettingDialog` become uses of it.
 * The header stays, the body scrolls, the footer stays. Dialogs never
 * stack on dialogs.
 */
export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  size = 'md',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-dialog bg-foreground/40"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-dialog grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-border bg-raised text-foreground shadow-raised outline-none',
          { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size],
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Title, optional description and the close button. */
export function DialogHeader({
  className,
  title,
  description,
  ...props
}: React.ComponentProps<'header'> & {
  title: React.ReactNode;
  description?: React.ReactNode;
}) {
  return (
    <header
      data-slot="dialog-header"
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 border-b border-border px-5 pt-4 pb-3',
        className,
      )}
      {...props}
    >
      <div className="grid gap-0.5">
        <DialogPrimitive.Title className="m-0 text-lg font-semibold">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="m-0 text-sm text-muted-foreground">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">
            {title}
          </DialogPrimitive.Description>
        )}
      </div>
      <DialogPrimitive.Close asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Close">
          <X />
        </Button>
      </DialogPrimitive.Close>
    </header>
  );
}

/** The scrolling middle. */
export function DialogBody({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn('grid gap-4 overflow-y-auto px-5 py-4', className)}
      {...props}
    />
  );
}

/** Actions, primary last (rightmost); stacked on narrow screens. */
export function DialogFooter({
  className,
  ...props
}: React.ComponentProps<'footer'>) {
  return (
    <footer
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}
