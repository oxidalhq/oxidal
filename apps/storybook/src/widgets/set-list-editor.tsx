import * as React from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  DotsSixVertical,
  PencilSimple,
  Play,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import { cn } from '../lib/cn';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { CollapsibleSection } from '../components/ui/collapsible';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from '../components/ui/sheet';
import { EmptyState } from '../components/ui/states';
import { Caption, Label, Title } from '../components/ui/text';
import { useFlip } from '../lib/use-flip';

export type PresetChoice = {
  id: string;
  name: string;
  versions: string[];
  scenes: string[];
};
export type SetListEntry = {
  key: string;
  preset: string;
  version: string;
  scene: string;
  track?: string;
  sheet?: string;
};
export type Choice = { id: string; label: string };

/**
 * A set list in one place: the order you will play tonight. Three things,
 * always in view:
 *
 * 1. **Add presets** — pick several at once from a searchable sheet.
 * 2. **Put them in order** — drag the handle (or focus it and use the arrow
 *    keys); the numbers follow.
 * 3. **Tell each song what to use** — tap a song for its version, the scene
 *    it starts on, its backing track and its chord sheet.
 *
 * Then **Play this set** opens the stage on song 1.
 */
export function SetListEditor({
  name,
  entries,
  onChange,
  presets,
  tracks,
  sheets,
  onPlay,
  onPlayFrom,
  className,
}: {
  name: string;
  entries: SetListEntry[];
  onChange: (entries: SetListEntry[]) => void;
  presets: PresetChoice[];
  tracks: Choice[];
  sheets: Choice[];
  onPlay?: () => void;
  /** Start the set from this song. */
  onPlayFrom?: (key: string) => void;
  className?: string;
}) {
  const [adding, setAdding] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [picked, setPicked] = React.useState<string[]>([]);
  const [query, setQuery] = React.useState('');
  const list = React.useRef<HTMLOListElement>(null);
  const startY = React.useRef(0);
  const [drag, setDrag] = React.useState<{ key: string; over: number } | null>(
    null,
  );
  const rows = React.useRef<Map<string, HTMLLIElement>>(new Map());
  const flip = useFlip(list, entries.map((e) => e.key).join('|'));
  const presetOf = (id: string) => presets.find((p) => p.id === id);
  const entry = entries.find((e) => e.key === editing);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= entries.length || from === to) return;
    const next = [...entries];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    onChange(next);
  };
  const overIndex = (clientY: number) => {
    let index = entries.length - 1;
    for (let i = 0; i < entries.length; i++) {
      const row = rows.current.get(entries[i]!.key);
      if (!row) continue;
      const box = row.getBoundingClientRect();
      // The dragged row follows the finger; judge by where it rests.
      const shift =
        drag && entries[i]!.key === drag.key ? clientY - startY.current : 0;
      if (clientY < box.top - shift + box.height / 2) {
        index = i;
        break;
      }
    }
    return index;
  };
  const describe = (e: SetListEntry) =>
    [
      e.version !== 'Default' && `${e.version} version`,
      `starts on ${e.scene}`,
      e.track ? tracks.find((t) => t.id === e.track)?.label : 'no track',
      e.sheet && `sheet: ${sheets.find((s) => s.id === e.sheet)?.label}`,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <section
      data-slot="set-list-editor"
      aria-label={`Set list ${name}`}
      className={cn('grid gap-3', className)}
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="grid gap-0.5">
          <Title as="h2" size="md">
            {name}
          </Title>
          <Caption>
            {entries.length ? `${entries.length} songs` : 'Empty'}
          </Caption>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setPicked([]);
              setQuery('');
              setAdding(true);
            }}
          >
            <Plus /> Add presets
          </Button>
          <Button disabled={!entries.length} onClick={onPlay}>
            <Play weight="fill" /> Play this set
          </Button>
        </div>
      </div>

      <CollapsibleSection
        title="How a set list works"
        defaultOpen={entries.length === 0}
      >
        <ol className="m-0 grid gap-1 pl-5 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Add presets</strong> in any
            order — you can pick several at once.
          </li>
          <li>
            <strong className="text-foreground">Drag the handle</strong> to put
            them in the order you will play.
          </li>
          <li>
            <strong className="text-foreground">Tap a song</strong> to choose
            its version, the scene it starts on, its backing track and its chord
            sheet.
          </li>
        </ol>
      </CollapsibleSection>

      {entries.length === 0 ? (
        <EmptyState
          title="No songs in this set yet"
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus /> Add presets
            </Button>
          }
        >
          A set list is the order you will play tonight. Next and Previous on
          your footswitches follow it.
        </EmptyState>
      ) : (
        <ol
          aria-label="Songs in order"
          className="m-0 grid list-none gap-2 p-0"
          ref={list}
          onPointerMove={(event) => {
            if (!drag) return;
            // The row follows the finger; the others make room on drop.
            const row = rows.current.get(drag.key);
            if (row)
              row.style.translate = `0 ${event.clientY - startY.current}px`;
            setDrag({ ...drag, over: overIndex(event.clientY) });
          }}
          onPointerUp={() => {
            if (drag) {
              flip.snapshot();
              const row = rows.current.get(drag.key);
              if (row) row.style.translate = '';
              move(
                entries.findIndex((e) => e.key === drag.key),
                drag.over,
              );
              setTimeout(flip.play, 0);
            }
            setDrag(null);
          }}
        >
          {entries.map((e, index) => {
            const preset = presetOf(e.preset);
            const dragging = drag?.key === e.key;
            const dropHere = drag && !dragging && drag.over === index;
            return (
              <li
                key={e.key}
                ref={(el) => {
                  if (el) rows.current.set(e.key, el);
                  else rows.current.delete(e.key);
                }}
                data-flip={e.key}
                data-dragging={dragging || undefined}
                className={cn(
                  'relative grid min-h-touch grid-cols-[auto_2rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg border border-border bg-card py-1.5 pr-3',
                  dragging && 'z-10 rounded-lg bg-raised shadow-raised',
                  dropHere &&
                    'before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:bg-foreground',
                )}
              >
                <button
                  type="button"
                  aria-label={`Move ${preset?.name ?? 'song'}, position ${index + 1} of ${entries.length}`}
                  aria-describedby="set-list-move-hint"
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    startY.current = event.clientY;
                    setDrag({ key: e.key, over: index });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      move(index, index - 1);
                    } else if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      move(index, index + 1);
                    }
                  }}
                  className="inline-flex size-touch cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring active:cursor-grabbing"
                >
                  <DotsSixVertical weight="bold" className="size-5" />
                </button>
                <span className="text-center font-mono text-md font-semibold tabular-nums">
                  {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setEditing(e.key)}
                  className="grid min-w-0 gap-0.5 rounded-md py-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <span className="truncate text-md font-semibold">
                    {preset?.name ?? 'Missing preset'}
                  </span>{' '}
                  <span className="truncate text-xs text-muted-foreground">
                    {describe(e)}
                  </span>
                </button>
                <span className="flex items-center gap-1">
                  <Badge size="sm" className="max-sm:hidden">
                    {e.track && e.sheet
                      ? 'Track and sheet'
                      : e.track
                        ? 'Track'
                        : e.sheet
                          ? 'Sheet'
                          : 'Preset only'}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    aria-label={`Edit ${preset?.name ?? 'song'}`}
                    onClick={() => setEditing(e.key)}
                  >
                    <PencilSimple />
                    <span className="max-sm:sr-only">Edit</span>
                  </Button>
                  {onPlayFrom && (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Play from ${preset?.name ?? 'song'}`}
                      onClick={() => onPlayFrom(e.key)}
                    >
                      <Play />
                      <span className="max-sm:sr-only">Play</span>
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      <Caption id="set-list-move-hint" className="text-xs">
        Drag a handle to reorder, or focus it and press the up and down arrows.
        Removing a song never deletes the preset.
      </Caption>

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent onOpenChange={setAdding}>
          <SheetHeader
            title={`Add to ${name}`}
            description="Pick one or several; they go to the end of the set in the order you pick them."
          />
          <SheetBody>
            <input
              type="search"
              aria-label="Find a preset"
              placeholder="Find a preset…"
              value={query}
              onChange={(ev) => setQuery(ev.target.value)}
              className="min-h-touch rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <ul aria-label="Presets" className="m-0 grid list-none p-0">
              {presets
                .filter((p) =>
                  p.name.toLowerCase().includes(query.toLowerCase()),
                )
                .map((p) => {
                  const order = picked.indexOf(p.id);
                  return (
                    <li
                      key={p.id}
                      className="flex min-h-touch items-center gap-2 border-b border-border last:border-b-0"
                    >
                      <Checkbox
                        id={`pick-${p.id}`}
                        checked={order >= 0}
                        onCheckedChange={(on) =>
                          setPicked((all) =>
                            on ? [...all, p.id] : all.filter((x) => x !== p.id),
                          )
                        }
                      />
                      <label
                        htmlFor={`pick-${p.id}`}
                        className="flex flex-1 items-center justify-between gap-2 py-2 text-sm font-medium"
                      >
                        {p.name}
                        {order >= 0 && (
                          <Badge size="sm" tone="selected">
                            {entries.length + order + 1}
                          </Badge>
                        )}
                      </label>
                    </li>
                  );
                })}
            </ul>
          </SheetBody>
          <SheetFooter>
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              disabled={!picked.length}
              onClick={() => {
                onChange([
                  ...entries,
                  ...picked.map((id, i) => ({
                    key: `${id}-${Date.now()}-${i}`,
                    preset: id,
                    version: 'Default',
                    scene: presetOf(id)?.scenes[0] ?? 'Scene 1',
                  })),
                ]);
                setAdding(false);
              }}
            >
              Add {picked.length || ''} to the set
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Sheet open={!!entry} onOpenChange={(open) => !open && setEditing(null)}>
        {entry && (
          <SheetContent onOpenChange={(open) => !open && setEditing(null)}>
            <SheetHeader
              title={`${entries.indexOf(entry) + 1} · ${presetOf(entry.preset)?.name ?? ''}`}
              description="What this song uses when the set reaches it."
            />
            <SheetBody>
              {(() => {
                const preset = presetOf(entry.preset)!;
                const set = (change: Partial<SetListEntry>) =>
                  onChange(
                    entries.map((x) =>
                      x.key === entry.key ? { ...x, ...change } : x,
                    ),
                  );
                return (
                  <>
                    <div className="grid gap-1">
                      <Label as="span">Version</Label>
                      <SegmentedControl
                        value={entry.version}
                        onValueChange={(version) => set({ version })}
                        aria-label="Version"
                        className="w-full"
                      >
                        {preset.versions.map((v) => (
                          <Segment key={v} value={v}>
                            {v}
                          </Segment>
                        ))}
                      </SegmentedControl>
                    </div>
                    <div className="grid gap-1">
                      <Label as="span">Starts on</Label>
                      <SegmentedControl
                        value={entry.scene}
                        onValueChange={(scene) => set({ scene })}
                        aria-label="Starts on scene"
                        className="w-full"
                      >
                        {preset.scenes.map((s) => (
                          <Segment key={s} value={s}>
                            {s}
                          </Segment>
                        ))}
                      </SegmentedControl>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="entry-track">Backing track</Label>
                      <Select
                        value={entry.track ?? 'none'}
                        onValueChange={(v) =>
                          set({ track: v === 'none' ? undefined : v })
                        }
                      >
                        <SelectTrigger id="entry-track">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {tracks.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor="entry-sheet">Chord sheet</Label>
                      <Select
                        value={entry.sheet ?? 'none'}
                        onValueChange={(v) =>
                          set({ sheet: v === 'none' ? undefined : v })
                        }
                      >
                        <SelectTrigger id="entry-sheet">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {sheets.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                );
              })()}
            </SheetBody>
            <SheetFooter>
              <div className="grid w-full gap-2">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={entries.indexOf(entry) === 0}
                    onClick={() =>
                      move(entries.indexOf(entry), entries.indexOf(entry) - 1)
                    }
                  >
                    <ArrowUp /> Earlier
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={entries.indexOf(entry) === entries.length - 1}
                    onClick={() =>
                      move(entries.indexOf(entry), entries.indexOf(entry) + 1)
                    }
                  >
                    <ArrowDown /> Later
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const at = entries.indexOf(entry);
                      onChange([
                        ...entries.slice(0, at + 1),
                        { ...entry, key: `${entry.key}-copy-${Date.now()}` },
                        ...entries.slice(at + 1),
                      ]);
                    }}
                  >
                    <Copy /> Play it twice
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      onChange(entries.filter((x) => x.key !== entry.key));
                      setEditing(null);
                    }}
                  >
                    <Trash /> Remove from set
                  </Button>
                </div>
                <Button onClick={() => setEditing(null)}>Done</Button>
              </div>
            </SheetFooter>
          </SheetContent>
        )}
      </Sheet>
    </section>
  );
}
