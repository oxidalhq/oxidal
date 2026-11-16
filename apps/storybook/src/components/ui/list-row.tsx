import * as React from 'react';
import { cn } from '../../lib/cn';

/**
 * One item in a list of similar things: a preset, a track, a model, a
 * guitar, a setting. Leading (LED, artwork, checkbox), a title with an
 * optional caption, and trailing content (badge, readout, menu). The row is
 * at least a touch target high. With `onClick` the title becomes a button
 * whose hit area stretches over the whole row, while leading and trailing
 * controls stay separate buttons above it, so nothing is nested.
 */
export function ListRow({
  className,
  leading,
  title,
  caption,
  trailing,
  selected = false,
  onClick,
  children,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title' | 'onClick'> & {
  leading?: React.ReactNode;
  title: React.ReactNode;
  caption?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  const text = (
    <>
      <span className="truncate text-sm font-medium">{title}</span>
      {caption && (
        <span
          className={cn(
            'truncate text-xs',
            selected ? 'text-background/70' : 'text-muted-foreground',
          )}
        >
          {caption}
        </span>
      )}
    </>
  );
  return (
    <div
      data-slot="list-row"
      data-selected={selected || undefined}
      className={cn(
        'relative grid min-h-touch grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border px-2 py-2 text-left',
        onClick && 'hover:bg-accent has-[button:focus-visible]:bg-accent',
        selected && 'bg-foreground text-background hover:bg-foreground',
        className,
      )}
      {...props}
    >
      <span className="relative z-10 col-start-1 flex items-center empty:hidden">
        {leading}
      </span>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="col-start-2 grid min-w-0 cursor-pointer gap-0.5 rounded-md text-left outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-ring"
        >
          {text}
        </button>
      ) : (
        <span className="col-start-2 grid min-w-0 gap-0.5">{text}</span>
      )}
      <span className="relative z-10 col-start-3 flex items-center gap-2 empty:hidden">
        {trailing}
      </span>
      {children}
    </div>
  );
}

/** The container: rows stack with shared rules; the last row has none. */
export function List({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="list"
      className={cn(
        'grid [&>[data-slot=list-row]:last-child]:border-b-0',
        className,
      )}
      {...props}
    />
  );
}
