import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/cn';

/**
 * One item in a list of similar things: a preset, a track, a model, a
 * guitar, a setting. Leading (LED, artwork, checkbox), a title with an
 * optional caption, and trailing content (badge, readout, menu). The row is
 * at least a touch target high; when `onClick`/`href` is set the whole row
 * is the control and trailing buttons stop propagation themselves.
 */
export function ListRow({
  className,
  leading,
  title,
  caption,
  trailing,
  selected = false,
  asChild = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  leading?: React.ReactNode;
  title: React.ReactNode;
  caption?: React.ReactNode;
  trailing?: React.ReactNode;
  selected?: boolean;
  asChild?: boolean;
}) {
  const Component = asChild ? Slot : 'div';
  const interactive = Boolean(props.onClick);
  return (
    <Component
      data-slot="list-row"
      data-selected={selected || undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={
        interactive
          ? (event: React.KeyboardEvent<HTMLDivElement>) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                (event.currentTarget as HTMLElement).click();
              }
            }
          : undefined
      }
      className={cn(
        'grid min-h-touch grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-b border-border px-2 py-2 text-left',
        interactive &&
          'cursor-pointer hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
        selected && 'bg-foreground text-background hover:bg-foreground',
        className,
      )}
      {...props}
    >
      <span className="col-start-1 flex items-center empty:hidden">
        {leading}
      </span>
      <span className="col-start-2 grid min-w-0 gap-0.5">
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
      </span>
      <span className="col-start-3 flex items-center gap-2 empty:hidden">
        {trailing}
      </span>
      {children}
    </Component>
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
