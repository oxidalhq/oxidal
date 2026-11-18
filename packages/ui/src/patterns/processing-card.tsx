import { Plus } from '@phosphor-icons/react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { List, ListRow } from '../components/ui/list-row';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Progress } from '../components/ui/states';
import { Caption } from '../components/ui/text';

export type BranchPolicy = 'running' | 'sleep';
export type AmpCandidate = {
  id: string;
  label: string;
  /** Capture size, such as "Lite". */
  size: string;
  /** Share of each audio period it needs, 0 to 1. */
  cost: number;
};

const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * How much of each audio period a many-amp preset uses, and whether
 * another amp fits. With **Sleep**, amps not in the playing scene use no
 * processing and wake with no gap, so only the busiest scene change counts
 * against the limit; with **Keep running**, every amp always counts. A new
 * amp is refused before it would cut into the spare the device keeps.
 */
export function ProcessingCard({
  amps,
  policy,
  onPolicy,
  load,
  committed,
  limit,
  busiest,
  freedBySleep,
  candidates,
  onAdd,
  added,
  className,
}: {
  /** Every amp branch, in order, and whether the playing scene plays it. */
  amps: { name: string; size: string; playing: boolean }[];
  policy: BranchPolicy;
  onPolicy: (policy: BranchPolicy) => void;
  /** Share of each audio period used now, 0 to 1 (may pass 1). */
  load: number;
  /** Share the preset can need at once: every amp, or the busiest change. */
  committed: number;
  /** Share the device lets presets use; the rest is kept spare. */
  limit: number;
  /** The scene change that needs the most, while sleeping. */
  busiest?: { from: string; to: string; amps: number };
  /** Share Sleep would free compared with Keep running. */
  freedBySleep: number;
  candidates: AmpCandidate[];
  onAdd: (candidate: AmpCandidate) => void;
  /** The amp just added, for the note under the card. */
  added?: string;
  className?: string;
}) {
  const pct = Math.round(load * 100);
  const playing = amps.filter((a) => a.playing).length;
  const fits = (c: AmpCandidate) => committed + c.cost <= limit;
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Processing</CardTitle>
      </CardHeader>
      <div className="grid gap-1.5">
        <div className="flex items-baseline justify-between text-sm">
          <span>
            {policy === 'sleep'
              ? `${playing} playing · ${amps.length - playing} asleep`
              : `${amps.length} of ${amps.length} amps running`}
          </span>
          <span className="font-mono tabular-nums">{pct}%</span>
        </div>
        <Progress
          value={Math.min(100, pct)}
          label="Share of each audio period"
        />
        <Popover>
          <PopoverTrigger asChild>
            <Button size="sm" variant="outline" className="justify-self-start">
              <Plus /> Add an amp…
            </Button>
          </PopoverTrigger>
          <PopoverContent aria-label="Add an amp" className="grid w-80 gap-2">
            <span className="text-sm font-semibold">Add an amp branch</span>
            <Caption className="text-xs">
              {percent(Math.max(0, limit - committed))} is free. The device
              keeps {percent(1 - limit)} of each audio period spare so a busy
              moment never drops out.
            </Caption>
            <List>
              {candidates.map((c) => (
                <ListRow
                  key={c.id}
                  title={c.label}
                  caption={`NAM ${c.size} · needs ${percent(c.cost)}`}
                  trailing={
                    fits(c) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Add ${c.label}`}
                        onClick={() => onAdd(c)}
                      >
                        Add
                      </Button>
                    ) : (
                      <Badge tone="warning" size="sm">
                        No room
                      </Badge>
                    )
                  }
                />
              ))}
            </List>
            {candidates.some((c) => !fits(c)) && (
              <div className="grid gap-2 border-t border-border pt-2">
                <Caption className="text-xs">
                  To make room, choose a lighter capture size
                  {policy === 'running'
                    ? `, or let silent branches sleep: then only the busiest change counts and ${percent(freedBySleep)} is freed.`
                    : busiest
                      ? `, or take an amp out of the busiest change (${busiest.from} to ${busiest.to}).`
                      : '.'}
                </Caption>
                {policy === 'running' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="justify-self-start"
                    onClick={() => onPolicy('sleep')}
                  >
                    Sleep silent branches
                  </Button>
                )}
              </div>
            )}
          </PopoverContent>
        </Popover>
        {added && (
          <Caption className="text-xs">
            Added {added}. It stays silent until a scene plays it.
          </Caption>
        )}
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-semibold">Silent branches</span>
        <SegmentedControl
          size="sm"
          value={policy}
          onValueChange={(v) => v && onPolicy(v as BranchPolicy)}
          aria-label="Silent branches"
          className="w-full"
        >
          <Segment value="running">Keep running</Segment>
          <Segment value="sleep">Sleep</Segment>
        </SegmentedControl>
        <Caption className="text-xs">
          {policy === 'running'
            ? 'Every scene change is instant: the amp is already warm. Uses the most processing.'
            : `Amps not in the playing scene use no processing and wake with no gap.${busiest ? ` Busiest change: ${busiest.from} to ${busiest.to}, ${busiest.amps} amps.` : ''}`}
        </Caption>
      </div>
      <ul className="m-0 grid gap-1 border-t border-border pt-2 pl-4 text-sm">
        {amps.map((a, i) => (
          <li
            key={`${a.name}-${i}`}
            className={a.playing ? 'font-semibold' : 'text-muted-foreground'}
          >
            {String.fromCharCode(65 + (i % 26))} · {a.name} · NAM {a.size}
          </li>
        ))}
      </ul>
    </Card>
  );
}
