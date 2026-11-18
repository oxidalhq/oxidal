import * as React from 'react';
import { cn } from '../lib/cn';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui/tabs';

export type Section = {
  id: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
  /** What the section is for, in a sentence or two; Settings shows it under the title. */
  description?: string;
};

/**
 * One workspace with sections (Library, Settings): tabs on `sm+`; below
 * that a segmented control for up to four sections and a Select for more,
 * so nothing scrolls sideways on a phone. The chosen section's content is
 * the only panel rendered.
 */
export function Workspace({
  sections,
  value,
  onChange,
  label,
  children,
  className,
}: {
  sections: Section[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const few = sections.length <= 4;
  return (
    <div data-slot="workspace" className={cn('grid gap-4', className)}>
      <div className="px-page sm:hidden">
        {few ? (
          <SegmentedControl
            value={value}
            onValueChange={onChange}
            aria-label={label}
            className="w-full"
          >
            {sections.map((section) => (
              <Segment key={section.id} value={section.id}>
                {section.icon}
                {section.label}
              </Segment>
            ))}
          </SegmentedControl>
        ) : (
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger aria-label={label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.label}
                  {section.count !== undefined ? ` · ${section.count}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <Tabs value={value} onValueChange={onChange} className="grid gap-4">
        <TabsList aria-label={label} className="hidden sm:flex">
          {sections.map((section) => (
            <TabsTrigger key={section.id} value={section.id}>
              {section.icon}
              {section.label}
              {section.count !== undefined && (
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {section.count}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={value} forceMount className="grid gap-4 px-page">
          {children}
        </TabsContent>
      </Tabs>
    </div>
  );
}
