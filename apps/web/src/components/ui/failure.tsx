import type { Failure } from '../../lib/useFailure';
import { Button } from './button';

/**
 * The message with at most one recovery button. Refresh reloads what the
 * screen shows; Try again repeats the failed operation; Protect has no button
 * here because turning it off is a deliberate stage action.
 */
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
  const action =
    failure.recovery === 'retry' && failure.retry
      ? { label: 'Try again', run: failure.retry }
      : failure.recovery === 'refresh' && onRefresh
        ? { label: 'Refresh', run: onRefresh }
        : null;
  return (
    <div className="failure-notice" role="alert">
      <p>{failure.message}</p>
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
    </div>
  );
}
