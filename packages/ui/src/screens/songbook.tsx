import { useMemo, useRef, useState } from 'react';

import { Button } from '../components/ui/button';
import { Combobox } from '../components/ui/combobox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Label } from '../components/ui/text';
import { formatOf, parseSong } from '../lib/song';
import {
  type SheetDraft,
  Songbook as SongbookView,
  SongbookEditor,
} from '../patterns/songbook';
import {
  KIND_LABEL,
  type LinkKind,
  type SongEntry,
  type SongLink,
  SONGS,
  TARGETS,
} from './songs.data';

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

/** Fixture data supplies the same controlled Songbook used by the product. */
export function Songbook() {
  const [songs, setSongs] =
    useState<Array<SongEntry & { title?: string }>>(SONGS);
  const [open, setOpen] = useState('harbour');
  const [query, setQuery] = useState('');
  const [linking, setLinking] = useState(false);
  const [editing, setEditing] = useState<{
    id: string | null;
    value: SheetDraft;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const entry = songs.find((s) => s.id === open);
  const song = useMemo(
    () =>
      entry && {
        ...parseSong(entry.source, entry.format),
        ...(entry.title && { title: entry.title }),
      },
    [entry],
  );
  const update = (id: string, change: Partial<SongEntry & { title: string }>) =>
    setSongs((all) => all.map((s) => (s.id === id ? { ...s, ...change } : s)));
  const download = () => {
    if (!entry) return;
    const url = URL.createObjectURL(
      new Blob([entry.source], { type: 'text/plain;charset=utf-8' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${entry.id}.${entry.format === 'chordpro' ? 'cho' : entry.format === 'markdown' ? 'md' : 'txt'}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".txt,.md,.cho,.crd,.chordpro"
        className="sr-only"
        aria-label="Import chord sheet"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            if (file.size > 65536)
              throw new Error('Choose a text sheet of at most 64 KiB.');
            const source = new TextDecoder('utf-8', {
              fatal: true,
              ignoreBOM: true,
            }).decode(await file.arrayBuffer());
            const format = formatOf(file.name);
            setEditing({
              id: null,
              value: {
                source,
                format,
                title: parseSong(source, format).title || file.name,
              },
            });
          } catch {
            setNotice('Choose a UTF-8 text sheet of at most 64 KiB.');
          }
        }}
      />
      <SongbookView
        items={songs.map((s) => {
          const parsed = parseSong(s.source, s.format);
          return {
            id: s.id,
            title: s.title ?? parsed.title,
            caption: [
              s.format === 'chordpro'
                ? 'ChordPro'
                : s.format === 'markdown'
                  ? 'Markdown'
                  : 'Text',
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
        selected={open}
        query={query}
        onQuery={setQuery}
        onOpen={setOpen}
        onImport={() => input.current?.click()}
        onNew={() =>
          setEditing({
            id: null,
            value: { title: '', source: '', format: 'chordpro' },
          })
        }
        onEdit={() =>
          entry &&
          song &&
          setEditing({
            id: entry.id,
            value: {
              title: song.title,
              source: entry.source,
              format: entry.format,
            },
          })
        }
        onLink={() => setLinking(true)}
        onDownload={download}
        onDelete={() => setDeleting(true)}
        song={song}
        size={entry?.size ?? 3}
        onSize={(size) => entry && update(entry.id, { size })}
        speed={entry?.speed ?? 4}
        onSpeed={(speed) => entry && update(entry.id, { speed })}
        linked={entry?.links.map((l) => `${KIND_LABEL[l.kind]} · ${l.label}`)}
        notice={notice && <p role="status">{notice}</p>}
      />
      <LinkDialog
        open={linking}
        onOpenChange={setLinking}
        onLink={(link) =>
          entry &&
          update(entry.id, {
            links: [...entry.links.filter((l) => l.kind !== link.kind), link],
          })
        }
      />
      {editing && (
        <SongbookEditor
          open
          onOpenChange={(shown) => !shown && setEditing(null)}
          value={editing.value}
          onChange={(value) => setEditing({ ...editing, value })}
          onSave={() => {
            if (editing.id) update(editing.id, editing.value);
            else {
              const id = crypto.randomUUID();
              setSongs((all) => [
                ...all,
                { id, ...editing.value, links: [], size: 3, speed: 4 },
              ]);
              setOpen(id);
            }
            setEditing(null);
          }}
        />
      )}
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent size="sm">
          <DialogHeader
            title="Delete song?"
            description={
              entry?.links.length
                ? 'Unlink this song before deleting it.'
                : 'Remove this sheet from Songbook.'
            }
          />
          <DialogBody>
            {entry?.links.map((link) => (
              <p key={`${link.kind}:${link.id}`}>
                {KIND_LABEL[link.kind]} · {link.label}
              </p>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!entry || entry.links.length > 0}
              onClick={() => {
                setSongs((all) => all.filter((s) => s.id !== entry?.id));
                setOpen('');
                setDeleting(false);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
