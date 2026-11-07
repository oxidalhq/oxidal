import { useCallback, useMemo, useState } from 'react';
import {
  errorDetails,
  errorRecovery,
  friendlyError,
  type Recovery,
} from './friendlyError';

/**
 * One failed operation: the plain message, the single recovery its error code
 * allows, and how to repeat the operation when retrying makes sense (7.24).
 * @see docs/interface.md
 */
export type Failure = {
  message: string;
  /** The device's own text, for a Details disclosure. */
  details: string;
  recovery: Recovery;
  retry?: () => void;
};

/** Keeps the latest failure of a screen's operations; success clears it. */
export function useFailure() {
  const [failure, setFailure] = useState<Failure | null>(null);
  const fail = useCallback(
    (cause: unknown, action: string, retry?: () => void) =>
      setFailure({
        message: friendlyError(cause, action),
        details: errorDetails(cause),
        recovery: errorRecovery(cause),
        retry,
      }),
    [],
  );
  const clear = useCallback(() => setFailure(null), []);
  return useMemo(() => ({ failure, fail, clear }), [failure, fail, clear]);
}
