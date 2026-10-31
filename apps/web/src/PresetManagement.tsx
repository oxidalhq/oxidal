import { useEffect, useState } from 'react';
import {
  libraryCatalog,
  removalPreview,
  removePreset,
  type LibraryCatalog,
  type RemovalPreview,
} from './api';
import { PresetDetailsDialog } from './PresetDetails';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';

type Entry = Pick<LibraryCatalog['items'][number], 'kind' | 'id' | 'name'>;
const size = (bytes: number) =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KiB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

/** Device labels and preview-bound permanent removal share one surface in Library and Rig. */
export function PresetManagement({
  entry,
  disabled,
  onChanged,
  label = 'Preset options',
  compact = false,
}: {
  entry: Entry;
  disabled: boolean;
  onChanged: () => void;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={`${label}: ${entry.name}`}
      >
        {compact ? 'Options' : label}
      </Button>
      {open && (
        <ManagementDialog
          entry={entry}
          onChanged={onChanged}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}
function ManagementDialog({
  entry,
  onChanged,
  onCancel,
}: {
  entry: Entry;
  onChanged: () => void;
  onCancel: () => void;
}) {
  const [catalog, setCatalog] = useState<LibraryCatalog | null>(null);
  const [name, setName] = useState(entry.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [details, setDetails] = useState(false);
  useEffect(() => {
    let alive = true;
    void libraryCatalog()
      .then((c) => {
        if (!alive) return;
        const item = c.items.find(
          (i) => i.kind === entry.kind && i.id === entry.id,
        );
        if (!item) throw new Error('This preset is no longer in Library.');
        setCatalog(c);
        setName(item.name);
      })
      .catch((e: unknown) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [entry.kind, entry.id]);
  async function rename() {
    if (!catalog || busy) return;
    setBusy(true);
    setError('');
    try {
      await libraryCatalog({
        expected_revision: catalog.revision,
        entry_kind: entry.kind,
        id: entry.id,
        action: { kind: 'rename', name: name.trim() },
      });
      onChanged();
      onCancel();
    } catch (e) {
      setError(String(e));
      setCatalog(null);
    } finally {
      setBusy(false);
    }
  }
  if (details)
    return (
      <PresetDetailsDialog
        entry={entry}
        editable
        onChanged={onChanged}
        onCancel={() => setDetails(false)}
      />
    );
  if (deleting)
    return (
      <DeletePresetDialog
        entry={entry}
        onChanged={onChanged}
        onCancel={onCancel}
      />
    );
  return (
    <AdjustmentDialog
      title="Preset options"
      onCancel={() => {
        if (!busy) onCancel();
      }}
    >
      <div className="min-w-0 space-y-4">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <label className="field">
            Name on this device
            <input
              value={name}
              maxLength={120}
              disabled={busy || !catalog}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <p className="caption">The exported preset keeps its saved name.</p>
          <Button type="submit" disabled={busy || !catalog || !name.trim()}>
            Rename
          </Button>
        </form>
        <div className="space-y-2 border-t border-border pt-4">
          <h3>Description and categories</h3>
          <p className="caption">
            Add notes and categories to find this preset again.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setDetails(true)}
          >
            View details
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="space-y-2 border-t border-border pt-4">
          <h3>Permanent deletion</h3>
          <p className="caption">
            Review the preset and its files before deleting.
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setDeleting(true)}
          >
            Review deletion
          </Button>
        </div>
      </div>
    </AdjustmentDialog>
  );
}
export function DeletePresetDialog({
  entry,
  onChanged,
  onCancel,
}: {
  entry: Entry;
  onChanged: () => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<RemovalPreview | null>(null);
  const [cleanup, setCleanup] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    void removalPreview({ entry_kind: entry.kind, id: entry.id })
      .then((p) => {
        if (alive) setPreview(p);
      })
      .catch((e: unknown) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [entry.kind, entry.id, refresh]);
  const removable = preview?.models.filter((m) => !m.protected_by.length) ?? [];
  async function confirm() {
    if (!preview || busy || preview.blocked) return;
    setBusy(true);
    setError('');
    try {
      const result = await removePreset({
        entry_kind: entry.kind,
        id: entry.id,
        expected_preview: preview.token,
        delete_models: cleanup,
      });
      setDone(
        result.cleanup_pending
          ? 'Preset deleted. Some cleanup remains; refresh Library before taking another action.'
          : 'Preset deleted.',
      );
      setPreview(null);
    } catch (e) {
      setError(
        `Deletion was not confirmed: ${String(e)}. Refresh the preview or Library before trying again.`,
      );
      setPreview(null);
      setCleanup(false);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (busy) return;
    if (done) onChanged();
    onCancel();
  }
  return (
    <AdjustmentDialog title="Delete preset" onCancel={close}>
      <div className="min-w-0 space-y-4">
        {done ? (
          <p role="status">{done}</p>
        ) : (
          <>
            <p className="font-semibold break-words">
              {preview?.entry.name ?? entry.name}
            </p>
            {!preview && !error && (
              <p role="status">Checking files and shared uses…</p>
            )}
            {preview && (
              <>
                <p>
                  Delete this saved preset permanently (
                  {size(preview.preset_bytes)}). This includes its embedded
                  resources.
                </p>
                {!!preview.remembered_files && (
                  <p className="caption">
                    Also removes {preview.remembered_files} remembered session
                    or checkpoint{' '}
                    {preview.remembered_files === 1 ? 'file' : 'files'} (
                    {size(preview.remembered_bytes)}).
                  </p>
                )}
                <p className="caption">
                  {preview.models.length
                    ? 'Separate NAM and IR files stay in Library unless selected below.'
                    : 'Separate NAM and IR files stay in Library.'}
                </p>
                {preview.models.length > 0 && (
                  <>
                    <label className="flex items-start gap-3">
                      <input
                        className="mt-1"
                        type="checkbox"
                        checked={cleanup}
                        disabled={
                          busy ||
                          !!preview.model_cleanup_unavailable ||
                          !removable.length ||
                          !!preview.blocked
                        }
                        onChange={(e) => setCleanup(e.target.checked)}
                      />
                      <span>
                        Also delete {removable.length} unused separate{' '}
                        {removable.length === 1 ? 'file' : 'files'} (
                        {size(removable.reduce((n, m) => n + m.bytes, 0))})
                      </span>
                    </label>
                    <details>
                      <summary>
                        Associated files ({preview.models.length})
                      </summary>
                      <ul className="max-h-64 space-y-3 overflow-auto py-3">
                        {preview.models.map((m) => (
                          <li key={m.id} className="break-words">
                            <strong>{m.name}</strong>
                            <p className="caption">
                              {m.format === 'nam' ? 'NAM' : 'IR'} ·{' '}
                              {size(m.bytes)} ·{' '}
                              {m.protected_by.length
                                ? `Kept: ${m.protected_by.join('; ')}`
                                : cleanup
                                  ? 'Will be deleted'
                                  : 'Kept in Library'}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </>
                )}
                {preview.model_cleanup_unavailable && (
                  <p className="caption">{preview.model_cleanup_unavailable}</p>
                )}
                {preview.blocked && <p role="alert">{preview.blocked}</p>}
              </>
            )}
            {error && (
              <div role="alert" className="space-y-2">
                <p>{error}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setError('');
                    setRefresh((v) => v + 1);
                  }}
                >
                  Refresh preview
                </Button>
              </div>
            )}
            <div className="action-row">
              <Button variant="outline" disabled={busy} onClick={onCancel}>
                Cancel
              </Button>
              <Button
                disabled={busy || !preview || !!preview.blocked}
                onClick={() => void confirm()}
              >
                {busy ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </div>
          </>
        )}
        {done && <Button onClick={close}>Close</Button>}
      </div>
    </AdjustmentDialog>
  );
}
