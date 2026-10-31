import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Archive,
  ArrowCounterClockwise,
} from '@phosphor-icons/react';
import { libraryCatalog, type LibraryCatalog, type LibraryUpdate } from './api';
import { Button } from './components/ui/button';
import { PresetManagement } from './PresetManagement';

export function LibraryManagement({
  connected,
  onChanged,
}: {
  connected: boolean;
  onChanged: () => void;
}) {
  const [catalog, setCatalog] = useState<LibraryCatalog | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    void libraryCatalog()
      .then((s) => {
        if (alive.current) setCatalog(s);
      })
      .catch((e: unknown) => {
        if (alive.current) setError(String(e));
      });
    return () => {
      alive.current = false;
    };
  }, []);
  async function edit(
    item: LibraryCatalog['items'][number],
    action: LibraryUpdate['action'],
  ) {
    if (!catalog) return;
    setBusy(true);
    setError('');
    try {
      const result = await libraryCatalog({
        expected_revision: catalog.revision,
        entry_kind: item.kind,
        id: item.id,
        action,
      });
      if (alive.current) {
        setCatalog(result);
        onChanged();
      }
    } catch (e) {
      if (alive.current) {
        setError(String(e));
        try {
          setCatalog(await libraryCatalog());
        } catch {
          /* keep last confirmed catalog */
        }
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-label="Manage library">
      <p className="caption">
        Labels and order stay on this device. Removed entries can be restored.
      </p>
      <Button
        variant="outline"
        aria-pressed={removed}
        onClick={() => setRemoved((v) => !v)}
      >
        {removed ? 'Show available' : 'Show removed'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {!catalog && <p role="status">Loading library…</p>}
      {catalog?.items
        .filter((i) => i.archived === removed)
        .map((item) => (
          <LibraryRow
            key={`${item.kind}:${item.id}:${item.name}`}
            item={item}
            disabled={busy || !connected}
            onChanged={() => {
              onChanged();
              void libraryCatalog()
                .then((c) => {
                  if (alive.current) setCatalog(c);
                })
                .catch((e: unknown) => {
                  if (alive.current) setError(String(e));
                });
            }}
            onEdit={(action) => void edit(item, action)}
          />
        ))}
      {catalog && !catalog.items.some((i) => i.archived === removed) && (
        <p className="caption">
          {removed ? 'No removed entries.' : 'No saved entries.'}
        </p>
      )}
    </section>
  );
}
function LibraryRow({
  item,
  disabled,
  onEdit,
  onChanged,
}: {
  item: LibraryCatalog['items'][number];
  disabled: boolean;
  onEdit: (action: LibraryUpdate['action']) => void;
  onChanged: () => void;
}) {
  return (
    <div
      className="space-y-2 border-b border-border py-3"
      data-library-entry={item.id}
      data-library-kind={item.kind}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="break-words">{item.name}</h3>
          <p className="caption">
            {item.kind === 'original'
              ? 'Imported tone'
              : item.kind === 'owned'
                ? 'Saved tone'
                : item.kind === 'rig'
                  ? 'Preset with scenes'
                  : 'Effects preset'}
          </p>
        </div>
        <PresetManagement
          entry={item}
          disabled={disabled}
          onChanged={onChanged}
        />
      </div>
      <div className="action-row">
        {!item.archived && (
          <>
            <Button
              variant="ghost"
              disabled={disabled}
              aria-label={`Move ${item.name} up`}
              onClick={() => onEdit({ kind: 'move', up: true })}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              disabled={disabled}
              aria-label={`Move ${item.name} down`}
              onClick={() => onEdit({ kind: 'move', up: false })}
            >
              <ArrowDown aria-hidden="true" />
            </Button>
          </>
        )}
        <Button
          variant="outline"
          disabled={disabled}
          aria-label={`${item.archived ? 'Restore' : 'Remove'} ${item.name}`}
          onClick={() =>
            onEdit({ kind: 'visibility', archived: !item.archived })
          }
        >
          {item.archived ? (
            <ArrowCounterClockwise aria-hidden="true" />
          ) : (
            <Archive aria-hidden="true" />
          )}
          {item.archived ? 'Restore' : 'Remove'}
        </Button>
      </div>
    </div>
  );
}
