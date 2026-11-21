import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/** The selected block sits under the signal chain, with identity, visual and controls. */
export function BlockDock({
  bypassed,
  className,
  ...props
}: ComponentProps<'section'> & { bypassed?: boolean }) {
  return (
    <section
      {...props}
      data-slot="block-editor-panel"
      className={cn(
        'grid items-start gap-x-5 gap-y-3 rounded-xl border border-foreground/70 bg-raised p-3 shadow-raised lg:grid-cols-[20rem_minmax(12rem,1fr)_17rem]',
        bypassed && 'border-dashed',
        className,
      )}
    />
  );
}
