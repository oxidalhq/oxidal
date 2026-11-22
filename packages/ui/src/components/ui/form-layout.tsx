import type { ComponentProps, ElementType } from 'react';

import { cn } from '../../lib/cn';

type LayoutProps<T extends ElementType> = { as?: T } & Omit<
  ComponentProps<T>,
  'as'
>;

/** Keep a native form control together with its accessible label and hint. */
export function FormField<T extends ElementType = 'label'>({
  as,
  className,
  ...props
}: LayoutProps<T>) {
  const Component = as ?? 'label';
  return (
    <Component
      data-slot="form-field"
      className={cn(
        'grid min-w-0 content-start gap-1.5 text-sm font-medium',
        '[&_:is(select,textarea,input:not([type=range],[type=checkbox],[type=radio]))]:min-h-touch [&_:is(select,textarea,input:not([type=range],[type=checkbox],[type=radio]))]:w-full [&_:is(select,textarea,input:not([type=range],[type=checkbox],[type=radio]))]:rounded-lg [&_:is(select,textarea,input:not([type=range],[type=checkbox],[type=radio]))]:border [&_:is(select,textarea,input:not([type=range],[type=checkbox],[type=radio]))]:border-input [&_:is(select,textarea,input:not([type=range],[type=checkbox],[type=radio]))]:bg-card [&_:is(select,textarea,input:not([type=range],[type=checkbox],[type=radio]))]:px-3',
        '[&_textarea]:min-h-24 [&_textarea]:py-2',
        className,
      )}
      {...props}
    />
  );
}

/** One column on a phone, paired controls on a wider screen. */
export function FormGrid<T extends ElementType = 'div'>({
  as,
  className,
  ...props
}: LayoutProps<T>) {
  const Component = as ?? 'div';
  return (
    <Component
      data-slot="form-grid"
      className={cn(
        'my-4 grid min-w-0 items-end gap-4 sm:grid-cols-2 [&>*]:min-w-0',
        className,
      )}
      {...props}
    />
  );
}

export function ActionRow<T extends ElementType = 'div'>({
  as,
  className,
  ...props
}: LayoutProps<T>) {
  const Component = as ?? 'div';
  return (
    <Component
      data-slot="action-row"
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-[max(8px,0.5rem)]',
        className,
      )}
      {...props}
    />
  );
}
