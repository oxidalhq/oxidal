import { useEffect, useRef, useState } from 'react';
import { CircleNotch } from '@phosphor-icons/react';
import { Button } from './components/ui/button';
import { detailsMatch } from './presetMetadata';
import {
  rigLibrary,
  rigAudioState,
  type RigPage,
  type PresetDetails,
} from './api';
import {
  playScenes,
  readKeepReady,
  scenesLabel,
  writeKeepReady,
} from './presetChoices';

/**
 * Presets with scenes in the Library: rows look and play like every other
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
}: {
  refresh?: number;
  query?: string;
  category?: string;
  details?: Record<string, PresetDetails>;
  onDetails?: (id: string, name: string) => void;
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
  async function play(revision: string) {
    setBusy(true);
    setLoadingId(revision);
    setError('');
    try {
      await playScenes(revision);
      if (alive.current) {
        // Starting may have added it to the ready set.
        setPrepared(readKeepReady());
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
  const shown = items.filter((item) =>
    detailsMatch(item.name, details[`rig:${item.revision}`], query, category),
  );
  if (!items.length && !error) return null;
  return (
    <section className="library-scenes" aria-label="Presets with scenes">
      <div className="section-heading">
        <h2>Scenes and effects</h2>
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
          Ready presets stay loaded while audio runs, so switching between them
          has no gap. Each one uses extra processing and memory.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <ul className="preset-library">
        {shown.map((p) => {
          const active = playing === p.revision;
          const scenes = p.scenes ?? [];
          return (
            <li key={p.revision} className="library-row">
              <button
                type="button"
                className="library-load"
                disabled={!connected || busy}
                onClick={() => void play(p.revision)}
                aria-label={`Load ${p.name}`}
                aria-pressed={active}
              >
                <span className="library-name">{p.name}</span>
                <span className="library-meta">
                  {loadingId === p.revision ? (
                    <>
                      <CircleNotch aria-hidden="true" /> Loading…
                    </>
                  ) : (
                    <>
                      {active && (
                        <span className="library-playing">Playing</span>
                      )}
                      {[scenesLabel(scenes), scenes.join(', ')]
                        .filter(Boolean)
                        .join(': ') || 'With effects'}
                    </>
                  )}
                </span>
              </button>
              {onDetails && (
                <Button
                  variant="ghost"
                  className="library-details"
                  aria-label={`Details: ${p.name}`}
                  onClick={() => onDetails(p.revision, p.name)}
                >
                  Details
                </Button>
              )}
              {choosing && (
                <label className="library-ready">
                  <input
                    type="checkbox"
                    aria-label={`Keep ${p.name} ready`}
                    checked={prepared.includes(p.revision)}
                    disabled={busy}
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
              )}
            </li>
          );
        })}
      </ul>
      {(query.trim() || category) && !shown.length && (
        <p role="status" className="caption">
          {next
            ? 'No matches yet. Load more to search further.'
            : 'No presets with scenes match these filters.'}
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
