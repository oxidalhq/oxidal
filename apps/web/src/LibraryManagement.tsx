import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Archive,
  ArrowCounterClockwise,
  DotsSixVertical,
} from '@phosphor-icons/react';
import { libraryCatalog, type LibraryCatalog, type LibraryUpdate } from './api';
import { Button } from './components/ui/button';
import { PresetManagement } from './PresetManagement';
import { useSetListDrag } from './useSetListDrag';

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
  const writing = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const drag = useSetListDrag(root, (item, before) => {
    void edit(item, {
      kind: 'place',
      before: before ? { kind: before.kind, id: before.id } : null,
    });
  });
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
    if (!catalog || writing.current) return;
    writing.current = true;
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
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const visible = catalog?.items.filter((i) => i.archived === removed) ?? [];
  const performance = visible.filter((i) => i.kind !== 'graph');
  const effects = visible.filter((i) => i.kind === 'graph');
  return (
    <section className="space-y-3" aria-label="Manage library">
      <h2>Set list</h2>
      <p className="caption">
        One set-list order for the preset picker and Perform. Hold a handle to
        drag, or use Move up and Move down. Removed entries can be restored.
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
      <div
        ref={root}
        className="set-list"
        data-dragging={drag.dragging || undefined}
      >
        {visible.map((item) => {
          const group = item.kind === 'graph' ? effects : performance;
          const index = group.findIndex(
            (i) => i.kind === item.kind && i.id === item.id,
          );
          return (
            <LibraryRow
              key={`${item.kind}:${item.id}:${item.name}`}
              item={item}
              position={
                item.kind !== 'graph' && !removed ? index + 1 : undefined
              }
              disabled={busy || !connected}
              first={index === 0}
              last={index === group.length - 1}
              drag={drag}
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
          );
        })}
      </div>
      {drag.dragging && (
        <p className="sr-only" role="status">
          Moving preset. Release to set its position.
        </p>
      )}
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
  position,
  first,
  last,
  drag,
}: {
  item: LibraryCatalog['items'][number];
  position: number | undefined;
  first: boolean;
  last: boolean;
  drag: ReturnType<typeof useSetListDrag>;
  disabled: boolean;
  onEdit: (action: LibraryUpdate['action']) => void;
  onChanged: () => void;
}) {
  return (
    <div
      className="set-list-row border-b border-border py-3"
      data-library-entry={item.id}
      data-library-kind={item.kind}
      data-drop-before={drag.before === `${item.kind}:${item.id}` || undefined}
      data-moving={drag.dragging === `${item.kind}:${item.id}` || undefined}
    >
      <div className="set-list-title flex items-center gap-3">
        {!item.archived && item.kind !== 'graph' && (
          <Button
            variant="ghost"
            className="set-list-handle"
            disabled={disabled}
            aria-label={`Drag ${item.name}`}
            onPointerDown={(e) => drag.start(e, item)}
            onPointerMove={drag.move}
            onPointerUp={drag.end}
            onPointerCancel={drag.cancel}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                onEdit({ kind: 'move', up: e.key === 'ArrowUp' });
              }
            }}
          >
            <DotsSixVertical aria-hidden="true" />
          </Button>
        )}

        <div className="min-w-0 flex-1">
          <h3 className="break-words">{item.name}</h3>
          <p className="caption">
            {position !== undefined && (
              <span aria-label={`Set-list position ${position}`}>
                {position} ·{' '}
              </span>
            )}
            {item.kind === 'original'
              ? 'Imported tone'
              : item.kind === 'owned'
                ? 'Saved tone'
                : item.kind === 'rig'
                  ? 'Preset with scenes'
                  : 'Effects draft · Author'}
          </p>
        </div>
      </div>
      <div className="action-row set-list-actions">
        {!item.archived && (
          <>
            <Button
              variant="ghost"
              disabled={disabled || first}
              aria-label={`Move ${item.name} up`}
              onClick={() => onEdit({ kind: 'move', up: true })}
            >
              <ArrowUp aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              disabled={disabled || last}
              aria-label={`Move ${item.name} down`}
              onClick={() => onEdit({ kind: 'move', up: false })}
            >
              <ArrowDown aria-hidden="true" />
            </Button>
          </>
        )}
        <PresetManagement
          entry={item}
          disabled={disabled}
          onChanged={onChanged}
          compact
        />
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
