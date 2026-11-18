import {
  ArrowCounterClockwise,
  CaretDown,
  Check,
  ClockCounterClockwise,
  Star,
} from '@phosphor-icons/react';
import * as React from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../components/ui/popover';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Separator } from '../components/ui/separator';
import { Caption, Label } from '../components/ui/text';
import { cn } from '../lib/cn';
import { type Change, describeChange } from '../lib/route-diff';

export type PresetVersion = {
  id: string;
  name: string;
  /** When and where it was saved, as the player reads it. */
  note?: string;
  isDefault?: boolean;
};

/**
 * One preset, several versions of it: the Default plus versions saved for a
 * venue, a rehearsal room or a night ("Friday gig", "Small room"). Tweaks
 * made anywhere are an edit on top of the version playing; from here you
 * save over it, save them as a new version, make a version the default, or
 * throw the edit away. Set list entries can point at a version.
 *
 * (Scenes change a preset while you play; versions are whole alternative
 * takes of it. Helix and QC have only the first; Kemper's rig backups come
 * closest to the second.)
 */
export function VersionPicker({
  presetName,
  versions,
  current,
  changes,
  onSelect,
  onSave,
  onSaveAs,
  onMakeDefault,
  onDiscard,
  className,
}: {
  presetName: string;
  versions: PresetVersion[];
  current: string;
  changes: number;
  onSelect: (id: string) => void;
  onSave: () => void;
  onSaveAs: (name: string) => void;
  onMakeDefault: (id: string) => void;
  onDiscard: () => void;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [naming, setNaming] = React.useState(false);
  const [name, setName] = React.useState('');
  const version = versions.find((v) => v.id === current) ?? versions[0]!;
  const suggestions = [
    'Friday gig',
    'Rehearsal room',
    'Small venue',
    'Outdoor',
  ];
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-slot="version-picker"
            className={cn(
              'inline-flex min-h-9 items-center gap-1 rounded-md px-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              className,
            )}
          >
            <span className="max-w-40 truncate">{version.name}</span>
            {changes > 0 && (
              <Badge tone="warning" size="sm">
                Edited · {changes}
              </Badge>
            )}
            <CaretDown className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Versions of {presetName}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="grid w-80 gap-2 p-2">
          <span className="px-2 pt-1 small-caps text-sm font-medium text-muted-foreground">
            Versions of {presetName}
          </span>
          <div role="radiogroup" aria-label="Versions" className="grid">
            {versions.map((v) => (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={v.id === current}
                onClick={() => {
                  onSelect(v.id);
                  setOpen(false);
                }}
                className="grid min-h-touch grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
              >
                {v.id === current ? (
                  <Check weight="bold" className="size-4" aria-hidden="true" />
                ) : (
                  <span />
                )}
                <span className="grid min-w-0">
                  <span className="truncate text-sm font-medium">{v.name}</span>
                  {v.note && (
                    <span className="truncate text-xs text-muted-foreground">
                      {v.note}
                    </span>
                  )}
                </span>
                {v.isDefault && <Badge size="sm">Default</Badge>}
              </button>
            ))}
          </div>
          <Separator />
          <div className="grid gap-1">
            <Button
              size="sm"
              disabled={!changes}
              onClick={() => {
                onSave();
                setOpen(false);
              }}
            >
              Save to “{version.name}”
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!changes}
              onClick={() => {
                setOpen(false);
                setNaming(true);
              }}
            >
              Save as a new version…
            </Button>
            {!version.isDefault && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onMakeDefault(version.id);
                  setOpen(false);
                }}
              >
                <Star /> Make this the default
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              disabled={!changes}
              onClick={() => {
                onDiscard();
                setOpen(false);
              }}
            >
              <ArrowCounterClockwise /> Discard {changes}{' '}
              {changes === 1 ? 'change' : 'changes'}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent size="sm">
          <DialogHeader
            title="Save as a new version"
            description={`Keeps “${version.name}” as it was and saves your changes beside it.`}
          />
          <DialogBody>
            <div className="grid gap-1">
              <Label htmlFor="version-name">Name</Label>
              <input
                id="version-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Friday gig"
                className="min-h-touch rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="outline"
                  onClick={() => setName(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNaming(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim()}
              onClick={() => {
                onSaveAs(name.trim());
                setName('');
                setNaming(false);
              }}
            >
              Save version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * A/B: hear your edit or the saved version, one tap apart. The choice is a
 * big segmented control so it works from a foot's distance on a phone too.
 */
export function CompareToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: 'edited' | 'saved';
  onChange: (value: 'edited' | 'saved') => void;
  disabled?: boolean;
}) {
  return (
    <SegmentedControl
      size="sm"
      value={value}
      onValueChange={(v) => onChange(v as 'edited' | 'saved')}
      aria-label="Compare"
      className={cn(disabled && 'pointer-events-none opacity-40')}
    >
      <Segment value="edited">Edited</Segment>
      <Segment value="saved">Saved</Segment>
    </SegmentedControl>
  );
}

/** What changed since the version was saved, each line with its own undo. */
export function ChangeList({
  changes,
  onRevert,
}: {
  changes: Change[];
  onRevert?: (change: Change) => void;
}) {
  if (!changes.length) return <Caption>No changes since it was saved.</Caption>;
  return (
    <ul
      aria-label="Changes since saved"
      className="m-0 grid list-none gap-0 p-0"
    >
      {changes.map((change, i) => (
        <li
          key={i}
          className="grid min-h-10 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border py-1 last:border-b-0"
        >
          <ClockCounterClockwise
            className="size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="truncate font-mono text-xs tabular-nums">
            {describeChange(change)}
          </span>
          {onRevert && change.kind === 'value' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRevert(change)}
              aria-label={`Undo: ${describeChange(change)}`}
            >
              Undo
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
