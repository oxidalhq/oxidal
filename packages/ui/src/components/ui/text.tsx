import type { ComponentProps, ElementType } from 'react';

import { cn } from '../../lib/cn';

/**
 * The four secondary text styles the product repeats everywhere (the old
 * `caption` class appeared 281 times). Body text needs no component.
 *
 * - Caption: secondary text under a title or control.
 * - Eyebrow: the small-caps line above a page title, a section, a block
 *   category or a table column — the system's label voice.
 * - Label: a form or control label.
 * - Readout: a measured value in mono (48 × 3 · 6 ms, −12.0 dB, 120 BPM).
 * - Title: the name of the thing on screen (preset, song, rig), in the
 *   display face at the chosen size.
 */
type TextProps<T extends ElementType> = { as?: T } & Omit<
  ComponentProps<T>,
  'as'
>;

export function Caption<T extends ElementType = 'p'>({
  as,
  className,
  ...props
}: TextProps<T>) {
  const Component = as ?? 'p';
  return (
    <Component
      className={cn('m-0 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export function Eyebrow<T extends ElementType = 'span'>({
  as,
  className,
  ...props
}: TextProps<T>) {
  const Component = as ?? 'span';
  return (
    <Component
      className={cn(
        'small-caps text-sm font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function Label<T extends ElementType = 'label'>({
  as,
  className,
  ...props
}: TextProps<T>) {
  const Component = as ?? 'label';
  return (
    <Component
      className={cn('text-sm font-medium text-foreground', className)}
      {...props}
    />
  );
}

export function Title<T extends ElementType = 'h1'>({
  as,
  size = 'md',
  className,
  ...props
}: TextProps<T> & { size?: 'sm' | 'md' | 'lg' | 'display' }) {
  const Component = as ?? 'h1';
  return (
    <Component
      className={cn(
        'm-0 font-display font-semibold tracking-tight text-foreground',
        {
          sm: 'text-lg',
          md: 'text-2xl',
          lg: 'text-3xl',
          display: 'text-display',
        }[size],
        className,
      )}
      {...props}
    />
  );
}

export function Readout<T extends ElementType = 'span'>({
  as,
  size = 'md',
  className,
  ...props
}: TextProps<T> & { size?: 'sm' | 'md' | 'lg' | 'display' }) {
  const Component = as ?? 'span';
  return (
    <Component
      className={cn(
        'font-mono font-medium text-foreground tabular-nums',
        {
          sm: 'text-sm',
          md: 'text-md',
          lg: 'text-2xl',
          display: 'text-display',
        }[size],
        className,
      )}
      {...props}
    />
  );
}

/**
 * What a page or section is for, in one or two sentences, always as the
 * same quiet line directly under the heading: Settings pages, Library sections and
 * any screen that needs a word of orientation. One per section.
 */
export function Description({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="description"
      className={cn('m-0 max-w-prose text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}
