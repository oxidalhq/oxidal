import { useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { FormField } from '@oxidal/design-system/components/form-layout';

import {
  type LibraryCatalog,
  presetVersions,
  type VersionEdit,
  type VersionSelection,
  type VersionView,
} from '../../api';
import { friendlyError } from '../../lib/friendlyError';

export function PresetVersions({
  kind,
  id,
  editable,
  onChanged,
  onEdit,
}: {
  kind: LibraryCatalog['items'][number]['kind'];
  id: string;
  editable: boolean;
  onChanged?: () => void;
  onEdit?: (selection: VersionSelection) => void;
}) {
  const [view, setView] = useState<VersionView>();
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef<{ body: string; id: string } | null>(null);
  const version = view?.preset.versions.find((v) => v.id === selected);
  async function update(action?: VersionEdit['action']) {
    if (busy || (action && (!version || !view))) return;
    setBusy(true);
    setError('');
    try {
      let request: VersionEdit | undefined;
      if (action && view && version) {
        const fields = {
          expected_revision: view.catalog_revision,
          expected_content: version.content,
          version: version.id,
          action,
        };
        const body = JSON.stringify(fields);
        if (pending.current?.body !== body)
          pending.current = { body, id: crypto.randomUUID() };
        request = { ...fields, request_id: pending.current.id };
      }
      const first = view?.preset.logical_id.slice(kind.length + 1) ?? id;
      const result = await presetVersions(kind, first, request);
      pending.current = null;
      const next =
        action?.action === 'create'
          ? result.preset.versions.find(
              (v) => !view?.preset.versions.some((old) => old.id === v.id),
            )
          : result.preset.versions.find((v) => v.id === selected);
      setView(result);
      setSelected(next?.id ?? result.preset.default_version);
      setName('');
      setConfirmDelete(false);
      if (action) onChanged?.();
    } catch (e) {
      setError(
        friendlyError(
          e,
          action ? 'save the version change' : 'read the versions',
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Preset versions" className="space-y-2">
      {view && version ? (
        <>
          <FormField>
            Version
            <select
              value={selected}
              disabled={busy}
              onChange={(e) => {
                setSelected(e.target.value);
                setConfirmDelete(false);
                setName('');
              }}
            >
              {view.preset.versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.id === view.preset.default_version ? ' (default)' : ''}
                </option>
              ))}
            </select>
          </FormField>
          {editable && (
            <fieldset disabled={busy} className="space-y-2">
              {onEdit && kind === 'rig' && (
                <Button
                  variant="outline"
                  onClick={() =>
                    onEdit({
                      first: view.preset.logical_id.slice(kind.length + 1),
                      version: version.id,
                      expected_content: version.content,
                      expected_revision: view.catalog_revision,
                    })
                  }
                >
                  Edit this version offline
                </Button>
              )}
              <FormField>
                Version name
                <input
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
              </FormField>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={!name.trim()}
                  onClick={() =>
                    void update({ action: 'create', name: name.trim() })
                  }
                >
                  Copy as new version
                </Button>
                <Button
                  variant="outline"
                  disabled={!name.trim()}
                  onClick={() =>
                    void update({ action: 'rename', name: name.trim() })
                  }
                >
                  Rename version
                </Button>
                {version.id !== view.preset.default_version && (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => void update({ action: 'set_default' })}
                    >
                      Make default
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setConfirmDelete(true)}
                    >
                      Remove version
                    </Button>
                  </>
                )}
              </div>
              {confirmDelete && (
                <div className="space-y-2">
                  <p>Remove {version.name} from this preset?</p>
                  <Button onClick={() => void update({ action: 'delete' })}>
                    Confirm removal
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </fieldset>
          )}
        </>
      ) : (
        <Button variant="outline" disabled={busy} onClick={() => void update()}>
          View versions
        </Button>
      )}
      {error && (
        <div role="alert">
          {error}{' '}
          {view && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void update()}
            >
              Reload versions
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
