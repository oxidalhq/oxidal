import { useState } from 'react';
import { AdjustmentDialog } from '../../AdjustmentDialog';
import { Button } from '../ui/button';
import { DialogFooter } from '../ui/dialog';

/** Name and notes for Save as… and Rename. Names are 1–60 characters.
 * @see docs/media.md
 */
export function ProfileDialog({
  title,
  name: initialName,
  notes: initialNotes,
  error,
  onCancel,
  onSave,
}: {
  error: string;
  title: string;
  name: string;
  notes: string;
  onCancel: () => void;
  onSave: (name: string, notes: string) => Promise<void>;
}) {
  const [name, setName] = useState(initialName.slice(0, 60));
  const [notes, setNotes] = useState(initialNotes);
  const [saving, setSaving] = useState(false);
  const next = name.trim();
  return (
    <AdjustmentDialog title={title} onCancel={onCancel}>
      <form
        className="media-dialog-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!next || saving) return;
          setSaving(true);
          void onSave(next, notes.trim()).finally(() => setSaving(false));
        }}
      >
        <label className="field">
          Name
          <input
            value={name}
            maxLength={60}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          Notes
          <input
            value={notes}
            maxLength={500}
            disabled={saving}
            placeholder="What the room needs, such as “boomy corner”"
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !next}>
            Save
          </Button>
        </DialogFooter>
      </form>
    </AdjustmentDialog>
  );
}

export function DeleteProfileDialog({
  name,
  error,
  onCancel,
  onDelete,
}: {
  name: string;
  error: string;
  onCancel: () => void;
  onDelete: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  return (
    <AdjustmentDialog title={`Delete "${name}"?`} onCancel={onCancel}>
      <p>The outputs switch to Flat. This can't be undone.</p>
      {error && <p role="alert">{error}</p>}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          disabled={deleting}
          onClick={() => {
            setDeleting(true);
            void onDelete().finally(() => setDeleting(false));
          }}
        >
          Delete
        </Button>
      </DialogFooter>
    </AdjustmentDialog>
  );
}

/** Leaving, or switching profile, with an unsaved edit the outputs play. */
export function LeaveDialog({
  name,
  action,
  error,
  onKeep,
  onLeave,
}: {
  name: string;
  error: string;
  action: string;
  onKeep: () => void;
  onLeave: () => Promise<void>;
}) {
  const [leaving, setLeaving] = useState(false);
  return (
    <AdjustmentDialog
      title="Unsaved venue edit"
      onCancel={onKeep}
      // Back on the editor, not on the tab that asked to leave: focusing a
      // settings tab would ask again.
      returnFocus={() => document.getElementById('venue-title')}
    >
      <p>
        &ldquo;{name}&rdquo; has changes you haven&apos;t saved. You&apos;re
        hearing them now.
      </p>
      {error && <p role="alert">{error}</p>}
      <DialogFooter>
        <Button onClick={onKeep}>Keep editing</Button>
        <Button
          variant="outline"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            void onLeave().finally(() => setLeaving(false));
          }}
        >
          {action}
        </Button>
      </DialogFooter>
    </AdjustmentDialog>
  );
}
