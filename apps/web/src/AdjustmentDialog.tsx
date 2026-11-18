import { type ReactNode, useEffect, useRef, useState } from 'react';

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
} from '@oxidal/design-system/components/dialog';

/** Shared modal adjustment surface. Radix modality keeps focus and touch events
 * inside the panel; the instrument stays visible behind it. */
export function AdjustmentDialog({
  title,
  description,
  onCancel,
  children,
  className = '',
  returnFocus,
}: {
  title: string;
  /** One quiet line under the title saying what the dialog is for. */
  description?: string;
  onCancel: () => void;
  children: ReactNode;
  className?: string;
  /** Where focus goes on close, when not back to what opened the dialog. */
  returnFocus?: () => HTMLElement | null;
}) {
  const [dialog, setDialog] = useState<HTMLDivElement | null>(null);
  const previous = useRef(document.activeElement as HTMLElement | null);
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    if (!dialog) return;
    // Do not focus a number input automatically: Safari would open the keyboard
    // and zoom before the player chooses exact entry.
    const viewport = window.visualViewport;
    const fit = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offset = viewport?.offsetTop ?? 0;
      dialog.style.setProperty(
        '--adjustment-height',
        `${Math.max(80, height - 16)}px`,
      );
      dialog.style.setProperty(
        '--adjustment-bottom',
        `${Math.max(8, window.innerHeight - height - offset + 8)}px`,
      );
      dialog.style.setProperty('--adjustment-top', `${offset + height / 2}px`);
    };
    fit();
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
    return () => {
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
    };
  }, [dialog]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel.current();
      }}
    >
      <DialogContent
        ref={setDialog}
        className={`top-[var(--adjustment-top,50%)] bottom-auto max-h-[min(calc(100dvh-1rem),var(--adjustment-height,100dvh))] transform-none ${className}`}
        {...(description ? {} : { 'aria-describedby': undefined })}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLElement>('h2')
            ?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (returnFocus?.() ?? previous.current)?.focus({ preventScroll: true });
        }}
      >
        <DialogHeader
          title={title}
          description={description}
          closeLabel="Close dialog"
        />
        <DialogBody className="min-h-0 [&_[data-slot=dialog-footer]]:sticky [&_[data-slot=dialog-footer]]:bottom-0 [&_[data-slot=dialog-footer]]:z-10 [&_[data-slot=dialog-footer]]:bg-raised [&_[data-slot=dialog-footer]]:px-0">
          {children}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
