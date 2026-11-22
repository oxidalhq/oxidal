import { CaretDown } from '@phosphor-icons/react';

/** Keep storage diagnostics available without displacing the playing controls. */
export function RecoveryNotice({
  message,
}: {
  message: string | null | undefined;
}) {
  if (!message) return null;
  return (
    <details className="min-w-0 border-l-3 border-destructive px-3 text-destructive [&_p]:my-2 [&_p]:wrap-anywhere [&_summary]:flex [&_summary]:min-h-touch [&_summary]:items-center [&_summary]:justify-between [&_summary]:gap-2 open:[&_summary_svg]:rotate-180 [&_svg]:shrink-0">
      <summary>
        <span role="alert">Session recovery unavailable</span>
        <CaretDown aria-hidden="true" size={16} />
      </summary>
      <p>{message}</p>
    </details>
  );
}
