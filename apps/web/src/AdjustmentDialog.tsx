import { X } from '@phosphor-icons/react';
import { Button } from './components/ui/button';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from './components/ui/dialog';

/** Shared modal adjustment surface. Radix modality keeps focus and touch events
 * inside the panel; the instrument stays visible behind it. */
export function AdjustmentDialog({
  title,
  onCancel,
  children,
  className = '',
}: {
  title: string;
  onCancel: () => void;
  children: ReactNode;
  className?: string;
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
        className={`adjustment-dialog ${className}`}
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)
            ?.querySelector<HTMLElement>('h2')
            ?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          previous.current?.focus({ preventScroll: true });
        }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="adjustment-heading">
          <DialogTitle tabIndex={-1}>{title}</DialogTitle>
          <Button
            variant="ghost"
            className="h-11 w-11 shrink-0 p-0"
            aria-label="Close dialog"
            onClick={() => cancel.current()}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="dialog-body">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
