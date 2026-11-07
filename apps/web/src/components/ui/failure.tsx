import type { Failure } from '../../lib/useFailure';
import { Button } from './button';

/** The device's own words, when the message on screen rewords them. */
function FailureDetails({ failure }: { failure: Failure }) {
  if (!failure.details || failure.message.includes(failure.details))
    return null;
  return (
    <details className="failure-details">
      <summary>Details</summary>
      <code>{failure.details}</code>
    </details>
  );
}

/**
 * The details and recovery button, for screens that already show their
 * message. Refresh reloads what the screen shows; Try again repeats the
 * failed operation; Protect has no button because turning it off is a
 * deliberate stage action.
 */
export function RecoveryAction({
  failure,
  onRefresh,
  busy = false,
}: {
  failure: Failure | null;
  onRefresh?: () => void;
  busy?: boolean;
}) {
  if (!failure) return null;
  const action =
    failure.recovery === 'retry' && failure.retry
      ? { label: 'Try again', run: failure.retry }
      : failure.recovery === 'refresh' && onRefresh
        ? { label: 'Refresh', run: onRefresh }
        : null;
  return (
    <>
      <FailureDetails failure={failure} />
      {action && (
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={action.run}
        >
          {action.label}
        </Button>
      )}
    </>
  );
}

/** The message with at most one recovery button. */
export function FailureNotice({
  failure,
  onRefresh,
  busy = false,
}: {
  failure: Failure | null;
  onRefresh?: () => void;
  busy?: boolean;
}) {
  if (!failure) return null;
  return (
    <div className="failure-notice" role="alert">
      <p>{failure.message}</p>
      <RecoveryAction failure={failure} onRefresh={onRefresh} busy={busy} />
    </div>
  );
}
