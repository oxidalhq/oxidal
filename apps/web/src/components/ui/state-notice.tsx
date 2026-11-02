import type { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';
import { Alert, AlertDescription, AlertTitle } from './alert';

/**
 * One presentation for the loading, empty and error states of a screen section.
 * Errors announce as alerts; loading and empty states announce politely.
 */
export function StateNotice({
  kind,
  title,
  children,
  action,
  className,
}: {
  kind: 'loading' | 'empty' | 'error';
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Alert
      variant={kind === 'error' ? 'destructive' : 'default'}
      role={kind === 'error' ? 'alert' : 'status'}
      data-state-kind={kind}
      className={twMerge('my-3', className)}
    >
      <AlertTitle>{title}</AlertTitle>
      {children && (
        <AlertDescription className={kind === 'error' ? 'text-current' : ''}>
          {children}
        </AlertDescription>
      )}
      {action && <div className="col-start-2 mt-2">{action}</div>}
    </Alert>
  );
}
