import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';

export const Dialog = DialogPrimitive.Root;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

/** Radix modality and focus management, with the shared Oxidal dialog surface. */
export function DialogContent({
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content data-slot="dialog-content" {...props}>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogFooter({
  className = '',
  ...props
}: React.ComponentProps<'div'>) {
  return <div className={`dialog-footer ${className}`} {...props} />;
}

/** Fixed top bar of a dialog: title, optional description and the close button. */
export function DialogHeader({
  className = '',
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={`adjustment-heading ${className}`}
      {...props}
    />
  );
}

/** The scrolling middle of a dialog; a DialogFooter inside it stays pinned. */
export function DialogBody({
  className = '',
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={`dialog-body ${className}`}
      {...props}
    />
  );
}
