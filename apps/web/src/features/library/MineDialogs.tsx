import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  ActionRow,
  FormField,
} from '@oxidal/design-system/components/form-layout';
import { Caption } from '@oxidal/design-system/components/text';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import { type LibraryCatalog, libraryCatalog } from '../../api';
import { friendlyError } from '../../lib/friendlyError';
import { DeletePresetDialog } from '../../PresetManagement';

export type MineTarget = {
  action: 'rename' | 'delete';
  kind: 'rig' | 'owned' | 'original';
  id: string;
  name: string;
};

/**
 * Rename and Delete… from a Mine row menu. Rename changes the name on this
 * device only; deletion shows what goes with the preset before anything is
 * removed.
 * @see docs/interface.md
 */
export function MineDialogs({
  target,
  onClose,
  onChanged,
}: {
  target: MineTarget | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  if (!target) return null;
  if (target.action === 'delete')
    return (
      <DeletePresetDialog
        entry={target}
        onChanged={onChanged}
        onCancel={onClose}
      />
    );
  return (
    <RenameDialog
      key={`${target.kind}:${target.id}`}
      target={target}
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}

function RenameDialog({
  target,
  onClose,
  onChanged,
}: {
  target: MineTarget;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [catalog, setCatalog] = useState<LibraryCatalog | null>(null);
  const [name, setName] = useState(target.name);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void libraryCatalog()
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch((cause: unknown) => {
        if (alive) setError(friendlyError(cause, 'read the preset'));
      });
    return () => {
      alive = false;
    };
  }, []);
  async function save() {
    if (!catalog || busy || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      await libraryCatalog({
        expected_revision: catalog.revision,
        entry_kind: target.kind,
        id: target.id,
        action: { kind: 'rename', name: name.trim() },
      });
      onChanged();
      onClose();
    } catch (cause) {
      setError(friendlyError(cause, 'rename this preset'));
      void libraryCatalog()
        .then(setCatalog)
        .catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  return (
    <AdjustmentDialog
      title="Rename preset"
      onCancel={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <FormField>
          Name on this device
          <input
            value={name}
            maxLength={120}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <Caption>The exported preset keeps its saved name.</Caption>
        {error && <p role="alert">{error}</p>}
        <ActionRow>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !catalog || !name.trim()}>
            Rename
          </Button>
        </ActionRow>
      </form>
    </AdjustmentDialog>
  );
}
