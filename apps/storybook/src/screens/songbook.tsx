import { useMemo, useState } from 'react';
import {
  CaretLeft,
  CaretRight,
  FilePlus,
  Link,
  PencilSimple,
  Plus,
} from '@phosphor-icons/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Combobox } from '@/components/ui/combobox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Segment, SegmentedControl } from '@/components/ui/segmented';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from '@/components/ui/sheet';
import { Caption, Eyebrow, Label, Title } from '@/components/ui/text';
import { LibraryList } from '@/patterns/library-list';
import { parseSong, type SongFormat } from '@/lib/song';
import { SceneStrip } from './stage-parts';
import { SheetViewer } from '@/widgets/sheet-viewer';
import {
  KIND_LABEL,
  SONGS,
  TARGETS,
  type LinkKind,
  type SongEntry,
  type SongLink,
} from './songs.data';

const FORMAT_LABEL: Record<SongFormat, string> = {
  chordpro: 'ChordPro',
  markdown: 'Markdown',
  text: 'Text',
};

/** Link a song to a preset, a rig or a set list entry: a kind, then the target. */
function LinkDialog({
  open,
  onOpenChange,
  onLink,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLink: (link: SongLink) => void;
}) {
  const [kind, setKind] = useState<LinkKind>('setlist');
  const [target, setTarget] = useState<string | null>(null);
  const options = TARGETS[kind];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader
          title="Link this song"
          description="It opens on stage when the linked preset, rig or set list entry is played."
        />
        <DialogBody>
          <SegmentedControl
            value={kind}
            onValueChange={(v) => {
              setKind(v as LinkKind);
              setTarget(null);
            }}
            aria-label="Link to"
            className="w-full"
          >
            <Segment value="setlist">Set list</Segment>
            <Segment value="preset">Preset</Segment>
            <Segment value="rig">Rig</Segment>
          </SegmentedControl>
          <div className="grid gap-1">
            <Label htmlFor="link-target">{KIND_LABEL[kind]}</Label>
            <Combobox
              id="link-target"
              label={KIND_LABEL[kind]}
              options={options}
              value={target}
              onChange={setTarget}
              placeholder={`Find a ${KIND_LABEL[kind].toLowerCase()}…`}
            />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!target}
            onClick={() => {
              const option = options.find((o) => o.value === target);
              if (option)
                onLink({ kind, id: option.value, label: option.label });
              onOpenChange(false);
            }}
          >
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Edit the words in a sheet: the format, the source, and a live preview below on laptops. */
function EditSheet({
  entry,
  open,
  onOpenChange,
  onSave,
}: {
  entry: SongEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (source: string, format: SongFormat) => void;
}) {
  const [source, setSource] = useState(entry.source);
  const [format, setFormat] = useState<SongFormat>(entry.format);
  const song = useMemo(() => parseSong(source, format), [source, format]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        onOpenChange={onOpenChange}
        className="md:w-[min(44rem,100vw)]"
      >
        <SheetHeader
          title={`Edit ${song.title}`}
          description="Chords in brackets for ChordPro, or on their own line above the words."
        />
        <SheetBody>
          <SegmentedControl
            value={format}
            onValueChange={(v) => setFormat(v as SongFormat)}
            aria-label="Format"
            size="sm"
          >
            <Segment value="chordpro">ChordPro</Segment>
            <Segment value="markdown">Markdown</Segment>
            <Segment value="text">Text</Segment>
          </SegmentedControl>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Words and chords</span>
            <textarea
              value={source}
              onChange={(e) => setSource(e.target.value)}
              spellCheck={false}
              rows={14}
              className="min-h-48 rounded-lg border border-input bg-background p-3 font-mono text-sm leading-relaxed outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </label>
          <div className="hidden md:grid">
            <Eyebrow className="mb-1">Preview</Eyebrow>
            <SheetViewer song={song} size={1} className="h-72" />
          </div>
        </SheetBody>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(source, format);
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Library › Songbook: lyrics and chord sheets, each linkable to a preset, a
 * rig or a set list entry. Import reads .txt, .md and ChordPro files; the
 * open song shows in the viewer beside the list on laptops and full width
 * on phones.
 */
export function Songbook() {
  const [songs, setSongs] = useState(SONGS);
  const [open, setOpen] = useState<string>('harbour');
  const [query, setQuery] = useState('');
  const [linking, setLinking] = useState(false);
  const [editing, setEditing] = useState(false);
  const entry = songs.find((s) => s.id === open) ?? songs[0]!;
  const song = useMemo(() => parseSong(entry.source, entry.format), [entry]);
  const update = (id: string, change: Partial<SongEntry>) =>
    setSongs((all) => all.map((s) => (s.id === id ? { ...s, ...change } : s)));
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <LibraryList
        items={songs.map((s) => {
          const parsed = parseSong(s.source, s.format);
          return {
            id: s.id,
            title: parsed.title,
            caption: [
              FORMAT_LABEL[s.format],
              parsed.key && `Key ${parsed.key}`,
              s.links.length
                ? s.links
                    .map((l) => `${KIND_LABEL[l.kind]} ${l.label}`)
                    .join(', ')
                : 'Not linked',
            ]
              .filter(Boolean)
              .join(' · '),
          };
        })}
        query={query}
        onQuery={setQuery}
        selected={open}
        onOpen={setOpen}
        primary={
          <>
            <Button variant="outline">
              <FilePlus /> Import…
            </Button>
            <Button>
              <Plus /> New song
            </Button>
          </>
        }
        empty={{
          title: 'No songs yet',
          text: 'Import lyrics or chord sheets as text, Markdown or ChordPro, or write one.',
        }}
        actions={[
          {
            label: 'Link to…',
            run: (id) => {
              setOpen(id);
              setLinking(true);
            },
          },
          {
            label: 'Edit',
            run: (id) => {
              setOpen(id);
              setEditing(true);
            },
          },
          { label: 'Download', run: () => {} },
          { label: 'Delete…', destructive: true, run: () => {} },
        ]}
      />
      <div className="grid min-h-[32rem] gap-2 lg:h-[calc(100dvh-14rem)]">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setLinking(true)}>
            <Link /> Link to…
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <PencilSimple /> Edit
          </Button>
        </div>
        <SheetViewer
          song={song}
          size={entry.size}
          onSize={(size) => update(entry.id, { size })}
          speed={entry.speed}
          onSpeed={(speed) => update(entry.id, { speed })}
          linked={entry.links.map((l) => `${KIND_LABEL[l.kind]} · ${l.label}`)}
          className="min-h-0"
        />
      </div>
      <LinkDialog
        open={linking}
        onOpenChange={setLinking}
        onLink={(link) =>
          update(entry.id, {
            links: [...entry.links.filter((l) => l.kind !== link.kind), link],
          })
        }
      />
      {editing && (
        <EditSheet
          key={entry.id}
          entry={entry}
          open={editing}
          onOpenChange={setEditing}
          onSave={(source, format) => update(entry.id, { source, format })}
        />
      )}
    </div>
  );
}

