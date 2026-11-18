import * as React from 'react';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import { CircleNotch } from '@phosphor-icons/react';
import { cn } from '../../lib/cn';
import { Button } from './button';
import { Caption } from './text';
import { StableLabel } from './stable-label';

/**
 * The states a section passes through: loading (Skeleton, Loading), empty
 * (EmptyState), working (Progress, StepProgress). Errors go to the notice
 * tray or a Card with a recovery button, never a red box.
 */

/** A placeholder the shape of what is coming. Pulses unless motion is reduced. */
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-md bg-muted motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

/** Rows of the list that is loading. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="grid min-h-touch grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border px-2 py-2 last:border-b-0"
        >
          <Skeleton className="size-8 rounded-lg" />
          <div className="grid gap-1.5">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/**
 * One loading line for the whole product. Waits 300 ms before showing, so
 * quick loads never flash, then says what is loading. Sits where the
 * content will be; the rest of the screen stays usable.
 */
export function Loading({
  label,
  delay = 300,
}: {
  /** What is loading, as in "Loading Library…". */
  label: string;
  delay?: number;
}) {
  const [shown, setShown] = React.useState(delay === 0);
  React.useEffect(() => {
    if (delay === 0) return;
    const timer = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(timer);
  }, [delay]);
  return (
    <div
      data-slot="loading"
      role="status"
      aria-live="polite"
      className="flex min-h-touch items-center gap-2 text-sm text-muted-foreground"
    >
      {shown && (
        <>
          <CircleNotch
            aria-hidden="true"
            className="size-4 animate-spin motion-reduce:animate-none"
          />
          <span>{label}</span>
        </>
      )}
    </div>
  );
}

/**
 * Nothing here yet, and what to do about it. One sentence, one action.
 * Never an illustration.
 */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      role="status"
      className={cn(
        'grid justify-items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center',
        className,
      )}
    >
      {icon && (
        <span className="text-muted-foreground [&_svg]:size-7">{icon}</span>
      )}
      <p className="m-0 text-md font-semibold">{title}</p>
      {children && <Caption className="max-w-prose">{children}</Caption>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** A bar for work with a known fraction. Indeterminate when `value` is undefined. */
export function Progress({
  value,
  label,
  className,
  ...props
}: Omit<React.ComponentProps<typeof ProgressPrimitive.Root>, 'value'> & {
  value?: number;
  label: string;
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      aria-label={label}
      value={value ?? null}
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-wire/40',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'h-full rounded-full bg-foreground transition-[width] duration-[var(--duration-base)]',
          value === undefined &&
            'w-1/3 animate-pulse motion-reduce:animate-none',
        )}
        style={value === undefined ? undefined : { width: `${value}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

/**
 * Long work in known steps reports which one is running: "Step 2 of 3 ·
 * Saving details". The bar moves only when a step finishes, so it suits
 * reduced motion and e-paper. Cancel stops before the next step.
 */
export function StepProgress({
  label,
  steps,
  current,
  onCancel,
  cancelling = false,
}: {
  /** What the whole job is, as in "Splitting Iron Pulse". */
  label: string;
  steps: string[];
  /** Index of the running step. */
  current: number;
  /** Offered only while another step follows the running one. */
  onCancel?: () => void;
  cancelling?: boolean;
}) {
  const index = Math.max(0, Math.min(steps.length - 1, current));
  return (
    <div
      data-slot="step-progress"
      role="status"
      aria-live="polite"
      className="grid gap-2"
    >
      <p className="m-0 text-sm">
        {label} · Step {index + 1} of {steps.length} · {steps[index]}
      </p>
      <Progress label={label} value={(index / steps.length) * 100} />
      {onCancel && index < steps.length - 1 && (
        <Button
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={cancelling}
          onClick={onCancel}
        >
          <StableLabel
            value={cancelling ? 'Stopping…' : 'Cancel'}
            options={['Cancel', 'Stopping…']}
          />
        </Button>
      )}
    </div>
  );
}
