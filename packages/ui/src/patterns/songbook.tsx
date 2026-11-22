import {
  DownloadSimple,
  FilePlus,
  Link,
  MusicNotesSimple,
  PencilSimple,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import { type ReactNode, useMemo, useRef } from 'react';

import { Button } from '../components/ui/button';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
} from '../components/ui/sheet';
import { Eyebrow } from '../components/ui/text';
import { parseSong, type Song, type SongFormat } from '../lib/song';
import { useMedia } from '../lib/use-media';
import { SheetViewer, type SubscribeSheetMidi } from '../widgets/sheet-viewer';
import { LibraryList } from './library-list';

export type SongbookItem = { id: string; title: string; caption?: string };
export type SheetDraft = { title: string; source: string; format: SongFormat };

/** Controlled Songbook: selecting or reading a sheet sends no musical command. */
export function Songbook({
  items,
  selected,
  query,
  onQuery,
  onOpen,
  onImport,
  onNew,
  onEdit,
  onLink,
  onDownload,
  onDelete,
  busy = false,
  song,
  size,
  onSize,
  speed,
  onSpeed,
  subscribeMidi,
  linked,
  notice,
  more,
}: {
  items: SongbookItem[];
  selected?: string | null;
  query: string;
  onQuery: (query: string) => void;
  onOpen: (id: string) => void;
  onImport: () => void;
  onNew: () => void;
  onEdit: () => void;
  onLink: () => void;
  onDownload: () => void;
  onDelete: () => void;
  busy?: boolean;
  song?: Song;
  size: number;
  onSize: (size: number) => void;
  speed: number;
  onSpeed: (speed: number) => void;
  subscribeMidi?: SubscribeSheetMidi;
  linked?: string[];
  notice?: ReactNode;
  more?: ReactNode;
}) {
  const wide = useMedia('(min-width: 64rem)');
  const viewer = useRef<HTMLDivElement>(null);
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      {notice && <div className="lg:col-span-2">{notice}</div>}
      <div className="grid min-w-0 content-start gap-3">
        <LibraryList
          items={items}
          query={query}
          onQuery={onQuery}
          selected={selected}
          onOpen={(id) => {
            onOpen(id);
            if (!wide)
              viewer.current?.scrollIntoView?.({
                block: 'start',
                behavior: 'auto',
              });
          }}
          layout="list"
          tile={<MusicNotesSimple />}
          noun={['song', 'songs']}
          primary={
            <>
              <Button variant="outline" disabled={busy} onClick={onImport}>
                <FilePlus /> Import…
              </Button>
              <Button disabled={busy} onClick={onNew}>
                <Plus /> New song
              </Button>
            </>
          }
          empty={{
            title: 'No songs yet',
            text: 'Import lyrics or chord sheets as text, Markdown or ChordPro, or write one.',
          }}
        />
        {more}
      </div>
      <div
        ref={viewer}
        className="grid min-h-[32rem] min-w-0 scroll-mt-4 grid-rows-[auto_minmax(0,1fr)] gap-2 lg:h-[calc(100dvh-14rem)]"
      >
        {song ? (
          <>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onLink}
              >
                <Link /> Link to…
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onEdit}
              >
                <PencilSimple /> Edit
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={onDownload}
              >
                <DownloadSimple /> Download
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={onDelete}
              >
                <Trash /> Delete…
              </Button>
            </div>
            <SheetViewer
              key={selected}
              song={song}
              size={size}
              onSize={onSize}
              speed={speed}
              subscribeMidi={subscribeMidi}
              onSpeed={onSpeed}
              linked={linked}
              className="min-h-0"
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Choose a song to read its words and chords.
          </p>
        )}
      </div>
    </div>
  );
}

/** The caller retains a failed or stale draft and closes only after a saved receipt. */
export function SongbookEditor({
  open,
  onOpenChange,
  value,
  onChange,
  busy = false,
  canSave = true,
  error,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: SheetDraft;
  onChange: (value: SheetDraft) => void;
  busy?: boolean;
  canSave?: boolean;
  error?: ReactNode;
  onSave: () => void;
}) {
  const song = useMemo(
    () => parseSong(value.source, value.format, value.title),
    [value],
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        onOpenChange={onOpenChange}
        className="md:w-[min(44rem,100vw)]"
      >
        <SheetHeader
          title={value.title ? `Edit ${value.title}` : 'New song'}
          description="Chords in brackets for ChordPro, or on their own line above the words."
        />
        <SheetBody>
          {error}
          <label className="grid gap-1 text-sm font-medium">
            Title
            <input
              value={value.title}
              maxLength={120}
              disabled={busy}
              onChange={(e) => onChange({ ...value, title: e.target.value })}
              className="min-h-touch rounded-lg border border-input bg-background px-3"
            />
          </label>
          <SegmentedControl
            value={value.format}
            onValueChange={(format) =>
              onChange({ ...value, format: format as SongFormat })
            }
            aria-label="Format"
            size="sm"
            disabled={busy}
          >
            <Segment value="chordpro">ChordPro</Segment>
            <Segment value="markdown">Markdown</Segment>
            <Segment value="text">Text</Segment>
          </SegmentedControl>
          <label className="grid gap-1">
            <span className="text-sm font-medium">Words and chords</span>
            <textarea
              value={value.source}
              disabled={busy}
              onChange={(e) => onChange({ ...value, source: e.target.value })}
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
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={
              busy || !canSave || !value.title.trim() || !value.source.trim()
            }
            onClick={onSave}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
