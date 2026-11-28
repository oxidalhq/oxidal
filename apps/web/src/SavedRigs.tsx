import { type ReactNode, useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Checkbox } from '@oxidal/design-system/components/checkbox';
import { ActionRow } from '@oxidal/design-system/components/form-layout';
import { Caption, Title } from '@oxidal/design-system/components/text';
import { useMedia } from '@oxidal/design-system/lib/use-media';
import {
  type LibraryBadge,
  LibraryDetail,
  type LibraryItem,
  LibraryList,
  type RowAction as PanelAction,
} from '@oxidal/design-system/patterns/library-list';

import { AdjustmentDialog } from './AdjustmentDialog';
import {
  libraryCatalog,
  type PresetDetails,
  rigAudioState,
  rigLibrary,
  type RigPage,
} from './api';
import type { RowAction } from './components/RowMenu';
import { FailureNotice } from './FailureNotice';
import { presetChain, useLv2Names } from './features/library/presetChain';
import { PresetRow, PresetTile } from './features/library/PresetRow';
import { duplicatePreset, setListMember } from './features/library/setList';
import { useFailure } from './lib/useFailure';
import { requestMidiAssignments } from './midiNavigation';
import {
  GAPLESS_BANK_SIZE,
  gaplessBank,
  playScenes,
  prepareKeepReady,
  readKeepReady,
  readyRevisions,
  rigTopologyLabel,
  writeKeepReady,
} from './presetChoices';
import { detailsMatch, presetSearchText } from './presetMetadata';

/**
 * Portable rigs in the Library: rows look and play like every other
 * preset; one tap stops whatever is playing and opens the Rig page.
 * Keep ready loads chosen presets in the background for gapless switching.
 * @see docs/audio.md
 */
/** The set list chip a Mine row shows; nothing for presets not in it. */
function setListBadge(
  members: Map<string, number> | null,
  kind: 'rig' | 'owned',
  id: string,
): LibraryBadge | null {
  const position = members?.get(`${kind}:${id}`);
  return position ? { text: `In set list #${position}` } : null;
}

/** Set list state and actions SavedRigs hands to rows it does not own. */
export type SetListControls = {
  /** The row's chip, such as "In set list #2"; null when it is not in it. */
  badge: (id: string) => LibraryBadge | null;
  /** Null until the catalog has been read. */
  isMember: (id: string) => boolean | null;
  toggle: (id: string, name: string, add: boolean) => void;
  disabled: boolean;
};

/** A row beside the details panel: whether it is shown there, and how to show it. */
export type PanelSelection = { selected: boolean; onSelect: () => void };

type OwnedRow = {
  id: string;
  name: string;
  /** The one-line summary the details panel repeats. */
  caption: string;
  /** The same actions as the row's menu, for the details panel. */
  actions: (setList: SetListControls) => RowAction[];
  /** Opens the full Preset details dialog. */
  onDetails: () => void;
  render: (
    setList: SetListControls,
    favourite: ReactNode,
    panel: PanelSelection | null,
  ) => ReactNode;
};

/** The order the details panel lists actions in (C2): set list first, MIDI last. */
const PANEL_ORDER = [
  'Add to set list',
  'Remove from set list',
  'Duplicate',
  'Rename',
  'Download',
  'MIDI',
];

/** The menu's actions as the details panel's buttons; Edit (without playing) gets its own wide button. */
function panelActions(actions: RowAction[]): PanelAction[] {
  return actions
    .filter((action) => action.label !== 'Edit')
    .map((action): PanelAction =>
      'href' in action
        ? {
            label: action.label,
            href: action.href,
            download: action.download,
            run: () => {},
          }
        : {
            label: action.label,
            run: action.onSelect,
            disabled: action.disabled,
            destructive: action.label.startsWith('Delete'),
          },
    )
    .sort(
      (a, b) =>
        (PANEL_ORDER.indexOf(a.label) + 1 || 99) -
        (PANEL_ORDER.indexOf(b.label) + 1 || 99),
    );
}

