import { useEffect, useRef, useState } from 'react';
import { Button } from './components/ui/button';
import { PresetRow } from './features/library/PresetRow';
import { Checkbox } from './components/ui/checkbox';
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
  readKeepReady,
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
  origin = 'mine',
  title = 'Mine',
}: {
  refresh?: number;
  query?: string;
  category?: string;
  details?: Record<string, PresetDetails>;
  onDetails?: (id: string, name: string) => void;
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
  const [error, setError] = useState('');
  const [prepared, setPrepared] = useState<string[]>(readKeepReady);
  const [choosing, setChoosing] = useState(false);
  useEffect(() => writeKeepReady(prepared), [prepared]);
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
        if (alive.current) setError(String(cause));
      });
    void rigAudioState()
      .then((rig) => {
        if (alive.current && rig.phase === 'running')
          setPlaying(rig.configured?.revision ?? null);
      })
      .catch(() => {});
    return () => {
      alive.current = false;
    };
  }, [refresh]);
  async function play(revision: string, openMidi = false) {
    setBusy(true);
    setLoadingId(revision);
    setError('');
    try {
      await playScenes(
        revision,
        gaplessBank(
          revision,
          shown.map((item) => item.revision),
        ),
      );
      if (alive.current) {
        // Starting may have added it to the ready set.
        setPrepared(readKeepReady());
        if (openMidi) requestMidiAssignments();
        onOpenRig();
      }
    } catch (cause) {
      if (alive.current) setError(String(cause));
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
    setError('');
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
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const originItems = items.filter((item) => item.origin === origin);
  const shown = originItems.filter((item) =>
    detailsMatch(item.name, details[`rig:${item.revision}`], query, category),
  );
  if (!originItems.length && !error) return null;
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
      {choosing && (
        <p className="caption">
          Choose up to {GAPLESS_BANK_SIZE} additional rigs to keep ready. They
          stay loaded, so switching between them has no gap. Without custom
          choices, each adjacent group of {GAPLESS_BANK_SIZE} loads together.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <ul className="preset-library">
        {shown.map((p) => {
          const active = playing === p.revision;
          const scenes = p.scenes ?? [];
          return (
            <PresetRow
              key={p.revision}
              name={p.name}
              meta={[rigTopologyLabel({ ...p, scenes }), scenes.join(', ')]
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
                    Ready
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
            : 'No saved rigs match these filters.'}
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
