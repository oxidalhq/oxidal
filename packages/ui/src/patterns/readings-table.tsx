import { type ReactNode, useState } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui/tabs';
import { cn } from '../lib/cn';

/** One reading: what it is, its value, and what it means. */
export type Reading = {
  id: string;
  label: ReactNode;
  value: ReactNode;
  /** What the value means or where it comes from, in one or two lines. */
  detail?: ReactNode;
  /** A reading that needs a look shows its value in the brand colour. */
  attention?: boolean;
  /** A button that acts on this reading, such as "Audio setup". */
  action?: ReactNode;
};

/**
 * A group of readings as a table with labelled columns: Reading, Value and
 * About. On a phone the explanation moves under the reading's name, so the
 * value keeps its column. Values are right-aligned in the mono face.
 * Replaces label-and-value piles on Levels and Diagnostics.
 */
export function ReadingsTable({
  title,
  note,
  readings,
  valueHeading = 'Value',
  className,
}: {
  title: string;
  /** A short qualifier for the whole group, beside the title. */
  note?: ReactNode;
  readings: Reading[];
  valueHeading?: string;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      data-slot="readings-table"
      className={cn('grid min-w-0 gap-1', className)}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="m-0 small-caps text-sm font-medium text-muted-foreground">
          {title}
        </h3>
        {note && (
          <span className="small-caps text-xs text-muted-foreground">
            {note}
          </span>
        )}
      </header>
      {/* On a phone each row is a grid: reading and value side by side, what
          it means underneath, so nothing is hidden and nothing is repeated. */}
      <Table className="max-md:[&_thead]:sr-only max-md:[&_tr]:grid max-md:[&_tr]:grid-cols-[minmax(0,1fr)_auto]">
        {/* The same widths in every readings table, so values line up from
            one group to the next. */}
        <colgroup className="max-md:hidden">
          <col className="w-[26%]" />
          <col className="w-[22%]" />
          <col />
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead>Reading</TableHead>
            <TableHead numeric>{valueHeading}</TableHead>
            <TableHead>About</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {readings.map((reading) => (
            <TableRow
              key={reading.id}
              data-attention={reading.attention || undefined}
            >
              <TableCell>
                <span className="grid gap-1">
                  <span className="font-medium">{reading.label}</span>
                  {reading.action && (
                    <span className="flex flex-wrap gap-2">
                      {reading.action}
                    </span>
                  )}
                </span>
              </TableCell>
              <TableCell
                numeric
                className={cn(
                  'whitespace-normal',
                  reading.attention && 'text-brand',
                )}
              >
                {reading.value}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground max-md:col-span-2 max-md:pt-0">
                {reading.detail}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

export type ReadingsGroup = {
  title: string;
  note?: ReactNode;
  readings: Reading[];
  valueHeading?: string;
};

/**
 * Several reading groups as tabs (Loudness, Guitar, Interface…), so none is
 * pushed below the others. A tab whose group has a reading that needs a look
 * carries a small light, and the first such group opens first.
 */
export function ReadingsTabs({
  groups,
  label = 'Readings',
  className,
}: {
  groups: ReadingsGroup[];
  label?: string;
  className?: string;
}) {
  const needsLook = (g: ReadingsGroup) => g.readings.some((r) => r.attention);
  // Until a tab is chosen, the first group that needs a look is open, as
  // the readings arrive.
  const [tab, setTab] = useState<string | null>(null);
  const shown =
    tab && groups.some((g) => g.title === tab)
      ? tab
      : ((groups.find(needsLook) ?? groups[0])?.title ?? '');
  return (
    <Tabs
      value={shown}
      onValueChange={setTab}
      data-slot="readings-tabs"
      className={cn('grid min-w-0 gap-3', className)}
    >
      {/* Every group stays in sight: the tabs wrap instead of scrolling. */}
      <TabsList
        aria-label={label}
        className="flex-wrap overflow-visible [mask-image:none]"
      >
        {groups.map((group) => (
          <TabsTrigger key={group.title} value={group.title}>
            {group.title}
            {needsLook(group) && (
              <>
                <span
                  aria-hidden="true"
                  className="ml-1.5 inline-block size-1.5 rounded-full bg-brand"
                />
                <span className="sr-only">, needs a look</span>
              </>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {groups.map((group) => (
        <TabsContent key={group.title} value={group.title}>
          <ReadingsTable {...group} />
        </TabsContent>
      ))}
    </Tabs>
  );
}
