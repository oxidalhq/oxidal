import { CaretRight } from '@phosphor-icons/react';
import * as React from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Caption, Label } from '../components/ui/text';
import { Description } from '../components/ui/text';
import { cn } from '../lib/cn';
import { useRemembered } from '../lib/use-remembered';
import type { Section } from './workspace';

/**
 * Settings: a list of sections on the left and the chosen section's form on
 * the right (the Agent Zero settings layout), a Select above the form on
 * phones. Every setting is a row: label and caption on the left, the
 * control on the right, a touch target high.
 */
export function SettingsPage({
  sections,
  current,
  onSelect,
  title,
  children,
  className,
}: {
  sections: Section[];
  current: string;
  onSelect: (id: string) => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const section = sections.find((s) => s.id === current);
  return (
    <div
      data-slot="settings-page"
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 px-page md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8',
        className,
      )}
    >
      <div className="min-w-0 md:hidden">
        <Select value={current} onValueChange={onSelect}>
          <SelectTrigger aria-label="Settings section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <nav
        aria-label="Settings sections"
        className="hidden content-start gap-0.5 md:grid"
      >
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-current={s.id === current ? 'page' : undefined}
            onClick={() => onSelect(s.id)}
            className="grid min-h-touch grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring aria-[current=page]:bg-foreground aria-[current=page]:text-background [&_svg]:size-4"
          >
            {s.icon ?? <span />}
            <span className="truncate">{s.label}</span>
            <CaretRight className="opacity-50 aria-[current=page]:opacity-100" />
          </button>
        ))}
      </nav>
      <section
        aria-labelledby="settings-section-title"
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5"
      >
        <h2
          id="settings-section-title"
          className="m-0 font-display text-2xl font-semibold tracking-tight"
        >
          {title ?? section?.label}
        </h2>
        {section?.description && (
          <Description>{section.description}</Description>
        )}
        {children}
      </section>
    </div>
  );
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
          <CollapsibleTrigger className="min-h-9 px-0 small-caps text-sm font-medium text-muted-foreground hover:bg-transparent hover:text-foreground [@media(pointer:coarse)]:min-h-touch">
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
