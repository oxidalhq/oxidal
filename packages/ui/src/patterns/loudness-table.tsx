import { MagnifyingGlass } from '@phosphor-icons/react';
import { useMemo, useState } from 'react';

import { Segment, SegmentedControl } from '../components/ui/segmented';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import { cn } from '../lib/cn';

/** One measured sound: a preset, or one scene of it. */
export type MeasuredSound = {
  key: string;
  /** "Preset · Scene", as the device names it. */
  name: string;
  /** Measured loudness before correction, in LUFS. */
  lufs: number;
  /** The stored correction, in dB. */
  offset_db: number;
};

const signed = (n: number) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;

/**
 * Every measured sound on one line: each tick is a preset or scene after its
 * correction, the brand line is the target. Reads at a glance whether the
 * set is even, however many sounds there are; the table has the names.
 */
export function LoudnessStrip({
  sounds,
  target,
  range = 3,
}: {
  sounds: MeasuredSound[];
  target: number;
  /** dB either side of the target the strip shows. */
  range?: number;
}) {
  const x = (lufs: number) =>
    Math.max(0, Math.min(100, ((lufs - target + range) / (2 * range)) * 100));
  return (
    <figure className="m-0 grid gap-1" aria-label="Loudness after correction">
      <div className="relative h-8 rounded-md bg-wire/15">
        {sounds.map((sound) => (
          <span
            key={sound.key}
            aria-hidden="true"
            className="absolute inset-y-1.5 w-px bg-foreground/60"
            style={{ left: `${x(sound.lufs + sound.offset_db)}%` }}
          />
        ))}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-brand"
          style={{ left: '50%' }}
        />
      </div>
      <figcaption className="flex justify-between font-mono text-xs text-muted-foreground tabular-nums">
        <span>{(target - range).toFixed(0)}</span>
        <span className="text-brand">target {target.toFixed(1)} LUFS</span>
        <span>{(target + range).toFixed(0)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * Every measured preset and scene as a table: measured loudness, the stored
 * correction and where it lands. Search narrows by name; sort by name or by
 * how far from the target each lands. The rows scroll inside the table, so a
 * set of hundreds never pushes the rest of the page out of sight.
 */
export function LoudnessTable({
  sounds,
  target,
  className,
}: {
  sounds: MeasuredSound[];
  target: number | null;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<'name' | 'off'>('name');
  const rows = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const found = sounds.filter((sound) =>
      words.every((word) => sound.name.toLowerCase().includes(word)),
    );
    const off = (s: MeasuredSound) =>
      target == null ? 0 : Math.abs(s.lufs + s.offset_db - target);
    return found.sort((a, b) =>
      order === 'off'
        ? off(b) - off(a) || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name),
    );
  }, [sounds, query, order, target]);
  return (
    <div
      data-slot="loudness-table"
      className={cn('grid min-w-0 gap-2', className)}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <MagnifyingGlass
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground"
          />
          <span className="sr-only">Find a preset or scene</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a preset or scene…"
            className="h-control w-full min-w-0 rounded-lg border border-input bg-card ps-8 pe-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-ring [@media(pointer:coarse)]:min-h-touch"
          />
        </label>
        <SegmentedControl
          size="sm"
          aria-label="Sort"
          value={order}
          onValueChange={(value) => value && setOrder(value as 'name' | 'off')}
        >
          <Segment value="name">By name</Segment>
          <Segment value="off">Furthest off</Segment>
        </SegmentedControl>
      </div>
      <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-border bg-card px-3">
        <Table aria-label="Measured levels">
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead>Preset · scene</TableHead>
              <TableHead numeric>Measured</TableHead>
              <TableHead numeric>Correction</TableHead>
              <TableHead numeric>After</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((sound) => {
              const after = sound.lufs + sound.offset_db;
              const off = target != null && Math.abs(after - target) > 1;
              return (
                <TableRow key={sound.key}>
                  <TableCell className="min-w-48">{sound.name}</TableCell>
                  <TableCell numeric>{sound.lufs.toFixed(1)}</TableCell>
                  <TableCell numeric>{signed(sound.offset_db)} dB</TableCell>
                  <TableCell numeric className={cn(off && 'text-brand')}>
                    {after.toFixed(1)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableCaption className="pb-2">
            {rows.length === sounds.length
              ? `${sounds.length} sounds, in LUFS`
              : `${rows.length} of ${sounds.length} sounds, in LUFS`}
          </TableCaption>
        </Table>
      </div>
    </div>
  );
}
