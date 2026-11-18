import { useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { DialogFooter } from '@oxidal/design-system/components/dialog';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import { deleteAsset, type MediaAsset, updateAsset } from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import { useSessionMedia } from './sessionMedia';

/** Rename a backing track. The title is metadata; the files never change.
 * @see docs/media.md
 */
export function RenameDialog({
  asset,
  onClose,
}: {
  asset: MediaAsset;
  onClose: () => void;
}) {
  const { refreshLibrary } = useSessionMedia();
  const [title, setTitle] = useState(asset.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const next = title.trim();
  async function save() {
    setSaving(true);
    setError('');
    try {
      await updateAsset(asset.id, { title: next });
      refreshLibrary();
      onClose();
    } catch (cause) {
      setError(deviceSentence(cause, 'rename the track'));
      setSaving(false);
    }
  }
  return (
    <AdjustmentDialog title="Rename track" onCancel={onClose}>
      <form
        className="media-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (next && next !== asset.title) void save();
        }}
      >
        <label className="field">
          Name
          <input
            value={title}
            maxLength={200}
            disabled={saving}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving || !next || next === asset.title}
          >
            Save
          </Button>
        </DialogFooter>
      </form>
    </AdjustmentDialog>
  );
}

/** Delete a backing track after confirming; refused while it plays.
 * @see docs/media.md
 */
export function DeleteDialog({
  asset,
  onClose,
}: {
  asset: MediaAsset;
  onClose: () => void;
}) {
  const { refreshLibrary, player } = useSessionMedia();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const cued = player?.track?.id === asset.id;
  async function remove() {
    setDeleting(true);
    setError('');
    try {
      await deleteAsset(asset.id);
      refreshLibrary();
      onClose();
    } catch (cause) {
      setError(deviceSentence(cause, 'delete the track'));
      setDeleting(false);
    }
  }
  return (
    <AdjustmentDialog title={`Delete “${asset.title}”?`} onCancel={onClose}>
      <p>
        This removes the file from the device. It can&apos;t be undone.
        {cued && ' The track is cued, so deleting it clears the player.'}
      </p>
      {error && <p role="alert">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={deleting}
          onClick={() => void remove()}
        >
          Delete
        </Button>
      </DialogFooter>
    </AdjustmentDialog>
  );
}
