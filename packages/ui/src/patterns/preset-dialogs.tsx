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

const starts = (playing: string) =>
  [
    ['empty', 'Empty', 'Input straight to output; add blocks from there'],
    [
      'copy',
      'A copy of what is playing',
      `${playing}, with its scenes and versions`,
    ],
    ['oxidal', 'An Oxidal sound', 'Finished presets that come with Oxidal'],
    ['tone3000', 'A TONE3000 tone', 'A capture you have, with a cab after it'],
  ] as const;

export function PresetStartOptions<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly {
    id: T;
    title: string;
    caption: string;
    disabled?: boolean;
  }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const group = React.useId();
  return (
    <fieldset className="m-0 grid min-w-0 gap-1.5 border-0 p-0">
      <legend className="mb-1 small-caps text-xs text-muted-foreground">
        Start from
      </legend>
      {options.map(({ id, title, caption, disabled }) => (
        <label
          key={id}
          className="relative grid cursor-pointer gap-0.5 rounded-lg border border-input px-3 py-2 text-left has-checked:border-foreground has-checked:bg-foreground has-checked:text-background has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-disabled:opacity-50"
        >
          <input
            className="sr-only"
            type="radio"
            name={group}
            checked={value === id}
            disabled={disabled}
            onChange={() => onChange(id)}
          />
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-xs opacity-80">{caption}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** New preset: a name and where it starts from. */
export function NewPresetDialog({
  open,
  onOpenChange,
  onCreate,
  playing,
}: {
  /** The preset playing now, for "A copy of what is playing". */
  playing: string;
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
          <PresetStartOptions
            options={starts(playing).map(([id, title, caption]) => ({
              id,
              title,
              caption,
            }))}
            value={from}
            onChange={setFrom}
          />
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
export type PresetSummary = {
  name: string;
  /** Such as "Mine · 5 blocks · 3 scenes · changed 14 Nov". */
  summary: string;
  versions: { name: string; caption: string; isDefault?: boolean }[];
  /** Set list entries that use it, such as "Friday set, song 4". */
  usedIn: string[];
  /** Captures and IRs, with their credit, such as "NAM A2 · by Jane Capture · CC BY 4.0". */
  sources: { name: string; caption: string; tone3000?: boolean }[];
};

export function PresetDetails({
  preset,
  open,
  onOpenChange,
  onDelete,
  onEditOffline,
  onDuplicate,
  onExport,
}: {
  preset: PresetSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  onEditOffline: () => void;
  onDuplicate: () => void;
  onExport: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        onOpenChange={onOpenChange}
        className="md:w-[min(28rem,100vw)]"
      >
        <SheetHeader title={preset.name} description={preset.summary} />
        <SheetBody className="grid content-start gap-4">
          <section className="grid gap-1">
            <Eyebrow>Versions</Eyebrow>
            <List>
              {preset.versions.map((v) => (
                <ListRow
                  key={v.name}
                  title={v.name}
                  caption={v.caption}
                  trailing={
                    v.isDefault ? <Badge size="sm">Default</Badge> : undefined
                  }
                />
              ))}
            </List>
          </section>
          <section className="grid gap-1">
            <Eyebrow>Used in</Eyebrow>
            <Caption>
              {preset.usedIn.length
                ? preset.usedIn.join(' · ')
                : 'No set list yet'}
            </Caption>
          </section>
          <section className="grid gap-1">
            <Eyebrow>Captures and IRs</Eyebrow>
            <List>
              {preset.sources.map((c) => (
                <ListRow key={c.name} title={c.name} caption={c.caption} />
              ))}
            </List>
            {preset.sources.some((c) => c.tone3000) && <PoweredByTone3000 />}
          </section>
        </SheetBody>
        <SheetFooter className="flex-wrap">
          <Button variant="outline" onClick={onEditOffline}>
            Edit without playing
          </Button>
          <Button variant="outline" onClick={onDuplicate}>
            Duplicate
          </Button>
          <Button variant="outline" onClick={onExport}>
            Export
          </Button>
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
  name,
  usedIn,
  open,
  onOpenChange,
  onDelete,
}: {
  name: string;
  /** Set list entries that use it. */
  usedIn: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
}) {
  const [understood, setUnderstood] = React.useState(false);
  const ready = understood || usedIn.length === 0;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => (setUnderstood(false), onOpenChange(o))}
    >
      <DialogContent>
        <DialogHeader
          title={`Delete ${name}?`}
          description="Its versions and scenes go with it. Captures and IRs stay in Tones and IRs."
        />
        <DialogBody className="grid gap-2">
          {usedIn.length > 0 && (
            <>
              <p className="m-0 text-sm">
                It is in {usedIn.length}{' '}
                {usedIn.length === 1 ? 'set list' : 'set lists'}:
              </p>
              <ul className="m-0 pl-5 text-sm">
                {usedIn.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
              <label className="flex min-h-touch items-center gap-2 text-sm">
                <Checkbox
                  checked={understood}
                  onCheckedChange={(v) => setUnderstood(v === true)}
                />
                Take it out of{' '}
                {usedIn.length === 1 ? 'that set list' : 'those set lists'} too
              </label>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button variant="destructive" disabled={!ready} onClick={onDelete}>
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
