import { useState } from 'react';

import { Badge } from '../components/ui/badge';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Caption } from '../components/ui/text';
import type { AuditRecord } from '../patterns/device-dashboard.data';

export function AuditLog({
  records,
  limit,
}: {
  records: AuditRecord[];
  limit?: number;
}) {
  const [show, setShow] = useState<'all' | 'refused'>('all');
  const rows = records.filter(
    (r) => show === 'all' || r.outcome !== 'Accepted',
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>Audit log</CardTitle>
        <SegmentedControl
          size="sm"
          value={show}
          onValueChange={(v) => setShow(v as 'all' | 'refused')}
          aria-label="Show"
        >
          <Segment value="all">All</Segment>
          <Segment value="refused">Refused</Segment>
        </SegmentedControl>
      </CardHeader>
      <Caption className="text-xs">
        Every control request, without its contents. Accepted means the device
        took the request, not that the sound has changed yet.
      </Caption>
      <ul
        aria-label="Audit log entries"
        className="m-0 grid list-none p-0 text-sm"
      >
        {rows.slice(0, limit).map((r, index) => (
          <li
            key={r.at + r.operation + index}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-border py-1.5"
          >
            <span className="font-mono text-xs text-muted-foreground tabular-nums">
              {r.at}
            </span>
            <span className="min-w-0 truncate">{r.operation}</span>
            <span className="text-right font-mono text-xs tabular-nums">
              {r.ms} ms
            </span>
            {r.outcome !== 'Accepted' && (
              <span className="col-start-2">
                <Badge
                  size="sm"
                  tone="warning"
                >{`${r.outcome} · ${r.status}`}</Badge>
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
