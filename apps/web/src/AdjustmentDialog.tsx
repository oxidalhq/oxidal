import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Compact modal adjustment surface. Native modality keeps focus and touch events
 * inside the panel; the instrument stays visible behind it. */
export function AdjustmentDialog({
  title,
  onCancel,
  children,
}: {
  title: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const cancel = useRef(onCancel);
  useEffect(() => {
    cancel.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    // Do not focus a number input automatically: Safari would open the keyboard
    // and zoom before the player chooses exact entry.
    dialog.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    const viewport = window.visualViewport;
    const fit = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offset = viewport?.offsetTop ?? 0;
      dialog.style.setProperty(
        '--adjustment-height',
        `${Math.max(80, height - 16)}px`,
      );
      dialog.style.bottom = `${Math.max(8, window.innerHeight - height - offset + 8)}px`;
    };
    fit();
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
    return () => {
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
      dialog.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="adjustment-dialog"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        cancel.current();
      }}
    >
      <h2 id={heading} tabIndex={-1}>
        {title}
      </h2>
      {children}
    </dialog>
  );
}
