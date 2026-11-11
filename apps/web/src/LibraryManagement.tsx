import { FailureNotice } from './components/ui/failure';
import { useFailure } from './lib/useFailure';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  Archive,
  ArrowCounterClockwise,
  DotsSixVertical,
  DotsThree,
  DownloadSimple,
  Plus,
} from '@phosphor-icons/react';
import { Loading } from './components/ui/loading';
import { libraryCatalog, type LibraryCatalog, type LibraryUpdate } from './api';
import { Button } from './components/ui/button';
import { PresetManagement } from './PresetManagement';
import { useSetListDrag } from './useSetListDrag';
import './LibraryManagement.css';
import { playScenes, playTone3000 } from './presetChoices';
import { requestMidiAssignments } from './midiNavigation';
import { friendlyError } from './lib/friendlyError';
import {
  addStarter,
  duplicatePreset,
  setListMember,
  starterMessage,
} from './features/library/setList';

type Item = LibraryCatalog['items'][number];
const originOf = (item: Item) =>
  item.origin ?? (item.kind === 'original' ? 'tone3000' : 'mine');

/**
 * The Set list: the ordered presets MIDI program changes, Previous/Next and
 * the picker follow. Membership is explicit: presets in Mine can stay out of
 * it, and read-only Oxidal sounds join by reference. Adds the starter set
 * list after the existing entries, never in their place.
 * @see docs/presets/format.md
 */
