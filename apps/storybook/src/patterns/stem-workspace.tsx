import * as React from 'react';
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Link,
  UploadSimple,
} from '@phosphor-icons/react';
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
  StemMixer,
  type StemControls,
  type StemRole,
} from '../widgets/stem-strip';

type Mix = Partial<Record<StemRole, StemControls>>;
const on = (level = 0): StemControls => ({ level, muted: false, solo: false });
const off: StemControls = { level: -60, muted: true, solo: false };
const ALL: StemRole[] = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'];
const full = (): Mix => Object.fromEntries(ALL.map((r) => [r, on()])) as Mix;

const MIXES: Record<string, { name: string; mix: Mix }> = {
  all: { name: 'Every stem', mix: full() },
  noguitar: { name: 'No guitar', mix: { ...full(), guitar: off } },
  rhythm: {
    name: 'Drums and bass',
    mix: {
      drums: on(),
      bass: on(-2),
      vocals: off,
      guitar: off,
      piano: off,
      other: off,
    },
  },
};

/**
 * One backing song's stems and mixes (Library › Stems). Split it on the
 * device if it has no stems yet, play the stems live while shaping a mix,
 * start from a saved mix, undo and redo, then save the mix as a backing
 * track and link it to a rig or a set list entry. Stems from elsewhere come
 * in through Import.
 */
export function StemWorkspace({
  split: initiallySplit = true,
}: {
  split?: boolean;
}) {
  const [split, setSplit] = React.useState(initiallySplit);
  const [progress, setProgress] = React.useState<number | null>(null);
  const [start, setStart] = React.useState('noguitar');
  const [history, setHistory] = React.useState<Mix[]>([MIXES.noguitar!.mix]);
  const [at, setAt] = React.useState(0);
  const [name, setName] = React.useState('No guitar, for the gig');
  const [saved, setSaved] = React.useState<string[]>(['No guitar']);
  const [importing, setImporting] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearInterval(timer.current)),
    [],
  );
  const mix = history[at]!;

  const begin = () => {
    let p = 0;
    setProgress(p);
    timer.current = setInterval(() => {
      p += 20;
      if (p <= 100) return setProgress(p);
      if (timer.current) clearInterval(timer.current);
      setProgress(null);
      setSplit(true);
    }, 150);
  };
  const push = (next: Mix) => {
    setHistory((h) => [...h.slice(0, at + 1), next]);
    setAt((n) => n + 1);
  };

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Iron Pulse</CardTitle>
          {split ? (
            <Badge size="sm">6 stems · split on this device</Badge>
          ) : (
            <Badge size="sm">No stems yet</Badge>
          )}
        </CardHeader>
        {!split && progress === null && (
          <div className="grid gap-2">
            <Caption>
              Split this song into vocals, drums, bass, guitar, piano and the
              rest, on the device. It takes a few minutes and pauses if the Pi
              gets hot. You can keep playing while it works.
            </Caption>
            <Button className="justify-self-start" onClick={begin}>
              Split into stems
            </Button>
          </div>
        )}
        {progress !== null && (
          <div role="status" className="grid gap-1.5">
            <span className="text-sm">Splitting Iron Pulse… {progress}%</span>
            <Progress value={progress} label="Split progress" />
          </div>
        )}
        {split && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="small-caps text-xs text-muted-foreground">
                Start from
              </span>
              <SegmentedControl
                size="sm"
                value={start}
                onValueChange={(v) => {
                  setStart(v);
                  push(MIXES[v]!.mix);
                }}
                aria-label="Start from"
              >
                {Object.entries(MIXES).map(([id, m]) => (
                  <Segment key={id} value={id}>
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
                onClick={() => setSaved((s) => [...s, name.trim()])}
              >
                Save as backing track
              </Button>
              <Button variant="outline">
                <Link /> Link to…
              </Button>
            </div>
          </div>
        )}
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Saved mixes</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setImporting(true)}
          >
            <UploadSimple /> Import stems…
          </Button>
        </CardHeader>
        <List aria-label="Saved mixes">
          {saved.map((m) => (
            <ListRow
              key={m}
              title={m}
              caption="Backing track · Iron Pulse · 3:42"
            />
          ))}
        </List>
      </Card>
      <Dialog open={importing} onOpenChange={setImporting}>
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
                defaultValue="Glass Room"
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
            <List aria-label="Stem files">
              {['drums.wav', 'bass.wav', 'keys.wav', 'vocals.wav'].map((f) => (
                <ListRow key={f} title={f} caption="48 kHz · 2:58" />
              ))}
            </List>
            <Caption className="text-xs">
              Choose which instrument each file is after they upload.
            </Caption>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImporting(false)}>
              Cancel
            </Button>
            <Button onClick={() => setImporting(false)}>Import 4 files</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
