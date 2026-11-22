import { useMemo, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Combobox } from '@oxidal/design-system/components/combobox';
import { formatOf, parseSong } from '@oxidal/design-system/lib/song';
import {
  Songbook as SongbookView,
  SongbookEditor,
} from '@oxidal/design-system/patterns/songbook';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import {
  chordSheetBackup,
  chordSheetExport,
  libraryCatalog,
  mediaLibrary,
  parseSheetArchive,
  type SheetArchive,
  type SheetLinks,
} from '../../api';
import { friendlyError } from '../../lib/friendlyError';
import { useSessionState } from '../../lib/sessionState';
import { useWorkspaceState } from '../../workspaceMemory';
import { useSongbook } from './useSongbook';

type Target = SheetLinks['links'][number]['target'];
type TargetChoice = {
  value: string;
  label: string;
  caption: string;
  target: Target;
};
const targetKey = (target: Target) => JSON.stringify(target);
const targetLabel = (target: Target) =>
  target.kind === 'preset'
    ? `${target.preset.kind} preset ${target.preset.id.slice(0, 12)}`
    : `Backing track ${target.asset}`;

/** Only text is imported; source is retained for exact export and parsed as text nodes. */
async function readText(file: File, maximum: number): Promise<string> {
  if (file.size > maximum)
    throw new Error(
      `This file exceeds the ${maximum.toLocaleString()} byte limit.`,
    );
  const text = new TextDecoder('utf-8', {
    fatal: true,
    ignoreBOM: true,
  }).decode(await file.arrayBuffer());
  if (!text.trim()) throw new Error('The file contains no words or chords.');
  return text;
}

function download(path: string) {
  const anchor = document.createElement('a');
  anchor.href = path;
  anchor.download = '';
  anchor.click();
}

/** Device-backed Songbook, with local viewer choices and retained conflicting drafts.
 * @see docs/media.md
 */