const SET = [
  { name: 'Rhythm section', song: 'harbour' },
  { name: 'Ambient swell', song: 'night' },
  { name: 'Lead boost', song: null },
];

/**
 * The stage with the set list's linked sheet: a compact preset line with
 * previous/next on top, the words filling the screen, the scenes in a strip
 * at the bottom. Stepping the set list opens the next song's sheet; an
 * entry with no song shows the scenes large instead.
 */
export function StageWithSheet() {
  const [index, setIndex] = useState(0);
  const [sizes, setSizes] = useState<Record<string, number>>({
    harbour: 4,
    night: 4,
  });
  const [speed, setSpeed] = useState(4);
  const [scene, setScene] = useState('b');
  const item = SET[index]!;
  const entry = SONGS.find((s) => s.id === item.song);
  const song = entry ? parseSong(entry.source, entry.format) : null;
  return (
    <div
      data-slot="stage-with-sheet"
      className="grid h-[calc(100dvh-7rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-2 px-page py-2"
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        <Button
          size="icon-lg"
          variant="outline"
          aria-label="Previous preset"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
        >
          <CaretLeft weight="bold" />
        </Button>
        <div className="grid min-w-0 justify-items-center text-center">
          <Eyebrow>
            {index + 1} of {SET.length} · Friday set
          </Eyebrow>
          <Title size="lg" className="w-full truncate">
            {item.name}
          </Title>
          {song && (
            <Caption className="truncate text-xs">
              {song.title}
              {song.key ? ` · Key ${song.key}` : ''}
              {song.capo ? ` · Capo ${song.capo}` : ''}
            </Caption>
          )}
        </div>
        <Button
          size="icon-lg"
          variant="outline"
          aria-label="Next preset"
          disabled={index === SET.length - 1}
          onClick={() => setIndex(index + 1)}
        >
          <CaretRight weight="bold" />
        </Button>
      </div>
      {song && entry ? (
        <SheetViewer
          key={entry.id}
          stage
          song={song}
          size={sizes[entry.id] ?? 4}
          onSize={(size) => setSizes((all) => ({ ...all, [entry.id]: size }))}
          speed={speed}
          onSpeed={setSpeed}
          className="min-h-0 border-y border-border"
        />
      ) : (
        <div className="grid content-center justify-items-center gap-2 text-center">
          <Badge>No song linked</Badge>
          <Caption>
            Link a song to this set list entry in Library › Songbook.
          </Caption>
        </div>
      )}
      <SceneStrip active={scene} onSelect={setScene} large={!song} />
    </div>
  );
}
