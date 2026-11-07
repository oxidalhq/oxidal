import { friendlyError, errorDetails } from './lib/friendlyError';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  UploadSimple,
  CloudArrowDown,
  MagnifyingGlass,
  Trash,
  X,
} from '@phosphor-icons/react';
import { DeleteSoundDialog } from './features/library/DeleteSoundDialog';
import { localModels, uploadLocalModel, type LocalModelPage } from './api';
import { Button } from './components/ui/button';
import { useWorkspaceState } from './workspaceMemory';
import { ModelPicker } from './ModelPicker';
import { AdjustmentDialog } from './AdjustmentDialog';
import { GearLabel } from './GearIcon';
import { groupIrs } from './irPresentation';
import { ModelPicture, LibraryModelPreview } from './LibraryModelPreview';
import type { LocalModel } from './api';

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
    <section className="asset-library" aria-label={`${label} library`}>
      <h2 className="sr-only">{label}</h2>
      <div className="library-search asset-library-search">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Search {label}</span>
          <MagnifyingGlass
            aria-hidden="true"
            size={18}
            className="library-search-icon"
          />
          <input
            type="search"
            className="library-search-input"
            value={query}
            maxLength={256}
            placeholder={format === 'nam' ? 'Find a NAM model…' : 'Find an IR…'}
            onChange={(e) => {
              setCursors([null]);
              setQuery(e.target.value);
            }}
          />
        </label>
        {query && (
          <Button
            variant="ghost"
            size="icon"
            className="asset-search-clear"
            aria-label={`Clear ${label} search`}
            onClick={() => {
              setCursors([null]);
              setQuery('');
            }}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      <div className="library-bar asset-library-bar">
        <div className="asset-library-actions">
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
            onClick={() => setDownloadOpen(true)}
          >
            <CloudArrowDown aria-hidden="true" /> TONE3000
          </Button>
        </div>
        <span className="caption asset-library-count">
          {loading
            ? 'Loading…'
            : data
              ? data.next || cursors.length > 1
                ? `${data.data.length} shown`
                : `${data.data.length} ${data.data.length === 1 ? 'file' : 'files'}`
              : 'Library unavailable'}
        </span>
      </div>
      {progress && (
        <div className="asset-import-progress" aria-label="Import progress">
          <div className="library-bar">
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
          <div className="library-bar caption">
            <span className="min-w-0 break-words">
              {progress.current ||
                (progress.cancelled
                  ? 'Previously imported files are kept.'
                  : '')}
            </span>
            <span>
              {size(progress.doneBytes)} / {size(progress.bytes)}
            </span>
          </div>
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
      <div className="asset-library-list" aria-busy={loading}>
        {!loading && data?.data.length === 0 && (
          <div className="asset-library-empty">
            <FolderOpen size={28} aria-hidden="true" />
            <p>{query.trim() ? 'No matching files' : `No ${label} yet`}</p>
            <p className="caption">
              {query.trim()
                ? 'Try another name or clear the search.'
                : `Import ${format === 'nam' ? 'NAM' : 'WAV'} files or download from TONE3000.`}
            </p>
          </div>
        )}
        {format === 'ir' ? (
          groupIrs(data?.data ?? []).map((group) => (
            <section
              key={group.key}
              className="ir-cabinet"
              aria-label={group.cabinet}
            >
              <header className="ir-cabinet-heading">
                <h3>{group.cabinet}</h3>
                {group.collection && (
                  <p className="library-meta">{group.collection}</p>
                )}
              </header>
              {group.files.map(({ model, title, technical }) => (
                <details key={model.id} className="ir-capture">
                  <summary>
                    <span className="ir-capture-label">
                      <h4 className="library-name">{title}</h4>
                      <span className="library-meta">{technical}</span>
                    </span>
                  </summary>
                  <dl className="ir-file-details">
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
              <article
                key={model.id}
                className="asset-library-file nam-library-file"
              >
                <div className="nam-library-picture">
                  <ModelPicture model={model} />
                </div>
                <div className="min-w-0">
                  <h3 className="library-name">
                    <button
                      className="asset-preview-trigger"
                      onClick={() => setPreview(model)}
                      aria-label={`Preview ${model.title}`}
                    >
                      {model.nam?.name || model.title}
                    </button>
                  </h3>
                  {model.name
                    .replace(/\.(nam|wav)$/i, '')
                    .toLocaleLowerCase() !==
                    model.title.toLocaleLowerCase() && (
                    <p className="library-meta break-words">{model.name}</p>
                  )}
                  <p className="library-meta asset-library-meta">
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
                  </p>
                </div>
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
              </article>
            ))}
          </div>
        )}
      </div>
      {(data?.next || cursors.length > 1) && (
        <nav className="asset-library-pages" aria-label={`${label} pages`}>
          <Button
            variant="ghost"
            disabled={loading || cursors.length === 1}
            onClick={() => setCursors((stack) => stack.slice(0, -1))}
          >
            <ArrowLeft aria-hidden="true" /> Previous
          </Button>
          <span className="caption">Page {cursors.length}</span>
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
            <p className="caption">
              Choose a folder to import a collection. You can cancel at any
              time; completed files stay in your library.
            </p>
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
