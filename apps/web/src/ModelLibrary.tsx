import {
  ArrowLeft,
  ArrowRight,
  CloudArrowDown,
  FolderOpen,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { ListRow } from '@oxidal/design-system/components/list-row';
import { EmptyState } from '@oxidal/design-system/components/states';
import { Caption } from '@oxidal/design-system/components/text';

import { AdjustmentDialog } from './AdjustmentDialog';
import type { LocalModel } from './api';
import { type LocalModelPage, localModels, uploadLocalModel } from './api';
import { CaptureRigBuilder } from './features/library/CaptureRigBuilder';
import { DeleteSoundDialog } from './features/library/DeleteSoundDialog';
import { LibrarySearch } from './features/library/LibrarySearch';
import { GearLabel } from './GearIcon';
import { groupIrs } from './irPresentation';
import { errorDetails, friendlyError } from './lib/friendlyError';
import { LibraryModelPreview, ModelPicture } from './LibraryModelPreview';
import { ModelPicker } from './ModelPicker';
import { useWorkspaceState } from './workspaceMemory';

const FILE_LIMIT = 32 * 1024 * 1024;
const folderLabel = (folder: string) => {
  const parts = folder.split('/');
  return parts.length > 3
    ? [parts[1], '…', ...parts.slice(-2)].join(' / ')
    : parts.join(' / ');
};
const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
type ImportState = {
  total: number;
  complete: number;
  imported: number;
  failed: number;
  bytes: number;
  doneBytes: number;
  current: string;
  cancelled: boolean;
  errors: string[];
};

/** Persistent files are independent of the preset currently playing.
 * @see docs/library.md
 */
export function ModelLibrary({
  format,
  connected,
  onOpenRig = () => {},
}: {
  format: 'nam' | 'ir';
  connected: boolean;
  onOpenRig?: () => void;
}) {
  const searchInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useWorkspaceState(`library-${format}-query`, '');
  const [result, setResult] = useState<{
    key: string;
    page: LocalModelPage | null;
    error: string;
  }>({ key: '', page: null, error: '' });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pending, setPending] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [progress, setProgress] = useState<ImportState | null>(null);
  const [importing, setImporting] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadButton = useRef<HTMLButtonElement>(null);
  const [building, setBuilding] = useState(false);
  const [saved, setSaved] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [preview, setPreview] = useState<LocalModel | null>(null);
  const [deleting, setDeleting] = useState<LocalModel | null>(null);
  const cancel = useRef<AbortController | null>(null);
  const alive = useRef(false);
  const filesInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const cursor = cursors.at(-1) ?? null;
  const requestKey = JSON.stringify([cursor, format, query, refresh]);
  const data = result.key === requestKey ? result.page : null;
  const error = result.key === requestKey ? result.error : '';
  const loading = result.key !== requestKey || pending;
  const label = format === 'nam' ? 'NAM models' : 'IRs';
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      cancel.current?.abort();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // Coalesce typing, and cancel stale pages before accepting a new result.
    const timer = setTimeout(() => {
      setPending(true);
      void localModels(cursor, controller.signal, true, { format, query })
        .then((page) => {
          if (!controller.signal.aborted)
            setResult({ key: requestKey, page, error: '' });
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setResult({
              key: requestKey,
              page: null,
              error: friendlyError(cause, 'read your sounds'),
            });
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setPending(false);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [cursor, format, query, refresh, requestKey]);
  async function add(files: File[]) {
    if (cancel.current || !connected || files.length === 0) return;
    const controller = new AbortController();
    cancel.current = controller;
    setImportOpen(false);
    setImporting(true);
    const state: ImportState = {
      total: files.length,
      complete: 0,
      imported: 0,
      failed: 0,
      bytes: files.reduce((sum, f) => sum + f.size, 0),
      doneBytes: 0,
      current: '',
      cancelled: false,
      errors: [],
    };
    const publish = () => {
      if (alive.current) setProgress({ ...state, errors: [...state.errors] });
    };
    try {
      for (const file of files) {
        if (controller.signal.aborted || !alive.current) break;
        state.current = file.webkitRelativePath || file.name;
        publish();
        try {
          if (
            !file.name
              .toLowerCase()
              .endsWith(format === 'nam' ? '.nam' : '.wav')
          )
            throw new Error(
              `Choose ${format === 'nam' ? '.nam' : '.wav'} files`,
            );
          if (!file.size || file.size > FILE_LIMIT)
            throw new Error('Each file must contain 1 byte to 32 MB');
          await uploadLocalModel(file, controller.signal);
          state.imported++;
        } catch (cause) {
          if (controller.signal.aborted) break;
          state.failed++;
          // Keep the DOM and error history bounded even for thousands of files.
          if (state.errors.length < 20)
            state.errors.push(`${state.current}: ${errorDetails(cause)}`);
        }
        state.complete++;
        state.doneBytes += file.size;
        publish();
      }
    } finally {
      state.cancelled = controller.signal.aborted;
      state.current = '';
      publish();
      cancel.current = null;
      if (alive.current) {
        setImporting(false);
        setCursors([null]);
        setRefresh((n) => n + 1);
      }
    }
  }
  return (
    <section className="grid min-w-0 gap-2" aria-label={`${label} library`}>
      <h2 className="sr-only">{label}</h2>
      <LibrarySearch
        label={`Search ${label}`}
        clearLabel={`Clear ${label} search`}
        inputRef={searchInput}
        placeholder={format === 'nam' ? 'Find a NAM model…' : 'Find an IR…'}
        value={query}
        maxLength={256}
        onChange={(value) => {
          setCursors([null]);
          setQuery(value);
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {format === 'nam' && (
            <Button
              variant="outline"
              disabled={!connected || importing}
              onClick={() => {
                setSaved('');
                setBuilding(true);
              }}
            >
              Build a rig from captures
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={importing || !connected}
            onClick={() => setImportOpen(true)}
          >
            <UploadSimple aria-hidden="true" /> Import
          </Button>
          <Button
            variant="ghost"
            disabled={importing || !connected}
            ref={downloadButton}
            onClick={() => setDownloadOpen(true)}
          >
            <CloudArrowDown aria-hidden="true" /> TONE3000
          </Button>
        </div>
        <Caption as="span" className="text-xs">
          {loading
            ? 'Loading…'
            : data
              ? data.next || cursors.length > 1
                ? `${data.data.length} shown`
                : `${data.data.length} ${data.data.length === 1 ? 'file' : 'files'}`
              : 'Library unavailable'}
        </Caption>
      </div>
      {progress && (
        <div
          className="grid gap-2 border-t border-border py-3"
          aria-label="Import progress"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="status">
              {importing
                ? 'Importing'
                : progress.cancelled
                  ? 'Import cancelled'
                  : 'Import complete'}
              : {progress.complete} of {progress.total} files ·{' '}
              {progress.imported} stored · {progress.failed} failed
            </p>
            {importing && (
              <Button variant="ghost" onClick={() => cancel.current?.abort()}>
                Cancel import
              </Button>
            )}
          </div>
          <progress
            className="w-full"
            aria-label="Files processed"
            max={progress.total}
            value={progress.complete}
          />
          <Caption
            as="div"
            className="flex flex-wrap items-center justify-between gap-2"
          >
            <span className="min-w-0 break-words">
              {progress.current ||
                (progress.cancelled
                  ? 'Previously imported files are kept.'
                  : '')}
            </span>
            <span>
              {size(progress.doneBytes)} / {size(progress.bytes)}
            </span>
          </Caption>
          {progress.errors.length > 0 && (
            <details className="disclosure">
              <summary>
                Import failures
                {progress.failed > progress.errors.length ? ' (first 20)' : ''}
              </summary>
              <ul>
                {progress.errors.map((message, i) => (
                  <li key={i} className="text-sm break-words">
                    {message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {error && (
        <div className="py-3">
          <p role="alert">{error}</p>
          <Button variant="outline" onClick={() => setRefresh((n) => n + 1)}>
            Retry library
          </Button>
        </div>
      )}
      <div className="grid min-w-0 gap-3" aria-busy={loading}>
        {!loading && data?.data.length === 0 && (
          <EmptyState
            icon={<FolderOpen aria-hidden="true" />}
            title={query.trim() ? 'No matching files' : `No ${label} yet`}
          >
            {query.trim()
              ? 'Try another name or clear the search.'
              : `Import ${format === 'nam' ? 'NAM' : 'WAV'} files or download from TONE3000.`}
          </EmptyState>
        )}
        {format === 'ir' ? (
          groupIrs(data?.data ?? []).map((group) => (
            <section
              key={group.key}
              className="grid min-w-0 gap-1 border-t border-border pt-2"
              aria-label={group.cabinet}
            >
              <header className="grid gap-1">
                <h3>{group.cabinet}</h3>
                {group.collection && (
                  <p className="text-sm text-muted-foreground">
                    {group.collection}
                  </p>
                )}
              </header>
              {group.files.map(({ model, title, technical }) => (
                <details
                  key={model.id}
                  className="grid min-w-0 border-b border-border [&>summary]:min-h-touch [&>summary]:cursor-pointer [&>summary]:py-2"
                >
                  <summary>
                    <span className="inline-grid min-w-0 gap-1 align-middle">
                      <h4 className="font-semibold break-words">{title}</h4>
                      <span className="text-sm text-muted-foreground">
                        {technical}
                      </span>
                    </span>
                  </summary>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 p-2 text-sm [&>dd]:break-words [&>dt]:font-semibold">
                    <dt>File</dt>
                    <dd>{model.name}</dd>
                    {model.folder && (
                      <>
                        <dt>Folder</dt>
                        <dd>{model.folder}</dd>
                      </>
                    )}
                    <dt>Source</dt>
                    <dd>{model.tone_id ? 'TONE3000' : 'Uploaded'}</dd>
                  </dl>
                  <Button
                    variant="ghost"
                    disabled={!connected}
                    onClick={() => setDeleting(model)}
                    aria-label={`Delete ${title}`}
                  >
                    <Trash aria-hidden="true" /> Delete
                  </Button>
                </details>
              ))}
            </section>
          ))
        ) : (
          <div>
            {data?.data.map((model) => (
              <ListRow
                key={model.id}
                role="article"
                leading={
                  <span className="grid size-12 place-items-center overflow-hidden rounded-md bg-muted text-muted-foreground [&_img]:size-full [&_img]:object-cover [&_svg]:size-5">
                    <ModelPicture model={model} />
                  </span>
                }
                className="[&>span:first-child]:pointer-events-none [&>span:nth-child(2)>span]:whitespace-normal"
                title={
                  <button
                    type="button"
                    className="text-left after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:outline-ring"
                    onClick={() => setPreview(model)}
                    aria-label={`Preview ${model.title}`}
                  >
                    {model.nam?.name || model.title}
                  </button>
                }
                caption={
                  <>
                    {model.name
                      .replace(/\.(nam|wav)$/i, '')
                      .toLocaleLowerCase() !==
                      model.title.toLocaleLowerCase() && (
                      <span className="block break-words">{model.name}</span>
                    )}
                    <span className="block break-words">
                      {model.tone_id ? 'TONE3000' : 'Uploaded'}
                      {model.folder && (
                        <span title={model.folder}>
                          {' · '}
                          {folderLabel(model.folder)}
                        </span>
                      )}
                      {model.gear && (
                        <>
                          {' '}
                          · <GearLabel gear={model.gear} />
                        </>
                      )}
                    </span>
                  </>
                }
                trailing={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative z-10 ml-auto"
                    disabled={!connected}
                    onClick={() => setDeleting(model)}
                    aria-label={`Delete ${model.nam?.name || model.title}`}
                  >
                    <Trash aria-hidden="true" />
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </div>
      {(data?.next || cursors.length > 1) && (
        <nav
          className="flex items-center justify-between gap-2"
          aria-label={`${label} pages`}
        >
          <Button
            variant="ghost"
            disabled={loading || cursors.length === 1}
            onClick={() => setCursors((stack) => stack.slice(0, -1))}
          >
            <ArrowLeft aria-hidden="true" /> Previous
          </Button>
          <Caption as="span">Page {cursors.length}</Caption>
          <Button
            variant="ghost"
            disabled={loading || !data?.next}
            onClick={() => {
              const next = data?.next;
              if (next) setCursors((stack) => [...stack, next]);
            }}
          >
            Next <ArrowRight aria-hidden="true" />
          </Button>
        </nav>
      )}
      {deleting && (
        <DeleteSoundDialog
          id={deleting.id}
          name={deleting.nam?.name || deleting.title}
          onCancel={() => setDeleting(null)}
          onDeleted={() => setRefresh((n) => n + 1)}
        />
      )}
      <input
        ref={filesInput}
        className="sr-only"
        tabIndex={-1}
        type="file"
        multiple
        accept={format === 'nam' ? '.nam' : '.wav'}
        disabled={importing || !connected}
        aria-label={`Add ${label} files`}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          void add(files);
        }}
      />
      <input
        ref={(node) => {
          folderInput.current = node;
          node?.setAttribute('webkitdirectory', '');
        }}
        className="sr-only"
        tabIndex={-1}
        type="file"
        multiple
        disabled={importing || !connected}
        aria-label={`Add ${label} folder`}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          void add(files);
        }}
      />
      {format === 'nam' && saved && <p role="status">Saved {saved} in Mine.</p>}
      {building && (
        <CaptureRigBuilder
          onClose={() => setBuilding(false)}
          onSaved={(name) => {
            setSaved(name);
            setBuilding(false);
          }}
        />
      )}
      {importOpen && (
        <AdjustmentDialog
          title={`Import ${label}`}
          onCancel={() => setImportOpen(false)}
        >
          <div className="space-y-4">
            <p>
              {format === 'nam' ? '.nam models' : '.wav impulse responses'} · Up
              to 32 MB per file.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => filesInput.current?.click()}>
                <UploadSimple aria-hidden="true" /> Choose files
              </Button>
              <Button
                variant="outline"
                onClick={() => folderInput.current?.click()}
              >
                <FolderOpen aria-hidden="true" /> Choose folder
              </Button>
            </div>
            <Caption>
              Choose a folder to import a collection. You can cancel at any
              time; completed files stay in your library.
            </Caption>
          </div>
        </AdjustmentDialog>
      )}
      {preview && (
        <LibraryModelPreview
          key={preview.id}
          model={preview}
          onClose={() => setPreview(null)}
          onOpenRig={() => {
            setPreview(null);
            onOpenRig();
          }}
        />
      )}
      {downloadOpen && (
        <ModelPicker
          name={label}
          intent="download"
          returnFocus={() => downloadButton.current}
          initialFormat={format}
          allowedFormat={format}
          onClose={() => setDownloadOpen(false)}
          onAudition={async () => {
            setCursors([null]);
            setRefresh((n) => n + 1);
          }}
        />
      )}
    </section>
  );
}
