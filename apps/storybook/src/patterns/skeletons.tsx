import * as React from 'react';
import { cn } from '../lib/cn';
import { Skeleton, SkeletonRows } from '../components/ui/states';
import { Caption } from '../components/ui/text';

/**
 * Screen skeletons: the shape of each screen while it loads, so a player
 * sees where things will be instead of a spinner. They appear at once (a
 * skeleton never flashes because it is the page itself), and after two
 * seconds a line says what is still loading and, when known, how far
 * along. Nothing moves under reduced motion or in E-paper.
 */
export function LoadingScreen({
  skeleton,
  label,
  progress,
  detail,
  after = 2000,
  className,
}: {
  skeleton: React.ReactNode;
  /** What is loading, as in "Loading your models". */
  label: string;
  /** 0–100 when known. */
  progress?: number;
  /** A specific line, as in "212 of 300 models". */
  detail?: string;
  after?: number;
  className?: string;
}) {
  const [slow, setSlow] = React.useState(after === 0);
  React.useEffect(() => {
    if (after === 0) return;
    const timer = window.setTimeout(() => setSlow(true), after);
    return () => window.clearTimeout(timer);
  }, [after]);
  return (
    <div
      data-slot="loading-screen"
      aria-busy="true"
      className={cn('relative', className)}
    >
      <div aria-hidden="true">{skeleton}</div>
      <div
        role="status"
        aria-live="polite"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-1/3 grid justify-items-center',
          !slow && 'sr-only',
        )}
      >
        <div className="grid min-w-64 justify-items-center gap-2 rounded-lg border border-border bg-raised px-5 py-4 text-center shadow-raised">
          <span className="text-md font-semibold">{label}…</span>
          {detail && <Caption>{detail}</Caption>}
          {progress !== undefined ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-wire/40">
              <div
                className="h-full rounded-full bg-foreground transition-[width] duration-[var(--duration-base)]"
                style={{ width: `${progress}%` }}
              />
            </div>
          ) : (
            <Caption className="text-xs">
              This can take a moment on first start.
            </Caption>
          )}
        </div>
      </div>
    </div>
  );
}

const Block = ({ className }: { className?: string }) => (
  <Skeleton className={cn('h-14 w-40 rounded-pad', className)} />
);

/** The rig: heading, chain of six blocks, the block strip. */
export function RigSkeleton() {
  return (
    <div className="grid gap-3">
      <div className="flex items-end justify-between px-page pt-3">
        <div className="grid gap-1.5">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-7 w-56" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-9 w-14" />
        </div>
      </div>
      <div className="flex items-center gap-4 overflow-hidden px-page py-2">
        <Skeleton className="h-7 w-10 rounded-full" />
        {Array.from({ length: 6 }, (_, i) => (
          <Block key={i} />
        ))}
        <Skeleton className="h-7 w-10 rounded-full" />
      </div>
      <div className="grid gap-3 border-t border-border px-page py-3 md:grid-cols-[14rem_minmax(0,1fr)]">
        <div className="grid gap-1.5">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-12 w-full" />
        </div>
        <div className="grid grid-cols-2 gap-4 self-end sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="grid gap-1">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Library: the tab row, search, and a list or artwork grid. */
export function LibrarySkeleton({
  artwork = false,
  rows = 6,
}: {
  artwork?: boolean;
  rows?: number;
}) {
  return (
    <div className="grid gap-4 px-page pt-3">
      <Skeleton className="h-7 w-28" />
      <div className="flex gap-4 border-b border-border pb-2">
        {[16, 24, 20, 14, 22].map((w, i) => (
          <Skeleton key={i} className="h-4" style={{ width: `${w * 4}px` }} />
        ))}
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-11 flex-1" />
        <Skeleton className="h-11 w-28" />
      </div>
      {artwork ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3">
          {Array.from({ length: rows * 2 }, (_, i) => (
            <div key={i} className="grid gap-1.5">
              <Skeleton className="aspect-square w-full rounded-pad" />
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <SkeletonRows rows={rows} />
      )}
    </div>
  );
}

/** Settings: the section list and a form of labelled rows. */
export function SettingsSkeleton() {
  return (
    <div className="grid gap-4 px-page pt-3 md:grid-cols-[12rem_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
      <div className="grid content-start gap-3">
        <Skeleton className="h-7 w-40" />
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-border py-2"
          >
            <div className="grid gap-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-7 w-12 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The backing player: transport, position, stems. */
export function PlayerSkeleton() {
  return (
    <div className="grid gap-4 px-page pt-3">
      <div className="flex items-center gap-2">
        <Skeleton className="size-11" />
        <Skeleton className="size-13" />
        <Skeleton className="size-11" />
        <Skeleton className="size-11" />
      </div>
      <Skeleton className="h-1.5 w-full rounded-full" />
      <div className="flex justify-between">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-10" />
      </div>
      <div className="flex h-56 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="grid w-16 justify-items-center gap-2">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-36 w-1.5 rounded-full" />
            <Skeleton className="h-8 w-12" />
          </div>
        ))}
      </div>
    </div>
  );
}
