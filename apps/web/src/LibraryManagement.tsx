import {
  Archive,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
  DotsSixVertical,
  DownloadSimple,
  Plus,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { ActionRow } from '@oxidal/design-system/components/form-layout';
import { Loading } from '@oxidal/design-system/components/states';
import { Caption, Title } from '@oxidal/design-system/components/text';

import { type LibraryCatalog, libraryCatalog, type LibraryUpdate } from './api';
import { RowMenu } from './components/RowMenu';
import { FailureNotice } from './FailureNotice';
import {
  addSuggestedSet,
  duplicatePreset,
  setListMember,
  setUpStarter,
  starterMessage,
  type SuggestedSet,
  suggestedSetMessage,
  suggestedSets,
} from './features/library/setList';
import { SetOrderList } from './features/library/SetOrderList';
import { friendlyError } from './lib/friendlyError';
import { useFailure } from './lib/useFailure';
import { requestMidiAssignments } from './midiNavigation';
import { setPerform } from './performState';
import { playScenes, playTone3000 } from './presetChoices';
import { PresetManagement } from './PresetManagement';
import { useSetListDrag } from './useSetListDrag';

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
  const [orderReady, setOrderReady] = useState(false);
  const [managePresets, setManagePresets] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [outside, setOutside] = useState(false);
  const [notice, setNotice] = useState('');
  const alive = useRef(false);
  const writing = useRef(false);
  const root = useRef<HTMLDivElement>(null);
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
          const result = await setUpStarter(setNotice);
          message = starterMessage(result);
          return result.catalog;
        },
        () => message,
      );
    })();
  const drag = useSetListDrag(root, (item, before) => {
    void edit(item, {
      kind: 'place',
      before: before ? { kind: before.kind, id: before.id } : null,
    });
  });
  const suggested = (key: SuggestedSet) =>
    void (async () => {
      let message = '';
      await run(
        `add ${suggestedSets[key].name}`,
        async () => {
          const result = await addSuggestedSet(key, setNotice);
          message = suggestedSetMessage(key, result);
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
      {catalog && !removed && (
        <div hidden={managePresets}>
          <SetOrderList
            catalog={catalog}
            connected={connected && !busy}
            onReady={setOrderReady}
            onChanged={() => {
              setReload((n) => n + 1);
              onChanged();
            }}
            onPlay={() => {
              setPerform({ on: true, mode: 'play' });
              onOpenRig?.();
            }}
          />
        </div>
      )}
      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
        {(!orderReady || removed || managePresets) && (
          <Title as="h2" size="sm">
            Set list
          </Title>
        )}
        <Button
          variant="outline"
          disabled={disabled || !catalog}
          onClick={starter}
        >
          <Plus aria-hidden="true" /> Add starter set list
        </Button>
      </div>
      {(!orderReady || managePresets) && (
        <Caption>
          One set-list order for the preset picker, MIDI program changes and
          Perform. Hold a handle to drag, or use Move up and Move down. Removed
          entries can be restored.
        </Caption>
      )}
      <ActionRow aria-label="Suggested set lists">
        {(Object.keys(suggestedSets) as SuggestedSet[]).map((key) => (
          <Button
            key={key}
            variant="outline"
            disabled={disabled || !catalog}
            onClick={() => suggested(key)}
          >
            <Plus aria-hidden="true" /> Add {suggestedSets[key].name}
          </Button>
        ))}
      </ActionRow>
      <ActionRow>
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
      </ActionRow>
      <Caption>
        Backup includes presets, set-list order, descriptions, MIDI maps and
        separate NAM/IR files. Account sign-in and diagnostic history stay on
        this unit.
      </Caption>
      <FailureNotice
        failure={failure}
        busy={busy}
        onRefresh={() => {
          clear();
          setReload((n) => n + 1);
        }}
      />
      {notice && <Caption role="status">{notice}</Caption>}
      {!catalog && <Loading label="Loading the set list…" />}
      {catalog && !removed && !members.length && !orderReady && (
        <div className="set-list-empty">
          <Caption>
            No presets in your set list yet. Add from Mine, or start with the
            starter set list.
          </Caption>
        </div>
      )}
      {catalog && !removed && orderReady && (
        <Button
          variant="outline"
          onClick={() => setManagePresets(!managePresets)}
        >
          {managePresets ? 'Performance order' : 'Manage presets'}
        </Button>
      )}
      <div
        ref={root}
        className="set-list"
        data-dragging={drag.dragging || undefined}
      >
        {shown
          .filter(
            (item) =>
              removed || managePresets || !orderReady || item.kind === 'graph',
          )
          .map((item) => {
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
                          disabled:
                            item.kind !== 'rig' && item.kind !== 'owned',
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
        <Caption>No removed entries.</Caption>
      )}
      {catalog && !removed && notMembers.length > 0 && (
        <section aria-label="Not in the set list">
          <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3">
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
            <ul className="grid list-none gap-1 p-0">
              {notMembers.map((item) => (
                <li
                  key={`${item.kind}:${item.id}`}
                  className="preset-row grid min-w-0 gap-2 border-b border-border py-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                  data-outside-entry={item.id}
                >
                  <div className="preset-row-text min-w-0">
                    <span className="font-semibold break-words">
                      {item.name}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {item.kind === 'owned' ? 'Mine · saved tone' : 'Mine'}
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
      className="grid gap-2 border-b border-border py-3 data-[drop-before=true]:shadow-[0_-2px_var(--foreground)] data-[moving=true]:opacity-65 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
      data-library-entry={item.id}
      data-library-kind={item.kind}
      data-drop-before={drag.before === `${item.kind}:${item.id}` || undefined}
      data-moving={drag.dragging === `${item.kind}:${item.id}` || undefined}
    >
      <div className="set-list-title flex items-center gap-3">
        {movable && item.kind !== 'graph' && (
          <Button
            variant="ghost"
            className="cursor-grab touch-none active:cursor-grabbing"
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
          <Caption>
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
          </Caption>
        </div>
      </div>
      <ActionRow className="set-list-actions">
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
          <RowMenu
            name={item.name}
            items={menu}
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
      </ActionRow>
    </div>
  );
}
