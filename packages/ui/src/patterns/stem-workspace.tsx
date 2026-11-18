import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Link,
  UploadSimple,
} from '@phosphor-icons/react';
import * as React from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import { List, ListRow } from '../components/ui/list-row';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Progress } from '../components/ui/states';
import { Caption } from '../components/ui/text';
import {
  type StemControls,
  StemMixer,
  type StemRole,
} from '../widgets/stem-strip';

export type StemMix = Partial<Record<StemRole, StemControls>>;
export type StemSplit =
  | { state: 'none' }
  | { state: 'splitting'; progress: number }
  | { state: 'ready'; count: number };
export type StemImport = {
  song: string;
  files: { name: string; caption: string }[];
};

/**
 * One backing song's stems and mixes (Library › Stems). Split it on the
 * device if it has no stems yet, play the stems live while shaping a mix,
 * start from a saved mix, undo and redo, then save the mix as a backing
 * track and link it to a rig or a set list entry. Stems from elsewhere come
 * in through Import.
 */
export function StemWorkspace({
  song,
  split,
  starts,
  saved,
  pendingImport,
  onSplit,
  onMix,
  onSave,
  onLink,
  onImport,
  onConfirmImport,
  onCancelImport,
}: {
  song: { name: string; length: string };
  split: StemSplit;
  /** Mixes to start from; the first is selected. */
  starts: { id: string; name: string; mix: StemMix }[];
  /** Backing tracks saved from this song. */
  saved: string[];
  /** Files chosen for import, before they are imported. */
  pendingImport?: StemImport;
  onSplit: () => void;
  /** The mix you hear, as you change it. */
  onMix?: (mix: StemMix) => void;
  onSave: (name: string, mix: StemMix) => void;
  onLink: (name: string) => void;
  /** Choose stem files to import. */
  onImport: () => void;
  onConfirmImport: () => void;
  onCancelImport: () => void;
}) {
  const [start, setStart] = React.useState(starts[0]?.id ?? '');
  const [history, setHistory] = React.useState<StemMix[]>([
    starts[0]?.mix ?? {},
  ]);
  const [at, setAt] = React.useState(0);
  const [name, setName] = React.useState(
    starts[0] ? `${starts[0].name}, for the gig` : '',
  );
  const mix = history[at]!;
  const progress = split.state === 'splitting' ? split.progress : null;
  const ready = split.state === 'ready';
  const push = (next: StemMix) => {
    setHistory((h) => [...h.slice(0, at + 1), next]);
    setAt((n) => n + 1);
    onMix?.(next);
  };

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{song.name}</CardTitle>
          {ready ? (
            <Badge size="sm">{split.count} stems · split on this device</Badge>
          ) : (
            <Badge size="sm">No stems yet</Badge>
          )}
        </CardHeader>
        {split.state === 'none' && (
          <div className="grid gap-2">
            <Caption>
              Split this song into vocals, drums, bass, guitar, piano and the
              rest, on the device. It takes a few minutes and pauses if the Pi
              gets hot. You can keep playing while it works.
            </Caption>
            <Button className="justify-self-start" onClick={onSplit}>
              Split into stems
            </Button>
          </div>
        )}
        {progress !== null && (
          <div role="status" className="grid gap-1.5">
            <span className="text-sm">
              Splitting {song.name}… {progress}%
            </span>
            <Progress value={progress} label="Split progress" />
          </div>
        )}
        {ready && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="small-caps text-xs text-muted-foreground">
                Start from
              </span>
              <SegmentedControl
                size="sm"
                value={start}
                onValueChange={(v) => {
                  const from = starts.find((m) => m.id === v);
                  if (!from) return;
                  setStart(v);
                  push(from.mix);
                }}
                aria-label="Start from"
              >
                {starts.map((m) => (
                  <Segment key={m.id} value={m.id}>
                    {m.name}
                  </Segment>
                ))}
              </SegmentedControl>
              <span className="ml-auto flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Undo"
                  disabled={at === 0}
                  onClick={() => setAt(at - 1)}
                >
                  <ArrowCounterClockwise />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Redo"
                  disabled={at >= history.length - 1}
                  onClick={() => setAt(at + 1)}
                >
                  <ArrowClockwise />
                </Button>
              </span>
            </div>
            <StemMixer
              stems={mix}
              onChange={(role, next) => push({ ...mix, [role]: next })}
              className="h-56"
            />
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid min-w-48 flex-1 gap-0.5">
                <span className="small-caps text-xs text-muted-foreground">
                  Mix name
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring"
                />
              </label>
              <Button
                disabled={!name.trim()}
                onClick={() => onSave(name.trim(), mix)}
              >
                Save as backing track
              </Button>
              <Button variant="outline" onClick={() => onLink(name.trim())}>
                <Link /> Link to…
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Saved mixes</CardTitle>
          <Button size="sm" variant="outline" onClick={onImport}>
            <UploadSimple /> Import stems…
          </Button>
        </CardHeader>
        <List aria-label="Saved mixes">
          {saved.map((m) => (
            <ListRow
              key={m}
              title={m}
              caption={`Backing track · ${song.name} · ${song.length}`}
            />
          ))}
        </List>
      </Card>
      <Dialog
        open={Boolean(pendingImport)}
        onOpenChange={(o) => !o && onCancelImport()}
      >
        <DialogContent>
          <DialogHeader
            title="Import stems"
            description="Stems you made elsewhere: one file per instrument, all the same length."
          />
          <DialogBody className="grid gap-3">
            <label className="grid gap-0.5">
              <span className="small-caps text-xs text-muted-foreground">
                Song name
              </span>
              <input
                defaultValue={pendingImport?.song}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <List aria-label="Stem files">
              {pendingImport?.files.map((f) => (
                <ListRow key={f.name} title={f.name} caption={f.caption} />
              ))}
            </List>
            <Caption className="text-xs">
              Choose which instrument each file is after they upload.
            </Caption>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={onCancelImport}>
              Cancel
            </Button>
            <Button onClick={onConfirmImport}>
              Import {pendingImport?.files.length} files
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