const addedDate = (at: number | undefined) =>
  at === undefined
    ? null
    : new Date(at).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });

const favouritesKey = 'oxidal-library-favourites';
function readFavourites(): string[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(favouritesKey) ?? '[]',
    );
    return Array.isArray(saved)
      ? saved.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

export function SavedRigs({
  connected,
  onOpenRig,
  refresh = 0,
  query: controlledQuery,
  onQuery: setControlledQuery,
  category = '',
  details = {},
  onDetails,
  onEdit,
  origin = 'mine',
  title = 'Mine',
  owned = [],
  primary,
  toolbar,
  toolbarEnd,
  empty,
  onManage,
}: {
  refresh?: number;
  query?: string;
  onQuery?: (value: string) => void;
  category?: string;
  details?: Record<string, PresetDetails>;
  onDetails?: (id: string, name: string) => void;
  /** Edit without playing (7.3). */
  onEdit?: (revision: string, name: string) => void;
  origin?: RigPage['presets'][number]['origin'];
  title?: string;
  /** More rows for the same list (owned TONE3000 chains in Mine). */
  owned?: OwnedRow[];
  primary?: ReactNode;
  /** After Favourites, Sort and List/Artwork. */
  toolbar?: ReactNode;
  /** At the end of the toolbar line, after Keep ready (the category). */
  toolbarEnd?: ReactNode;
  /** Shown when the list has loaded and holds nothing. */
  empty?: ReactNode;
  /** Rename or delete a preset; the list refreshes when the parent does. */
  onManage?: (
    action: 'rename' | 'delete',
    entry: { kind: 'rig'; id: string; name: string },
  ) => void;
  connected: boolean;
  onOpenRig: () => void;
}) {
  const [ownQuery, setOwnQuery] = useState('');
  const query = controlledQuery ?? ownQuery;
  const onQuery = setControlledQuery ?? setOwnQuery;
  const [favourites, setFavourites] = useState(readFavourites);
  function favourite(id: string, on: boolean) {
    const next = on
      ? [...new Set([...favourites, id])]
      : favourites.filter((entry) => entry !== id);
    setFavourites(next);
    try {
      localStorage.setItem(favouritesKey, JSON.stringify(next));
    } catch {
      // Keep the selection for this visit if browser storage is unavailable.
    }
  }
  const [items, setItems] = useState<RigPage['presets']>([]);
  const lv2Names = useLv2Names(
    items.some((p) => p.blocks?.some((b) => b.kind === 'lv2')),
  );
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const { failure, fail, clear } = useFailure();
  const [reload, setReload] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [prepared, setPreparedState] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  /** Worker-confirmed loaded revisions; empty when audio is not running. */
  const [ready, setReady] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [modified, setModified] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** Rigs in the set list (Add to / Remove from set list in the menu). */
  const [members, setMembers] = useState<Map<string, number> | null>(null);
  const [notice, setNotice] = useState('');
  const [addedAt, setAddedAt] = useState<Record<string, number | undefined>>(
    {},
  );
  /** Wide screens show the chosen preset in a panel beside the list (C2). */
  const wide = useMedia('(min-width: 80rem)');
  const [chosen, setChosen] = useState<string | null>(null);
  function readMembers() {
    return libraryCatalog()
      .then((catalog) => {
        if (alive.current) {
          setAddedAt(catalog.added_at ?? {});
          setMembers(
            new Map(
              catalog.items
                .filter((i) => i.in_set_list)
                .map((i, index) => [`${i.kind}:${i.id}`, index + 1]),
            ),
          );
        }
      })
      .catch(() => {});
  }
  /** Duplicate: "Name copy" in Mine, not in the set list, opened stopped. */
  async function duplicate(revision: string) {
    setBusy(true);
    clear();
    setNotice('');
    try {
      const { copy } = await duplicatePreset({ kind: 'rig', id: revision });
      if (!alive.current) return;
      setNotice(`"${copy.name}" is in Mine. It is not in the set list.`);
      setReload((n) => n + 1);
      onEdit?.(copy.id, copy.name);
    } catch (cause) {
      if (alive.current)
        fail(cause, 'duplicate this preset', () => void duplicate(revision));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function member(
    revision: string,
    name: string,
    add: boolean,
    kind: 'rig' | 'owned' = 'rig',
  ) {
    setBusy(true);
    clear();
    setNotice('');
    try {
      const catalog = await setListMember({ kind, id: revision }, add);
      if (!alive.current) return;
      const position =
        catalog.items
          .filter((i) => i.in_set_list)
          .findIndex((i) => i.kind === kind && i.id === revision) + 1;
      setNotice(
        add
          ? `Added ${name} to the set list as #${position}.`
          : `Removed ${name} from the set list. It stays in Mine.`,
      );
      await readMembers();
    } catch (cause) {
      if (alive.current) fail(cause, 'change the set list');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function readRig() {
    return rigAudioState()
      .then((rig) => {
        if (!alive.current) return;
        setRunning(rig.phase === 'running');
        setModified(!!rig.control?.modified);
        setReady(readyRevisions(rig));
        setPlaying(
          rig.phase === 'running' ? (rig.configured?.revision ?? null) : null,
        );
      })
      .catch(() => {});
  }
  async function prepare() {
    setConfirming(false);
    setBusy(true);
    clear();
    try {
      await prepareKeepReady();
    } catch (cause) {
      if (alive.current)
        fail(cause, 'prepare these presets', () => void prepare());
    } finally {
      if (alive.current) setBusy(false);
      await readRig();
    }
  }
  /** The device stores the choice; the screen shows what it confirmed. */
  function setPrepared(update: (old: string[]) => string[]) {
    const next = update(prepared);
    setPreparedState(next);
    void writeKeepReady(next)
      .then((saved) => alive.current && setPreparedState(saved))
      .catch((cause: unknown) => {
        if (alive.current) {
          fail(cause, 'change Keep ready');
          void readKeepReady().then(setPreparedState, () => {});
        }
      });
  }
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    void rigLibrary()
      .then((page) => {
        if (alive.current) {
          setItems(page.presets);
          setNext(page.next ?? null);
          setLoaded(true);
        }
      })
      .catch((cause: unknown) => {
        if (alive.current) fail(cause, 'read your presets');
      });
    void readKeepReady()
      .then((saved) => alive.current && setPreparedState(saved))
      .catch(() => {});
    void readRig();
    void readMembers();
    return () => {
      alive.current = false;
    };
  }, [refresh, reload, fail, origin]);
  async function play(revision: string, openMidi = false) {
    setBusy(true);
    setLoadingId(revision);
    clear();
    try {
      await playScenes(
        revision,
        gaplessBank(
          revision,
          bankOrder.map((item) => item.revision),
        ),
      );
      if (alive.current) {
        // Starting may have changed the ready set.
        void readKeepReady().then(setPreparedState, () => {});
        void readRig();
        if (openMidi) requestMidiAssignments();
        onOpenRig();
      }
    } catch (cause) {
      if (alive.current)
        fail(cause, 'play this preset', () => void play(revision, openMidi));
    } finally {
      if (alive.current) {
        setBusy(false);
        setLoadingId(null);
      }
    }
  }
  async function more(all = false) {
    if (!next || busy) return;
    setBusy(true);
    clear();
    try {
      let cursor: string | null = next;
      const visited = new Set<string>();
      do {
        if (visited.has(cursor))
          throw new Error('The device repeated a Library page');
        visited.add(cursor);
        const page: RigPage = await rigLibrary(cursor);
        if (!alive.current) return;
        setItems((old) => [
          ...old,
          ...page.presets.filter(
            (p) => !old.some((o) => o.revision === p.revision),
          ),
        ]);
        cursor = page.next ?? null;
        setNext(cursor);
      } while (all && cursor !== null);
    } catch (cause) {
      if (alive.current) fail(cause, 'load more presets', () => void more(all));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const originItems = items.filter((item) => item.origin === origin);
  const bankOrder = originItems.filter((item) =>
    detailsMatch(item.name, details[`rig:${item.revision}`], query, category),
  );
  const rows = [
    ...originItems.map((rig) => ({
      kind: 'rig' as const,
      id: rig.revision,
      name: rig.name,
      rig,
    })),
    ...owned.map((item) => ({ kind: 'owned' as const, ...item })),
  ].filter((item) =>
    detailsMatch(item.name, details[`${item.kind}:${item.id}`], '', category),
  );
  const byId = new Map(rows.map((item) => [`${item.kind}:${item.id}`, item]));
  const setList: SetListControls = {
    badge: (id: string) => setListBadge(members, 'owned', id),
    isMember: (id: string) => members?.has(`owned:${id}`) ?? null,
    toggle: (id: string, name: string, add: boolean) =>
      void member(id, name, add, 'owned'),
    disabled: !connected || busy,
  };
  const readyCount = bankOrder.filter((p) => ready.includes(p.revision)).length;
  const readyLine = running
    ? `${readyCount} of ${bankOrder.length}${next ? '+' : ''} presets ready`
    : 'Nothing is ready while audio is stopped.';
  // Selected but not loaded beside the playing preset: needs a restart.
  const pending = prepared.some((id) => id !== playing && !ready.includes(id));
  /** The same actions a rig row's ⋯ menu has. */
  function rigActions(p: RigPage['presets'][number]): RowAction[] {
    return [
      ...(onEdit
        ? [
            {
              label: 'Edit',
              onSelect: () => onEdit(p.revision, p.name),
              disabled: busy,
            },
          ]
        : []),
      ...(origin === 'mine'
        ? [
            {
              label: 'Duplicate',
              onSelect: () => void duplicate(p.revision),
              disabled: !connected || busy,
            },
            members?.has(`rig:${p.revision}`)
              ? {
                  label: 'Remove from set list',
                  onSelect: () => void member(p.revision, p.name, false),
                  disabled: !connected || busy,
                }
              : {
                  label: 'Add to set list',
                  onSelect: () => void member(p.revision, p.name, true),
                  disabled: !connected || busy || !members,
                },
          ]
        : []),
      {
        label: 'MIDI',
        onSelect: () => void play(p.revision, true),
        disabled: !connected || busy,
      },
      ...(onManage
        ? [
            {
              label: 'Rename',
              onSelect: () =>
                onManage('rename', {
                  kind: 'rig',
                  id: p.revision,
                  name: p.name,
                }),
              disabled: !connected || busy,
            },
            {
              label: 'Delete…',
              onSelect: () =>
                onManage('delete', {
                  kind: 'rig',
                  id: p.revision,
                  name: p.name,
                }),
              disabled: !connected || busy,
            },
          ]
        : []),
    ];
  }
  /** Status chips after Playing: Unsaved, Ready, In set list. */
  function rigBadges(p: RigPage['presets'][number]): LibraryBadge[] {
    const active = playing === p.revision;
    return [
      active && modified
        ? ({ text: 'Unsaved', tone: 'warning' } as const)
        : null,
      !active && ready.includes(p.revision) ? { text: 'Ready' } : null,
      !ready.includes(p.revision) && prepared.includes(p.revision)
        ? { text: 'Not ready yet' }
        : null,
      origin === 'mine' ? setListBadge(members, 'rig', p.revision) : null,
    ].filter((badge): badge is LibraryBadge => badge !== null);
  }
  /** The row the details panel shows: the one you chose, else what plays, else the first. */
  function panelItem(shown: LibraryItem[]) {
    if (!wide) return undefined;
    const playingId = playing ? `rig:${playing}` : null;
    return (
      shown.find((i) => i.id === chosen) ??
      shown.find((i) => i.id === playingId) ??
      shown[0]
    );
  }
  function aside(shown: LibraryItem[]) {
    const item = panelItem(shown);
    const row = item && byId.get(item.id);
    if (!item || !row) return null;
    const id = item.id;
    const facts: [string, string][] = [];
    const scenes = row.kind === 'rig' ? (row.rig.scenes ?? []) : [];
    if (scenes.length) facts.push(['Scenes', scenes.join(', ')]);
    if (members && (row.kind === 'rig' ? origin === 'mine' : true)) {
      const position = members.get(id);
      facts.push(['Set list', position ? `#${position}` : 'Not in it']);
    }
    const categories = details[id]?.categories ?? [];
    if (categories.length) facts.push(['Categories', categories.join(', ')]);
    const added = addedDate(addedAt[id]);
    if (added) facts.push(['Added', added]);
    const menu =
      row.kind === 'rig' ? rigActions(row.rig) : row.actions(setList);
    const edit = menu.find(
      (action): action is Extract<RowAction, { onSelect: () => void }> =>
        action.label === 'Edit' && 'onSelect' in action,
    );
    const openDetails =
      row.kind === 'rig'
        ? onDetails && (() => onDetails(row.rig.revision, row.rig.name))
        : row.onDetails;
    return (
      <LibraryDetail
        item={{
          id,
          title: row.name,
          caption:
            row.kind === 'rig'
              ? rigTopologyLabel({ ...row.rig, scenes })
              : row.caption,
          about: details[id]?.description || undefined,
          chain:
            row.kind === 'rig'
              ? presetChain(row.rig.blocks, lv2Names)
              : undefined,
          facts: facts.length ? facts : undefined,
        }}
        tile={<PresetTile />}
        showTitle
        actions={[
          ...panelActions(menu),
          ...(openDetails
            ? [{ label: 'Details…', run: openDetails } satisfies PanelAction]
            : []),
        ]}
        extra={
          edit && (
            <Button
              variant="outline"
              className="w-full"
              disabled={edit.disabled}
              onClick={edit.onSelect}
            >
              Edit
            </Button>
          )
        }
      />
    );
  }
  const panel = (id: string, shown: LibraryItem[]): PanelSelection | null =>
    wide
      ? { selected: panelItem(shown)?.id === id, onSelect: () => setChosen(id) }
      : null;
  const keepReady = (
    <Button
      size="sm"
      variant="ghost"
      aria-pressed={choosing}
      disabled={busy}
      title={readyLine}
      onClick={() => setChoosing((v) => !v)}
    >
      Keep ready{prepared.length ? ` · ${prepared.length}` : ''}
    </Button>
  );
  return (
    <section className="mb-6" aria-label="Saved rigs">
      {title && (
        <Title as="h2" size="sm" className="mb-4">
          {title}
        </Title>
      )}
      {choosing && (
        <div className="mb-3 grid gap-2">
          <Caption role="status">{readyLine}</Caption>
          <Caption>
            Choose up to {GAPLESS_BANK_SIZE} more presets to keep ready. They
            stay loaded, so switching between them has no gap. Without custom
            choices, each adjacent group of {GAPLESS_BANK_SIZE} loads together.
          </Caption>
          {running && pending && (
            <ActionRow>
              <Caption as="span">
                Selected presets load when audio restarts.
              </Caption>
              <Button
                variant="outline"
                disabled={busy || !connected}
                onClick={() => setConfirming(true)}
              >
                Prepare &amp; restart audio…
              </Button>
            </ActionRow>
          )}
          {!running && !!prepared.length && (
            <Caption>
              Your selection is prepared the next time a preset plays.
            </Caption>
          )}
        </div>
      )}
      {confirming && (
        <AdjustmentDialog
          title="Prepare & restart audio?"
          onCancel={() => setConfirming(false)}
        >
          <p>
            Audio stops briefly while the playing preset restarts with your Keep
            ready selection loaded beside it.
            {modified &&
              ' Unsaved edits to the playing preset are not kept; save them first to keep them.'}
          </p>
          <ActionRow>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void prepare()}>
              Prepare &amp; restart
            </Button>
          </ActionRow>
        </AdjustmentDialog>
      )}
      <FailureNotice
        failure={failure}
        busy={busy}
        onRefresh={() => {
          clear();
          setReload((n) => n + 1);
        }}
      />
      {notice && <Caption role="status">{notice}</Caption>}
      <LibraryList
        items={rows.map((item) => {
          const id = `${item.kind}:${item.id}`;
          return {
            id,
            title: item.name,
            searchText: presetSearchText(item.name, details[id]),
            favourite: favourites.includes(id),
            added: addedAt[id],
          };
        })}
        query={query}
        onQuery={onQuery}
        searchLabels={{
          input: 'Search presets',
          clear: 'Clear preset search',
          placeholder: 'Find a preset…',
        }}
        layout="list"
        noun={['preset', 'presets']}
        empty={{
          title: loaded
            ? category
              ? 'No presets in this category'
              : 'No presets yet'
            : 'Loading presets…',
        }}
        emptyContent={loaded && !category && !next && empty}
        sortable={loaded}
        sortOptions={['library', 'name', 'added']}
        onSortChange={(sort) => {
          if (sort === 'added') void more(true);
        }}
        primary={primary}
        toolbar={toolbar}
        toolbarEnd={
          <>
            {keepReady}
            {toolbarEnd}
          </>
        }
        aside={aside}
        asideLabel="Preset details"
        onOpen={() => {}}
        onFavourite={favourite}
        renderRow={(item, star, shown) => {
          const row = byId.get(item.id);
          if (!row) return null;
          if (row.kind === 'owned')
            return row.render(setList, star, panel(item.id, shown));
          const p = row.rig;
          const active = playing === p.revision;
          const scenes = p.scenes ?? [];
          const select = panel(item.id, shown);
          return (
            <PresetRow
              key={p.revision}
              name={p.name}
              favourite={star}
              chain={presetChain(p.blocks, lv2Names)}
              meta={[rigTopologyLabel({ ...p, scenes }), scenes.join(', ')]
                .filter(Boolean)
                .join(' · ')}
              badges={rigBadges(p)}
              playing={active}
              loading={loadingId === p.revision}
              disabled={!connected || busy}
              onPlay={() => void play(p.revision)}
              selected={select?.selected}
              hideMenu={!!select}
              onDetails={
                select
                  ? select.onSelect
                  : onDetails
                    ? () => onDetails(p.revision, p.name)
                    : undefined
              }
              actions={rigActions(p)}
              extra={
                choosing && (
                  <label className="inline-flex min-h-touch items-center gap-2 px-2 text-sm [&_input]:size-5">
                    <Checkbox
                      aria-label={`Keep ${p.name} ready`}
                      checked={prepared.includes(p.revision)}
                      disabled={
                        busy ||
                        (!prepared.includes(p.revision) &&
                          prepared.length >= GAPLESS_BANK_SIZE)
                      }
                      onCheckedChange={(checked) =>
                        setPrepared((old) =>
                          checked === true
                            ? [...new Set([...old, p.revision])]
                            : old.filter((id) => id !== p.revision),
                        )
                      }
                    />
                    Keep ready
                  </label>
                )
              }
            />
          );
        }}
      />
      {next && (
        <Button variant="outline" disabled={busy} onClick={() => void more()}>
          Load more
        </Button>
      )}
    </section>
  );
}
