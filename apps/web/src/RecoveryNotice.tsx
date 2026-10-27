import { CaretDown } from '@phosphor-icons/react';

/** Keep storage diagnostics available without displacing the playing controls. */
export function RecoveryNotice({
  message,
}: {
  message: string | null | undefined;
}) {
  if (!message) return null;
  return (
    <details className="recovery-notice">
      <summary>
        <span role="alert">Session recovery unavailable</span>
        <CaretDown aria-hidden="true" size={16} />
      </summary>
      <p>{message}</p>
    </details>
  );
}
