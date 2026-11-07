import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { PresetRow } from './features/library/PresetRow';
import { FailureNotice } from './components/ui/failure';
import { useFailure } from './lib/useFailure';
import { Checkbox } from './components/ui/checkbox';
import { AdjustmentDialog } from './AdjustmentDialog';
import { detailsMatch } from './presetMetadata';
import {
  rigLibrary,
  rigAudioState,
  type RigPage,
  type PresetDetails,
} from './api';
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
import { requestMidiAssignments } from './midiNavigation';

/**
 * Portable rigs in the Library: rows look and play like every other
 * preset; one tap stops whatever is playing and opens the Rig page.
 * Keep ready loads chosen presets in the background for gapless switching.
 * @see docs/audio.md
 */
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
  const [prepared, setPreparedState] = useState<string[]>([]);
  const [choosing, setChoosing] = useState(false);
  /** Worker-confirmed loaded revisions; empty when audio is not running. */
  const [ready, setReady] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [modified, setModified] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
        }
      })
      .catch((cause: unknown) => {
        if (alive.current) fail(cause, 'read your presets');
      });
    void readKeepReady()
      .then((saved) => alive.current && setPreparedState(saved))
      .catch(() => {});
    void readRig();
    return () => {
      alive.current = false;
    };
  }, [refresh, reload, fail]);
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
  if (!originItems.length && !failure) return null;
  const readyCount = shown.filter((p) => ready.includes(p.revision)).length;
  // Selected but not loaded beside the playing preset: needs a restart.
  const pending = prepared.some((id) => id !== playing && !ready.includes(id));
  return (
    <section className="library-scenes" aria-label="Saved rigs">
      <div className="section-heading">
        <h2>{title}</h2>
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
      <ul className="preset-library">
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
                        label: 'Edit without playing…',
                        onSelect: () => onEdit(p.revision, p.name),
                        disabled: busy,
                      },
                    ]
                  : []),
                {
                  label: 'MIDI assignments…',
                  onSelect: () => void play(p.revision, true),
                  disabled: !connected || busy,
                },
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
                      onChange={(event) =>
                        setPrepared((old) =>
                          event.target.checked
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
      </ul>
      {(query.trim() || category) && !shown.length && (
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
