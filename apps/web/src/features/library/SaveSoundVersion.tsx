import { useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';

import { presetVersions, type VersionView } from '../../api';
import type { LibraryKind, VersionTarget } from '../../generated/contract';
import { friendlyError } from '../../lib/friendlyError';

/** A running sound can only advance a version that still points at its saved source. */
export function SaveSoundVersion({
  kind,
  source,
  name,
  disabled,
  onSave,
}: {
  kind: LibraryKind;
  source: string;
  name: string;
  disabled: boolean;
  onSave: (target: VersionTarget) => Promise<unknown>;
}) {
  const [view, setView] = useState<VersionView>();
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const receipt = useRef<{ key: string; id: string } | null>(null);
  async function choose() {
    setBusy(true);
    setError('');
    try {
      const next = await presetVersions(kind, source);
      setView(next);
      const choices = next.preset.versions.filter((v) => v.content === source);
      setSelected(
        choices.find((v) => v.id === next.preset.default_version)?.id ??
          choices[0]?.id ??
          '',
      );
    } catch (cause) {
      setError(friendlyError(cause, 'read the versions'));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!view || !selected || busy || disabled) return;
    setBusy(true);
    setError('');
    try {
      const key = JSON.stringify([
        name,
        source,
        selected,
        view.catalog_revision,
      ]);
      if (receipt.current?.key !== key)
        receipt.current = { key, id: crypto.randomUUID() };
      await onSave({
        first: view.preset.logical_id.slice(kind.length + 1),
        version: selected,
        expected_content: source,
        expected_revision: view.catalog_revision,
        request_id: receipt.current.id,
      });
    } catch (cause) {
      setError(friendlyError(cause, 'save this version'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      {!view ? (
        <Button
          variant="outline"
          disabled={disabled || busy}
          onClick={() => void choose()}
        >
          Save to a version…
        </Button>
      ) : (
        <>
          <label className="field">
            Version to update
            <select
              value={selected}
              disabled={disabled || busy}
              onChange={(event) => setSelected(event.target.value)}
            >
              {view.preset.versions
                .filter((v) => v.content === source)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.id === view.preset.default_version ? ' (default)' : ''}
                  </option>
                ))}
            </select>
          </label>
          {!selected && <p>No version currently uses this saved sound.</p>}
          <Button
            disabled={disabled || busy || !selected || !name.trim()}
            onClick={() => void save()}
          >
            Save to selected version
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setView(undefined)}
          >
            Cancel version selection
          </Button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
