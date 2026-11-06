import { useEffect, useState } from 'react';
import {
  modelRemovalPreview,
  removeModel,
  type ModelRemovalPreview,
} from '../../api';
import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Button } from '../../components/ui/button';
import { friendlyError } from '../../lib/friendlyError';

/** Whole kilobytes or megabytes; exact byte counts sit in Details. */
function fileSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Deletes one separate NAM or IR file. The daemon lists everything that still
 * uses it (playing or remembered sessions, collections, presets carrying the
 * same capture). A used file shows its uses and cannot be deleted "anyway".
 * @see docs/presets/format.md
 */
export function DeleteSoundDialog({
  id,
  name,
  onDeleted,
  onCancel,
}: {
  id: string;
  name: string;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<ModelRemovalPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    void modelRemovalPreview(id)
      .then((p) => {
        if (alive) setPreview(p);
      })
      .catch((e: unknown) => {
        if (alive) setError(friendlyError(e, 'check this file'));
      });
    return () => {
      alive = false;
    };
  }, [id, refresh]);
  async function confirm() {
    if (!preview || busy || preview.blocked) return;
    setBusy(true);
    setError('');
    try {
      const result = await removeModel(id, preview.token);
      setDone(
        result.cleanup_pending
          ? 'File deleted. Some cleanup remains; it finishes when Oxidal restarts.'
          : 'File deleted.',
      );
    } catch (e) {
      setError(friendlyError(e, 'delete this file'));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  function close() {
    if (busy) return;
    if (done) onDeleted();
    onCancel();
  }
  const kind = preview?.model.format === 'ir' ? 'IR' : 'NAM';
  return (
    <AdjustmentDialog title="Delete sound" onCancel={close}>
      <div className="min-w-0 space-y-4">
        <p className="font-semibold break-words">
          {preview?.model.name ?? name}
        </p>
        {done ? (
          <>
            <p role="status">{done}</p>
            <Button onClick={close}>Close</Button>
          </>
        ) : (
          <>
            {!preview && !error && (
              <p role="status">Checking where this file is used…</p>
            )}
            {preview &&
              (preview.model.protected_by.length ? (
                <>
                  <p>
                    This {kind} file is still used, so it stays on the device.
                  </p>
                  <ul className="list-disc space-y-1 pl-5" aria-label="Used by">
                    {preview.model.protected_by.map((use) => (
                      <li key={use} className="break-words">
                        {use}
                      </li>
                    ))}
                  </ul>
                  <p className="caption">
                    Remove it from those first, or keep it.
                  </p>
                </>
              ) : preview.blocked ? (
                <p role="alert">{preview.blocked}</p>
              ) : (
                <p>
                  Delete this {kind} file permanently (
                  {fileSize(preview.model.bytes)}). Nothing uses it.
                </p>
              ))}
            {error && (
              <div role="alert" className="space-y-2">
                <p>{error}</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setError('');
                    setPreview(null);
                    setRefresh((v) => v + 1);
                  }}
                >
                  Check again
                </Button>
              </div>
            )}
            <div className="action-row">
              <Button variant="outline" disabled={busy} onClick={close}>
                {preview?.blocked ? 'Close' : 'Cancel'}
              </Button>
              {!preview?.blocked && (
                <Button
                  variant="destructive"
                  disabled={busy || !preview}
                  onClick={() => void confirm()}
                >
                  {busy ? 'Deleting…' : 'Delete permanently'}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </AdjustmentDialog>
  );
}
