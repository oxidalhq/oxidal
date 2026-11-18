import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

/**
 * The one small label. `tone` says what kind of fact it states: neutral for
 * categories and counts, live for what is playing or committed (oxide),
 * warning for stale or unsaved, selected for the chosen one (inverted). The
 * text is small caps, so a badge reads as a label and never as a button.
 * Replaces media-chip, oxidal-chip, stem-chips and StateChip.
 */
const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 small-caps font-medium whitespace-nowrap [&_svg]:size-[1em]',
  {
    variants: {
      tone: {
        neutral: 'border-border bg-transparent text-muted-foreground',
        live: 'border-brand bg-brand text-brand-foreground',
        warning: 'border-foreground bg-transparent text-foreground',
        selected: 'border-foreground bg-foreground text-background',
      },
      size: {
        sm: 'h-5 text-xs',
        md: 'h-6 text-sm',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export function Badge({
  className,
  tone,
  size,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      data-tone={tone ?? 'neutral'}
      className={cn(badgeVariants({ tone, size }), className)}
      {...props}
    />
  );
}

const LED_COLOURS = {
  amp: 'bg-led-amp text-led-amp',
  cab: 'bg-led-cab text-led-cab',
  pedal: 'bg-led-pedal text-led-pedal',
  time: 'bg-led-time text-led-time',
  mod: 'bg-led-mod text-led-mod',
  lv2: 'bg-led-lv2 text-led-lv2',
} as const;

/** A category LED beside a name: colour only, the word carries the meaning. */
export function Led({
  kind,
  on = true,
  className,
  ...props
}: ComponentProps<'span'> & {
  kind: 'amp' | 'cab' | 'pedal' | 'time' | 'mod' | 'lv2';
  on?: boolean;
}) {
  return (
    <span
      data-slot="led"
      data-kind={kind}
      data-on={on || undefined}
      aria-hidden="true"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full border border-current',
        on ? LED_COLOURS[kind] : 'bg-transparent text-wire',
        className,
      )}
      {...props}
    />
  );
}
