import { type ReactNode, useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Checkbox } from '@oxidal/design-system/components/checkbox';

import { AdjustmentDialog } from './AdjustmentDialog';
import {
  libraryCatalog,
  type PresetDetails,
  rigAudioState,
  rigLibrary,
  type RigPage,
} from './api';
import { FailureNotice } from './FailureNotice';
import { PresetRow } from './features/library/PresetRow';
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
import { detailsMatch } from './presetMetadata';

/**
 * Portable rigs in the Library: rows look and play like every other
 * preset; one tap stops whatever is playing and opens the Rig page.
 * Keep ready loads chosen presets in the background for gapless switching.
 * @see docs/audio.md
 */
/** What a Mine row shows about the set list; nothing until it is known. */
function setListLabel(
  members: Map<string, number> | null,
  kind: 'rig' | 'owned',
  id: string,
  shown: boolean,
): string {
  if (!shown || !members) return '';
  const position = members.get(`${kind}:${id}`);
  return position ? `In set list #${position}` : 'Not in set list';
}

/** Set list state and actions SavedRigs hands to rows it does not own. */
export type SetListControls = {
  label: (id: string) => string;
  /** Null until the catalog has been read. */
  isMember: (id: string) => boolean | null;
  toggle: (id: string, name: string, add: boolean) => void;
  disabled: boolean;
};

function TailRows({
  tail,
  setList,
}: {
  tail: (setList: SetListControls) => ReactNode;
  setList: SetListControls;
}) {
  return <>{tail(setList)}</>;
}

export function SavedRigs({
  connected,
  onOpenRig,
  refresh = 0,
  query = '',
  category = '',
  details = {},
  onDetails,
  onEdit,
  origin = 'mine',
  title = 'Mine',
  tail,
  tailCount = 0,
  empty,
  onManage,
}: {
  refresh?: number;
  query?: string;
  category?: string;
  details?: Record<string, PresetDetails>;
  onDetails?: (id: string, name: string) => void;
  /** Edit without playing (7.3). */
  onEdit?: (revision: string, name: string) => void;
  origin?: RigPage['presets'][number]['origin'];
  title?: string;
  /** More rows for the same list (owned TONE3000 chains in Mine). */
  tail?: (setList: SetListControls) => ReactNode;
  tailCount?: number;
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
  const [items, setItems] = useState<RigPage['presets']>([]);
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
  function readMembers() {
    return libraryCatalog()
      .then((catalog) => {
        if (alive.current)
          setMembers(
            new Map(
              catalog.items
                .filter((i) => i.in_set_list)
                .map((i, index) => [`${i.kind}:${i.id}`, index + 1]),
            ),
          );
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
    if (origin === 'mine') void readMembers();
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
          shown.map((item) => item.revision),
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
  async function more() {
    if (!next) return;
    setBusy(true);
    clear();
    try {
      const page = await rigLibrary(next);
      if (alive.current) {
        setItems((old) => [
          ...old,
          ...page.presets.filter(
            (p) => !old.some((o) => o.revision === p.revision),
          ),
        ]);
        setNext(page.next ?? null);
      }
    } catch (cause) {
      if (alive.current) fail(cause, 'load more presets', () => void more());
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const originItems = items.filter((item) => item.origin === origin);
  const shown = originItems.filter((item) =>
    detailsMatch(item.name, details[`rig:${item.revision}`], query, category),
  );
  if (!originItems.length && !tailCount && !failure)
    return loaded && empty ? <>{empty}</> : null;
  const readyCount = shown.filter((p) => ready.includes(p.revision)).length;
  // Selected but not loaded beside the playing preset: needs a restart.
  const pending = prepared.some((id) => id !== playing && !ready.includes(id));
  return (
    <section className="library-scenes" aria-label="Saved rigs">
      <div className="section-heading">
        {title && <h2>{title}</h2>}
        <Button
          variant="ghost"
          aria-pressed={choosing}
          disabled={busy}
          onClick={() => setChoosing((v) => !v)}
        >
          Keep ready{prepared.length ? ` · ${prepared.length}` : ''}
        </Button>
      </div>
      <p className="caption" role="status">
        {running
          ? `${readyCount} of ${shown.length}${next ? '+' : ''} presets ready`
          : 'Nothing is ready while audio is stopped.'}
      </p>
      {choosing && running && pending && (
        <div className="action-row">
          <span className="caption">
            Selected presets load when audio restarts.
          </span>
          <Button
            variant="outline"
            disabled={busy || !connected}
            onClick={() => setConfirming(true)}
          >
            Prepare &amp; restart audio…
          </Button>
        </div>
      )}
      {choosing && !running && !!prepared.length && (
        <p className="caption">
          Your selection is prepared the next time a preset plays.
        </p>
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
          <div className="action-row">
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void prepare()}>
              Prepare &amp; restart
            </Button>
          </div>
        </AdjustmentDialog>
      )}
      {choosing && (
        <p className="caption">
          Choose up to {GAPLESS_BANK_SIZE} more presets to keep ready. They stay
          loaded, so switching between them has no gap. Without custom choices,
          each adjacent group of {GAPLESS_BANK_SIZE} loads together.
        </p>
      )}
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
      <ul className="m-0 grid list-none gap-2 p-0">
        {shown.map((p) => {
          const active = playing === p.revision;
          const scenes = p.scenes ?? [];
          return (
            <PresetRow
              key={p.revision}
              name={p.name}
              meta={[
                rigTopologyLabel({ ...p, scenes }),
                scenes.join(', '),
                setListLabel(members, 'rig', p.revision, origin === 'mine'),
                ready.includes(p.revision)
                  ? 'Ready'
                  : prepared.includes(p.revision)
                    ? 'Selected · not ready yet'
                    : '',
              ]
                .filter(Boolean)
                .join(' · ')}
              playing={active}
              loading={loadingId === p.revision}
              disabled={!connected || busy}
              onPlay={() => void play(p.revision)}
              onDetails={
                onDetails ? () => onDetails(p.revision, p.name) : undefined
              }
              actions={[
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
                            onSelect: () =>
                              void member(p.revision, p.name, false),
                            disabled: !connected || busy,
                          }
                        : {
                            label: 'Add to set list',
                            onSelect: () =>
                              void member(p.revision, p.name, true),
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
              ]}
              extra={
                choosing && (
                  <label className="library-ready">
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
        })}
        {tail && (
          <TailRows
            tail={tail}
            setList={{
              label: (id) => setListLabel(members, 'owned', id, true),
              isMember: (id) => members?.has(`owned:${id}`) ?? null,
              toggle: (id, name, add) => void member(id, name, add, 'owned'),
              disabled: !connected || busy,
            }}
          />
        )}
      </ul>
      {(query.trim() || category) && !shown.length && !tailCount && (
        <p role="status" className="caption">
          {next
            ? 'No matches yet. Load more to search further.'
            : 'No saved presets match these filters.'}
        </p>
      )}
      {next && (
        <Button variant="outline" disabled={busy} onClick={() => void more()}>
          Load more
        </Button>
      )}
    </section>
  );
}
