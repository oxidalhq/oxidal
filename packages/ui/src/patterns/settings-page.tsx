import { CaretDown, Info, WarningCircle } from '@phosphor-icons/react';
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible';
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
          <CollapsibleTrigger className="min-h-control px-0 small-caps text-sm font-medium text-muted-foreground hover:bg-transparent hover:text-foreground max-[600px]:min-h-touch [@media(pointer:coarse)]:min-h-touch">
            {title}
          </CollapsibleTrigger>
        </h3>
        <CollapsibleContent className="grid">{children}</CollapsibleContent>
      </section>
    </Collapsible>
  );
}

/**
 * A setting row that opens more below it: advanced options, routing, help,
 * a terminal. Same height, rule and type as `SettingRow`, with a caret on
 * the right that turns; the content opens under the row, inside the group.
 * Replaces raw `<details>` and card-in-card on Settings and Levels pages.
 */
export function SettingDisclosure({
  label,
  caption,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
}: {
  label: React.ReactNode;
  caption?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      open={open}
      onOpenChange={onOpenChange}
      className={cn('grid border-b border-border', className)}
      data-slot="setting-disclosure"
    >
      <CollapsiblePrimitive.Trigger className="group grid min-h-touch w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 py-2 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
        <span className="grid gap-0.5">
          <span className="text-sm font-medium">{label}</span>
          {caption && (
            <Caption as="span" className="text-xs">
              {caption}
            </Caption>
          )}
        </span>
        <CaretDown
          aria-hidden="true"
          className="size-4 text-muted-foreground transition-transform duration-[var(--duration-fast)] group-data-[state=open]:rotate-180"
        />
      </CollapsiblePrimitive.Trigger>
      <CollapsibleContent className="grid min-w-0 gap-3 pb-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * A short message inside a group: why a control is unavailable, a value the
 * device could not read, what to do first. One line with an icon, never a
 * card; an action, when there is one, sits on the right like a row's control.
 */
export function SettingNotice({
  tone = 'info',
  live = false,
  children,
  action,
  className,
}: {
  /** `error` is announced at once, like an alert; `warning` politely. */
  tone?: 'info' | 'warning' | 'error';
  /** An info line that changes as work goes on is announced politely. */
  live?: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const Icon = tone === 'info' ? Info : WarningCircle;
  return (
    <div
      data-slot="setting-notice"
      data-tone={tone}
      role={
        tone === 'error'
          ? 'alert'
          : tone === 'warning' || live
            ? 'status'
            : undefined
      }
      className={cn(
        'flex min-h-touch min-w-0 items-center gap-2 border-b border-border py-2 text-sm',
        tone === 'info' ? 'text-muted-foreground' : 'text-foreground',
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn('size-4 shrink-0', tone !== 'info' && 'text-brand')}
      />
      <span className="min-w-0 flex-1 text-pretty">{children}</span>
      {action && <span className="flex shrink-0 gap-2">{action}</span>}
    </div>
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