export function Songbook({ connected }: { connected: boolean }) {
  const book = useSongbook(connected);
  const [query, setQuery] = useSessionState('songbook-query', '');
  const [preferences, setPreferences] = useSessionState<
    Record<string, { size: number; speed: number }>
  >('songbook-viewer', {});
  const [linking, setLinking] = useWorkspaceState('songbook-link-open', false);
  const [choices, setChoices] = useState<TargetChoice[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [targetsBusy, setTargetsBusy] = useState(false);
  const [restore, setRestore] = useState<{
    archive: SheetArchive;
    expected?: string;
    damage?: string;
  }>();
  const file = useRef<HTMLInputElement>(null);
  const backupFile = useRef<HTMLInputElement>(null);
  const busy = book.busy || book.loading || !connected || !!book.damage;
  const shown = book.shown;
  const song = useMemo(
    () =>
      shown ? parseSong(shown.source, shown.format, shown.title) : undefined,
    [shown],
  );
  const ownLinks =
    book.links?.links.filter((link) => link.sheet === shown?.id) ?? [];
  const storedPreferences =
    preferences && typeof preferences === 'object' ? preferences : {};
  const stored = shown ? storedPreferences[shown.id] : undefined;
  const viewer = {
    size:
      stored &&
      Number.isInteger(stored.size) &&
      stored.size >= 0 &&
      stored.size <= 8
        ? stored.size
        : 3,
    speed:
      stored &&
      Number.isInteger(stored.speed) &&
      stored.speed >= 1 &&
      stored.speed <= 10
        ? stored.speed
        : 4,
  };
  const preference = (next: Partial<typeof viewer>) => {
    if (!shown) return;
    setPreferences((all) =>
      Object.fromEntries([
        ...Object.entries(all && typeof all === 'object' ? all : {})
          .filter(([id]) => id !== shown.id)
          .slice(-127),
        [shown.id, { ...viewer, ...next }],
      ]),
    );
  };
  const openLinks = async () => {
    setLinking(true);
    setTargetsBusy(true);
    setTarget(null);
    try {
      const [catalog, media] = await Promise.all([
        libraryCatalog(),
        mediaLibrary(),
      ]);
      setChoices([
        ...catalog.items
          .filter((item) => !item.archived && !item.superseded)
          .map((item): TargetChoice => {
            const target: Target = {
              kind: 'preset',
              preset: { id: item.id, kind: item.kind },
            };
            return {
              value: targetKey(target),
              label: item.name,
              caption: `${item.kind} preset`,
              target,
            };
          }),
        ...media.assets
          .filter((asset) => asset.kind === 'backing')
          .map((asset): TargetChoice => {
            const target: Target = { kind: 'track', asset: asset.id };
            return {
              value: targetKey(target),
              label: asset.title,
              caption: 'Backing track',
              target,
            };
          }),
      ]);
    } catch (cause) {
      book.setError(friendlyError(cause, 'read sheet link targets'));
    } finally {
      setTargetsBusy(false);
    }
  };
  const label = (target: Target) =>
    choices.find((choice) => targetKey(choice.target) === targetKey(target))
      ?.label ?? targetLabel(target);
  const notices = (
    <div className="grid gap-2">
      {!connected && (
        <p role="status">
          Oxidal is disconnected. Your draft stays here; reconnect to save it.
        </p>
      )}
      {book.loading && <p role="status">Reading Songbook…</p>}
      {book.error && <p role="alert">{book.error}</p>}
      {book.warning && <p role="status">{book.warning}</p>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!connected || book.busy || book.loading}
          onClick={() => void book.refresh().catch(() => {})}
        >
          Refresh
        </Button>
        <a
          className="inline-flex min-h-touch items-center text-sm underline"
          href={chordSheetBackup}
          download
        >
          Download Songbook backup
        </a>
        <Button
          variant="outline"
          size="sm"
          disabled={
            !connected ||
            book.busy ||
            book.loading ||
            (!book.damage && (!book.page || book.page.sheets.length > 0))
          }
          onClick={() => backupFile.current?.click()}
        >
          Restore Songbook backup…
        </Button>
      </div>
      {!book.damage && !!book.page?.sheets.length && (
        <p className="text-xs text-muted-foreground">
          Restore requires an empty Songbook. Download a backup before removing
          songs.
        </p>
      )}
    </div>
  );
  return (
    <>
      <SongbookView
        items={(book.page?.sheets ?? []).map((sheet) => ({
          id: sheet.id,
          title: sheet.title,
          caption:
            sheet.format === 'chordpro'
              ? 'ChordPro'
              : sheet.format === 'markdown'
                ? 'Markdown'
                : 'Text',
        }))}
        selected={book.selected}
        query={query}
        onQuery={setQuery}
        onOpen={book.open}
        onImport={() => file.current?.click()}
        onNew={() => book.begin({ title: '', source: '', format: 'chordpro' })}
        onEdit={() =>
          shown &&
          book.begin(
            { title: shown.title, source: shown.source, format: shown.format },
            shown,
          )
        }
        onLink={() => void openLinks()}
        onDownload={() => shown && download(chordSheetExport(shown.id))}
        onDelete={() => void book.previewDelete()}
        busy={busy}
        song={song}
        size={viewer.size}
        onSize={(size) => preference({ size })}
        speed={viewer.speed}
        onSpeed={(speed) => preference({ speed })}
        linked={ownLinks.map(
          (link) =>
            `${label(link.target)}${link.available ? '' : ' · Missing target'}`,
        )}
        notice={notices}
      />
      <input
        ref={file}
        type="file"
        accept=".txt,.md,.markdown,.cho,.chordpro,.chopro,.crd,.pro"
        aria-label="Import chord sheet"
        className="sr-only"
        onChange={(event) => {
          const chosen = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!chosen) return;
          void readText(chosen, 65536)
            .then((source) => {
              const format = formatOf(chosen.name);
              book.begin({
                title: (
                  parseSong(source, format).title ||
                  chosen.name.replace(/\.[^.]+$/, '')
                ).slice(0, 120),
                source,
                format,
              });
            })
            .catch((cause) =>
              book.setError(friendlyError(cause, 'import this chord sheet')),
            );
        }}
      />
      <input
        ref={backupFile}
        type="file"
        accept=".json,application/json"
        aria-label="Restore chord-sheet JSON backup"
        className="sr-only"
        onChange={(event) => {
          const chosen = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (!chosen) return;
          void readText(chosen, 4 * 1024 * 1024)
            .then((text) =>
              setRestore({
                archive: parseSheetArchive(JSON.parse(text)),
                expected: book.damage
                  ? undefined
                  : book.page?.registry_revision,
                damage: book.damage,
              }),
            )
            .catch((cause) =>
              book.setError(friendlyError(cause, 'read this Songbook backup')),
            );
        }}
      />
      {book.editor && (
        <SongbookEditor
          open
          onOpenChange={(open) => {
            if (!open && !book.busy) book.setEditor(null);
          }}
          value={book.editor.value}
          onChange={(value) =>
            book.setEditor((previous) => previous && { ...previous, value })
          }
          busy={book.busy}
          canSave={connected}
          onSave={() => void book.save()}
          error={
            <>
              {!connected && (
                <p role="status">
                  You can keep editing. Reconnect to save this draft.
                </p>
              )}
              {book.editError && <p role="alert">{book.editError}</p>}
              {book.stale && (
                <div className="grid gap-2 rounded-lg border border-border p-3">
                  <p role="alert" className="text-sm">
                    The saved version changed. Your text has been kept.
                  </p>
                  <Button
                    variant="outline"
                    disabled={book.busy || !connected}
                    onClick={() => void book.reviewLatest()}
                  >
                    Read latest saved text
                  </Button>
                  {book.latest && (
                    <>
                      <p className="font-semibold">
                        Latest: {book.latest.title}
                      </p>
                      <pre className="max-h-48 overflow-auto text-xs whitespace-pre-wrap">
                        {book.latest.source}
                      </pre>
                      <Button
                        variant="outline"
                        disabled={book.busy}
                        onClick={() =>
                          book.latest &&
                          book.setEditor({
                            id: book.latest.id,
                            expected: book.latest.revision,
                            value: {
                              title: book.latest.title,
                              format: book.latest.format,
                              source: book.latest.source,
                            },
                          })
                        }
                      >
                        Use latest saved text
                      </Button>
                      <Button
                        disabled={book.busy || !connected}
                        onClick={() =>
                          book.editor &&
                          book.latest &&
                          void book.save({
                            ...book.editor,
                            expected: book.latest.revision,
                          })
                        }
                      >
                        Replace latest with my draft
                      </Button>
                    </>
                  )}
                  {!book.editor.id && book.page && (
                    <Button
                      disabled={book.busy || !connected}
                      onClick={() =>
                        book.editor &&
                        void book.save({
                          ...book.editor,
                          expected: book.page!.registry_revision,
                        })
                      }
                    >
                      Save my new song with the current list
                    </Button>
                  )}
                </div>
              )}
            </>
          }
        />
      )}
      {linking && shown && (
        <AdjustmentDialog
          title={`Link ${shown.title}`}
          onCancel={() => !book.busy && setLinking(false)}
        >
          <div className="grid gap-3">
            <p className="text-sm">
              A preset's sheet takes priority over its backing track. Linking
              changes no audio or tempo.
            </p>
            {book.error && <p role="alert">{book.error}</p>}
            {ownLinks.map((link) => (
              <div
                key={targetKey(link.target)}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  {label(link.target)}
                  {!link.available && ' · Missing target'}
                </span>
                <Button
                  variant="outline"
                  disabled={book.busy || !connected}
                  onClick={() => void book.link(link.target, null)}
                >
                  Unlink {label(link.target)}
                </Button>
              </div>
            ))}
            <Combobox
              label="Preset or backing track"
              options={choices}
              value={target}
              onChange={setTarget}
              disabled={targetsBusy || book.busy || !connected}
              placeholder={
                targetsBusy ? 'Reading targets…' : 'Choose a preset or track…'
              }
            />
            <Button
              disabled={!target || book.busy || !connected}
              onClick={() => {
                const choice = choices.find(
                  (choice) => choice.value === target,
                );
                if (choice)
                  void book.link(choice.target, shown.id).then((saved) => {
                    if (saved) setLinking(false);
                  });
              }}
            >
              Link
            </Button>
          </div>
        </AdjustmentDialog>
      )}
      {book.deleting && shown && (
        <AdjustmentDialog
          title={`Delete ${shown.title}?`}
          onCancel={() => !book.busy && book.setDeleting(undefined)}
        >
          <div className="grid gap-3">
            {book.error && <p role="alert">{book.error}</p>}
            {!!book.deleting.set_entries?.length && (
              <div className="grid gap-1">
                <p>
                  Remove the sheet from these entries in Library → Set list
                  before deleting it.
                </p>
                <ul>
                  {book.deleting.set_entries.map((entry) => (
                    <li key={entry.id}>
                      {entry.position && `Song ${entry.position} · `}
                      {entry.name ?? entry.id}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {book.deleting.links.length ? (
              <>
                <p>
                  Unlink these references before deleting the sheet. Presets and
                  tracks stay on the device.
                </p>
                {book.deleting.links.map((link) => (
                  <div key={targetKey(link.target)} className="grid gap-1">
                    <span>
                      {label(link.target)}
                      {!link.available && ' · Missing target'}
                    </span>
                    <Button
                      variant="outline"
                      disabled={book.busy || !connected}
                      onClick={() => void book.link(link.target, null)}
                    >
                      Unlink {label(link.target)}
                    </Button>
                  </div>
                ))}
              </>
            ) : (
              !book.deleting.set_entries?.length && (
                <p>
                  No references use this sheet. Its words and chords will be
                  removed.
                </p>
              )
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={book.busy || !connected}
                onClick={() => void book.previewDelete()}
              >
                Check references again
              </Button>
              <Button
                variant="destructive"
                disabled={
                  book.busy ||
                  !connected ||
                  !!book.deleting.links.length ||
                  !!book.deleting.set_entries?.length
                }
                onClick={() => void book.confirmDelete()}
              >
                Delete sheet
              </Button>
            </div>
          </div>
        </AdjustmentDialog>
      )}
      {restore && (
        <AdjustmentDialog
          title="Restore Songbook backup?"
          onCancel={() => !book.busy && setRestore(undefined)}
        >
          <div className="grid gap-3">
            <p>
              {restore.archive.sheets.length} songs and{' '}
              {restore.archive.links.length} links. Existing preset and track
              data stays as it is. Missing targets will be shown.
            </p>
            {restore.damage && (
              <p>
                The damaged registry will be retained before these sheets are
                restored.
              </p>
            )}
            {book.error && <p role="alert">{book.error}</p>}
            <Button
              disabled={book.busy || !connected}
              onClick={() =>
                void book
                  .restore(restore.archive, restore.expected, restore.damage)
                  .then((saved) => {
                    if (saved) setRestore(undefined);
                  })
              }
            >
              Restore sheets
            </Button>
          </div>
        </AdjustmentDialog>
      )}
    </>
  );
}