export function LibraryManagement({
  connected,
  onChanged,
  onOpenRig,
}: {
  connected: boolean;
  onChanged: () => void;
  /** Open a set-list preset: it plays and the Rig page opens. */
  onOpenRig?: () => void;
}) {
  const [catalog, setCatalog] = useState<LibraryCatalog | null>(null);
  const { failure, fail, clear } = useFailure();
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [outside, setOutside] = useState(false);
  const [notice, setNotice] = useState('');
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
        if (alive.current) fail(e, 'read the set list');
      });
    return () => {
      alive.current = false;
    };
  }, [reload, fail]);
  async function edit(item: Item, action: LibraryUpdate['action']) {
    if (!catalog || writing.current) return;
    await run('update the set list', () =>
      libraryCatalog({
        expected_revision: catalog.revision,
        entry_kind: item.kind,
        id: item.id,
        action,
      }),
    );
  }
  /** One write at a time; the list is read again after a failure. */
  async function run(
    what: string,
    write: () => Promise<LibraryCatalog>,
    done?: (catalog: LibraryCatalog) => string,
  ) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    clear();
    setNotice('');
    try {
      const result = await write();
      if (alive.current) {
        setCatalog(result);
        if (done) setNotice(done(result));
        onChanged();
      }
    } catch (e) {
      if (alive.current) {
        fail(e, what);
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
  async function open(item: Item, midi = false) {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    clear();
    try {
      if (item.kind === 'rig') await playScenes(item.id);
      else await playTone3000(item.id, item.kind === 'owned');
      if (midi) requestMidiAssignments();
      onOpenRig?.();
    } catch (e) {
      if (alive.current) setNotice(friendlyError(e, 'open this preset'));
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const starter = () =>
    void (async () => {
      let message = '';
      await run(
        'add the starter set list',
        async () => {
          const result = await addStarter();
          message = starterMessage(result);
          return result.catalog;
        },
        () => message,
      );
    })();
  // Earlier revisions of presets saved again are history, not Removed items.
  const current = catalog?.items.filter((i) => !i.superseded) ?? [];
  const members = current.filter((i) => i.in_set_list);
  const drafts = current.filter(
    (i) => !i.archived && i.kind === 'graph' && originOf(i) === 'mine',
  );
  const notMembers = current.filter(
    (i) =>
      !i.archived &&
      !i.in_set_list &&
      i.kind !== 'graph' &&
      originOf(i) === 'mine',
  );
  const archived = current.filter((i) => i.archived);
  const shown = removed ? archived : [...members, ...drafts];
  const disabled = busy || !connected;
  return (
    <section className="space-y-3" aria-label="Set list">
      <div className="section-heading">
        <h2>Set list</h2>
        <Button
          variant="outline"
          disabled={disabled || !catalog}
          onClick={starter}
        >
          <Plus aria-hidden="true" /> Add starter set list
        </Button>
      </div>
      <p className="caption">
        One set-list order for the preset picker, MIDI program changes and
        Perform. Hold a handle to drag, or use Move up and Move down. Removed
        entries can be restored.
      </p>
      <div className="action-row">
        <Button
          variant="outline"
          aria-pressed={removed}
          onClick={() => setRemoved((v) => !v)}
        >
          {removed ? 'Show available' : 'Show removed'}
        </Button>
        <Button variant="outline" asChild>
          <a href="/api/v1/backup/library" download>
            <DownloadSimple aria-hidden="true" /> Download backup
          </a>
        </Button>
      </div>
      <p className="caption">
        Backup includes presets, set-list order, descriptions, MIDI maps and
        separate NAM/IR files. Account sign-in and diagnostic history stay on
        this unit.
      </p>
      <FailureNotice
        failure={failure}
        busy={busy}
        onRefresh={() => {
          clear();
          setReload((n) => n + 1);
        }}
      />
      {notice && (
        <p className="caption" role="status">
          {notice}
        </p>
      )}
      {!catalog && <Loading label="Loading the set list…" />}
      {catalog && !removed && !members.length && (
        <div className="set-list-empty">
          <p className="caption">
            No presets in your set list yet. Add from Mine, or start with the
            starter set list.
          </p>
        </div>
      )}
      <div
        ref={root}
        className="set-list"
        data-dragging={drag.dragging || undefined}
      >
        {shown.map((item) => {
          const group = item.kind === 'graph' ? drafts : members;
          const index = group.findIndex(
            (i) => i.kind === item.kind && i.id === item.id,
          );
          return (
            <LibraryRow
              key={`${item.kind}:${item.id}:${item.name}`}
              item={item}
              position={item.in_set_list && !removed ? index + 1 : undefined}
              disabled={disabled}
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
                    if (alive.current) fail(e, 'read the set list');
                  });
              }}
              onEdit={(action) => void edit(item, action)}
              menu={
                item.in_set_list && !removed
                  ? [
                      {
                        label: 'Open',
                        onSelect: () => void open(item),
                      },
                      {
                        label: 'Duplicate',
                        disabled: item.kind !== 'rig',
                        onSelect: () =>
                          void run(
                            'duplicate this preset',
                            async () => (await duplicatePreset(item)).catalog,
                            (c) =>
                              `"${c.items.find((i) => i.kind === c.created?.kind && i.id === c.created?.id)?.name ?? 'The copy'}" is in Mine. It is not in the set list.`,
                          ),
                      },
                      {
                        label: 'Remove from set list',
                        onSelect: () =>
                          void run(
                            'remove this preset from the set list',
                            () => setListMember(item, false),
                            () =>
                              originOf(item) === 'mine'
                                ? `Removed ${item.name} from the set list. It stays in Mine.`
                                : `Removed ${item.name} from the set list.`,
                          ),
                      },
                      {
                        label: 'MIDI',
                        onSelect: () => void open(item, true),
                      },
                    ]
                  : undefined
              }
              note={
                originOf(item) === 'oxidal_example'
                  ? 'This is a read-only Oxidal sound. Duplicate makes your copy in Mine.'
                  : undefined
              }
            />
          );
        })}
      </div>
      {drag.dragging && (
        <p className="sr-only" role="status">
          Moving preset. Release to set its position.
        </p>
      )}
      {catalog && removed && !archived.length && (
        <p className="caption">No removed entries.</p>
      )}
      {catalog && !removed && notMembers.length > 0 && (
        <section className="set-list-outside" aria-label="Not in the set list">
          <div className="section-heading">
            <h3>Not in the set list ({notMembers.length})</h3>
            <Button
              variant="ghost"
              aria-expanded={outside}
              onClick={() => setOutside((v) => !v)}
            >
              {outside ? 'Hide' : 'Show'}
            </Button>
          </div>
          {outside && (
            <ul className="preset-library">
              {notMembers.map((item) => (
                <li
                  key={`${item.kind}:${item.id}`}
                  className="library-row preset-row"
                  data-outside-entry={item.id}
                >
                  <div className="preset-row-text min-w-0">
                    <span className="library-name">{item.name}</span>
                    <span className="library-meta">
                      {item.kind === 'owned' ? 'TONE3000 chain' : 'Mine'}
                    </span>
                  </div>
                  <div className="preset-row-actions">
                    <Button
                      variant="outline"
                      disabled={disabled}
                      aria-label={`Add ${item.name} to the set list`}
                      onClick={() =>
                        void run(
                          'add this preset to the set list',
                          () => setListMember(item, true),
                          (c) =>
                            `Added to the set list as #${c.items.filter((i) => i.in_set_list).length}.`,
                        )
                      }
                    >
                      Add to set list
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
type MenuAction = { label: string; onSelect: () => void; disabled?: boolean };
function LibraryRow({
  item,
  disabled,
  onEdit,
  onChanged,
  position,
  first,
  last,
  drag,
  menu,
  note,
}: {
  item: Item;
  position: number | undefined;
  first: boolean;
  last: boolean;
  drag: ReturnType<typeof useSetListDrag>;
  disabled: boolean;
  onEdit: (action: LibraryUpdate['action']) => void;
  onChanged: () => void;
  menu?: MenuAction[];
  note?: string;
}) {
  const origin = originOf(item);
  const movable = !item.archived && (item.in_set_list || item.kind === 'graph');
  return (
    <div
      className="set-list-row border-b border-border py-3"
      data-library-entry={item.id}
      data-library-kind={item.kind}
      data-drop-before={drag.before === `${item.kind}:${item.id}` || undefined}
      data-moving={drag.dragging === `${item.kind}:${item.id}` || undefined}
    >
      <div className="set-list-title flex items-center gap-3">
        {movable && item.kind !== 'graph' && (
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
                {position} · PC {position} ·{' '}
              </span>
            )}
            {origin === 'tone3000'
              ? 'TONE3000 · read-only original'
              : origin === 'oxidal_example'
                ? 'Oxidal sound · read-only'
                : item.kind === 'owned'
                  ? 'Mine · saved tone'
                  : item.kind === 'rig'
                    ? 'Mine · scenes and effects'
                    : 'Mine · effects draft · Author'}
          </p>
        </div>
      </div>
      <div className="action-row set-list-actions">
        {movable && (
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
        {menu && (
          <SetListMenu
            name={item.name}
            actions={menu}
            disabled={disabled}
            note={note}
          />
        )}
        {origin !== 'oxidal_example' && (
          <PresetManagement
            entry={item}
            disabled={disabled}
            onChanged={onChanged}
            compact
          />
        )}
        <Button
          variant="outline"
          disabled={disabled}
          aria-label={`${item.archived ? 'Restore' : 'Remove'} ${item.name}`}
          title={
            item.archived
              ? undefined
              : 'Hide this preset everywhere; Restore brings it back'
          }
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

/** The ⋯ menu of a set-list row: Open · Duplicate · Remove from set list · MIDI. */
function SetListMenu({
  name,
  actions,
  disabled,
  note,
}: {
  name: string;
  actions: MenuAction[];
  disabled: boolean;
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="row-menu" ref={root}>
      <Button
        variant="ghost"
        size="icon"
        disabled={disabled}
        aria-label={`More for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <DotsThree aria-hidden="true" weight="bold" />
      </Button>
      {open && (
        <div className="row-menu-list" role="menu" aria-label={name}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => {
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.label}
            </button>
          ))}
          {note && <p className="caption row-menu-note">{note}</p>}
        </div>
      )}
    </div>
  );
}
