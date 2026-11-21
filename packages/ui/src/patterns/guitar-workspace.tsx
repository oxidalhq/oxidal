import { Guitar, Plus } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { List, ListRow } from '../components/ui/list-row';
import { Caption } from '../components/ui/text';
import { PageHeading } from './app-shell';

export function GuitarWorkspace({
  guitars,
  active,
  caption,
  trimControl,
  onSelect,
  onAdd,
  children,
}: {
  guitars: readonly { id: string; name: string; caption?: string }[];
  active?: string | null;
  caption?: ReactNode;
  trimControl?: ReactNode;
  onSelect?: (id: string) => void;
  onAdd?: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeading
        eyebrow="Guitars"
        title={
          guitars.find((guitar) => guitar.id === active)?.name ?? 'Guitars'
        }
        caption={caption}
        actions={
          <Button variant="outline" disabled={!onAdd} onClick={onAdd}>
            <Plus /> Add guitar
          </Button>
        }
      />
      <div className="grid items-start gap-4 px-page lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Your guitars</CardTitle>
          </CardHeader>
          <List>
            {guitars.map((g) => (
              <ListRow
                key={g.id}
                leading={<Guitar className="ml-2 size-5" />}
                title={g.name}
                caption={g.caption}
                selected={g.id === active}
                onClick={
                  onSelect && g.id !== active ? () => onSelect(g.id) : undefined
                }
                trailing={
                  g.id === active ? (
                    <Badge
                      tone="live"
                      className="border-background text-background"
                    >
                      Plugged in
                    </Badge>
                  ) : undefined
                }
              />
            ))}
          </List>
          {trimControl && (
            <div className="flex items-center justify-between gap-4">
              <div className="grid gap-0.5">
                <span className="text-sm font-medium">Input trim</span>
                <Caption className="text-xs">
                  Applied before the rig for this guitar.
                </Caption>
              </div>
              {trimControl}
            </div>
          )}
        </Card>
        <div className="grid content-start gap-4">{children}</div>
      </div>
    </>
  );
}
