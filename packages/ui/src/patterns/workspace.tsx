import { CaretRight } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Description } from '../components/ui/text';
import { cn } from '../lib/cn';

export type Section = {
  id: string;
  label: string;
  icon?: ReactNode;
  description?: string;
};

/** A section directory on wide screens and a compact picker on phones. */
export function Workspace({
  sections,
  current,
  onSelect,
  title,
  label,
  showTitle = true,
  children,
  className,
}: {
  sections: readonly Section[];
  current: string;
  onSelect: (id: string) => void;
  title?: ReactNode;
  label: string;
  showTitle?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const titleId = `${label.toLowerCase()}-section-title`;
  const section = sections.find((s) => s.id === current);
  return (
    <div
      data-slot="workspace"
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 px-page md:grid-cols-[13rem_minmax(0,1fr)] md:gap-8',
        className,
      )}
    >
      <div className="min-w-0 md:hidden">
        <Select value={current} onValueChange={onSelect}>
          <SelectTrigger aria-label={`${label} section`}>
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
        aria-label={`${label} sections`}
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
        aria-labelledby={titleId}
        className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-5"
      >
        <h2
          id={titleId}
          className={
            showTitle
              ? 'm-0 font-display text-2xl font-semibold tracking-tight'
              : 'sr-only'
          }
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
