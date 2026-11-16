import * as React from 'react';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import { List, ListRow } from '../components/ui/list-row';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from '../components/ui/sheet';
import { Caption, Eyebrow } from '../components/ui/text';
import { PoweredByTone3000 } from './credits';

const STARTS = [
  ['empty', 'Empty', 'Input straight to output; add blocks from there'],
  [
    'copy',
    'A copy of what is playing',
    'Rhythm section, with its scenes and versions',
  ],
  ['oxidal', 'An Oxidal sound', 'Finished presets that come with Oxidal'],
  ['tone3000', 'A TONE3000 tone', 'A capture you have, with a cab after it'],
] as const;

/** New preset: a name and where it starts from. */
export function NewPresetDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, from: string) => void;
}) {
  const [name, setName] = React.useState('');
  const [from, setFrom] = React.useState('copy');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="New preset"
          description="It joins Library › Mine. You can add it to a set list after."
        />
        <DialogBody className="grid gap-3">
          <label className="grid gap-0.5">
            <span className="small-caps text-xs text-muted-foreground">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Friday opener"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm"
            />
          </label>
          <div
            role="radiogroup"
            aria-label="Start from"
            className="grid gap-1.5"
          >
            {STARTS.map(([id, title, caption]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={from === id}
                onClick={() => setFrom(id)}
                className="grid gap-0.5 rounded-lg border border-input px-3 py-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-checked:border-foreground aria-checked:bg-foreground aria-checked:text-background"
              >
                <span className="text-sm font-semibold">{title}</span>{' '}
                <span className="text-xs opacity-80">{caption}</span>
              </button>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() => {
              onCreate(name.trim(), from);
              onOpenChange(false);
            }}
          >
            Create preset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Preset details: what it is, its versions, where it is used, the captures
 * it holds and their credits, and what you can do with it, including
 * editing it while audio is stopped.
 */
export function PresetDetails({
  open,
  onOpenChange,
  onDelete,
  onEditOffline,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  onEditOffline: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        onOpenChange={onOpenChange}
        className="md:w-[min(28rem,100vw)]"
      >
        <SheetHeader
          title="Brown Crunch"
          description="Mine · 5 blocks · 3 scenes · changed 14 Nov"
        />
        <SheetBody className="grid content-start gap-4">
          <section className="grid gap-1">
            <Eyebrow>Versions</Eyebrow>
            <List>
              <ListRow
                title="Default"
                caption="Saved at home · 12 Nov"
                trailing={<Badge size="sm">Default</Badge>}
              />
              <ListRow
                title="Friday gig"
                caption="Saved at the venue · 14 Nov"
              />
            </List>
          </section>
          <section className="grid gap-1">
            <Eyebrow>Used in</Eyebrow>
            <Caption>Friday set (song 4) · Rehearsal set (song 2)</Caption>
          </section>
          <section className="grid gap-1">
            <Eyebrow>Captures and IRs</Eyebrow>
            <List>
              <ListRow
                title="Plexi 50"
                caption="NAM A2 · by Jane Capture · CC BY 4.0"
              />
              <ListRow title="4×12 Greenback" caption="IR · yours" />
            </List>
            <PoweredByTone3000 />
          </section>
        </SheetBody>
        <SheetFooter className="flex-wrap">
          <Button variant="outline" onClick={onEditOffline}>
            Edit without playing
          </Button>
          <Button variant="outline">Duplicate</Button>
          <Button variant="outline">Export</Button>
          <Button variant="destructive" onClick={onDelete}>
            Delete…
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/** Delete a preset: names the set lists it is in and asks before it goes. */
export function DeletePresetDialog({
  open,
  onOpenChange,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  const [understood, setUnderstood] = React.useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (setUnderstood(false), onOpenChange(o))}
    >
      <DialogContent>
        <DialogHeader
          title="Delete Brown Crunch?"
          description="Its versions and scenes go with it. Captures and IRs stay in Tones and IRs."
        />
        <DialogBody className="grid gap-2">
          <p className="m-0 text-sm">It is in 2 set lists:</p>
          <ul className="m-0 pl-5 text-sm">
            <li>Friday set, song 4</li>
            <li>Rehearsal set, song 2</li>
          </ul>
          <label className="flex min-h-touch items-center gap-2 text-sm">
            <Checkbox
              checked={understood}
              onCheckedChange={(v) => setUnderstood(v === true)}
            />
            Take it out of those set lists too
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={!understood}
            onClick={onDelete}
          >
            Delete preset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Editing a saved preset while audio is stopped (or another preset plays):
 * a clear band says nothing is heard, and Save writes to the preset.
 */
export function OfflineBanner({
  name,
  onSave,
  onClose,
}: {
  name: string;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-lg border-2 border-dashed border-foreground bg-card px-4 py-2"
    >
      <span className="grid gap-0.5">
        <span className="text-sm font-semibold">
          Editing {name} without playing
        </span>
        <Caption as="span" className="text-xs">
          Nothing you change here is heard. Save writes it to the preset; play
          it to hear it.
        </Caption>
      </span>
      <span className="ml-auto flex gap-2">
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button size="sm" onClick={onSave}>
          Save
        </Button>
      </span>
    </div>
  );
}
