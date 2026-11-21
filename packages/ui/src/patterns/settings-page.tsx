import * as React from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible';
import { Caption, Label } from '../components/ui/text';
import { cn } from '../lib/cn';
import { useRemembered } from '../lib/use-remembered';
import { Workspace } from './workspace';

/**
 * Settings: a list of sections on the left and the chosen section's form on
 * the right (the Agent Zero settings layout), a Select above the form on
 * phones. Every setting is a row: label and caption on the left, the
 * control on the right, a touch target high.
 */
export function SettingsPage(
  props: Omit<React.ComponentProps<typeof Workspace>, 'label'>,
) {
  return <Workspace label="Settings" {...props} />;
}

/**
 * A group of settings with a small-caps heading. A named group folds away to
 * save scrolling, and stays the way it was left.
 */
export function SettingGroup({
  title,
  children,
  className,
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const named = typeof title === 'string';
  const [open, setOpen] = useRemembered(
    `oxidal.settings.open.${named ? title : 'group'}`,
    true,
  );
  if (!named)
    return (
      <section data-slot="setting-group" className={cn('grid', className)}>
        {title && (
          <h3 className="m-0 mb-1 small-caps text-sm font-medium text-muted-foreground">
            {title}
          </h3>
        )}
        {children}
      </section>
    );
  return (
    <Collapsible asChild open={open} onOpenChange={setOpen}>
      <section data-slot="setting-group" className={cn('grid', className)}>
        <h3 className="m-0">
          <CollapsibleTrigger className="min-h-9 px-0 small-caps text-sm font-medium text-muted-foreground hover:bg-transparent hover:text-foreground max-[600px]:min-h-touch [@media(pointer:coarse)]:min-h-touch">
            {title}
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent className="grid">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/** One setting: label and caption, the control on the right. */
export function SettingRow({
  id,
  label,
  caption,
  children,
  stacked = false,
  className,
}: {
  id?: string;
  label: React.ReactNode;
  caption?: React.ReactNode;
  children?: React.ReactNode;
  /** The control goes under the label (wide controls, text). */
  stacked?: boolean;
  className?: string;
}) {
  return (
    <div
      data-slot="setting-row"
      className={cn(
        'grid min-h-touch items-center gap-x-4 gap-y-1.5 border-b border-border py-2',
        stacked ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_auto]',
        className,
      )}
    >
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {caption && <Caption className="text-xs">{caption}</Caption>}
      </div>
      {children && (
        <div
          className={cn(
            'flex flex-wrap items-center gap-2',
            !stacked && 'justify-end',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
