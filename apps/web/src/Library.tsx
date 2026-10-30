import { useEffect, useRef, useState } from 'react';
import { useWorkspaceState } from './workspaceMemory';
import {
  importPreset,
  presetLibrary,
  playbackState,
  nativeState,
  type AudioState,
  type Preset,
} from './api';
import { CircleNotch, MagnifyingGlass, X } from '@phosphor-icons/react';
import { LibraryManagement } from './LibraryManagement';
import { ArtworkDeck } from './AssetArtwork';
import { NativeEditor } from './NativeEditor';
import { GraphAuthor } from './GraphAuthor';
import { SavedRigs } from './SavedRigs';
import { EvenOut } from './EvenOut';
import { playTone3000 } from './presetChoices';
import { Button } from './components/ui/button';
import './Library.css';

/** Immutable native originals; playback has its own explicitly started session.
 * @see docs/presets/format.md
 */
export function Library({
  connected,
  onOpenRig,
}: {
  connected: boolean;
  onOpenRig: () => void;
}) {
  const [refresh, setRefresh] = useState(0);
  const [manage, setManage] = useState(false);
  const [query, setQuery] = useWorkspaceState('library-query', '');
  const [showArtwork, setShowArtwork] = useState(() => {
    try {
      return localStorage.getItem('oxidal-library-artwork') === 'true';
    } catch {
      return false;
    }
  });
  const matches = (name: string) =>
    name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const [page, setPage] = useWorkspaceState<'browse' | 'author' | 'new'>(
    'library-page',
    'browse',
  );
  const [presets, setPresets] = useState<Preset[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('Loading library…');
  const [error, setError] = useState('');
  const [copiesError, setCopiesError] = useState('');
  const generation = useRef(0);
  const loading = useRef(false);
  const [playing, setPlaying] = useState<AudioState | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [owned, setOwned] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let active = true;
    void playbackState()
      .then((s) => {
        if (active) setPlaying(s);
      })
      .catch(() => {});
    void nativeState()
      .then((s) => {
        if (active) {
          setOwned(s.owned.map((p) => ({ id: p.id, name: p.preset.name })));
          setCopiesError('');
        }
      })
      .catch(() => {
        if (active) setCopiesError('Saved copies could not be read.');
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  async function play(id: string, isOwned = false) {
    if (loading.current) return;
    loading.current = true;
    setLoadingId(id);
    setError('');
    try {
      const next = await playTone3000(id, isOwned);
      setPlaying(next);
      onOpenRig();
    } catch (cause) {
      setError(String(cause));
      void playbackState()
        .then(setPlaying)
        .catch(() => {});
    } finally {
      loading.current = false;
      setLoadingId(null);
    }
  }
  function loadButton(id: string, name: string, isOwned = false, detail = '') {
    const active =
      playing?.phase === 'running' &&
      playing.configured?.preset_id === id &&
      playing.configured.owned === isOwned;
    return (
      <button
        type="button"
        className="library-load"
        disabled={!connected || loadingId !== null}
        onClick={() => void play(id, isOwned)}
        aria-label={`Load ${name}`}
        aria-pressed={active}
      >
        <span className="library-name">{name}</span>
        <span className="library-meta">
          {loadingId === id ? (
            <>
              <CircleNotch aria-hidden="true" /> Loading…
            </>
          ) : (
            <>
              {active && <span className="library-playing">Playing</span>}
              {[isOwned ? 'My copy' : 'Original', detail]
                .filter(Boolean)
                .join(' · ')}
            </>
          )}
        </span>
      </button>
    );
  }
  useEffect(() => {
    const lifecycle = generation;
    const request = ++lifecycle.current;
    void presetLibrary()
      .then((items) => {
        if (request !== lifecycle.current) return;
        setPresets(items);
        setMessage('');
      })
      .catch((cause: unknown) => {
        if (request === lifecycle.current) {
          setError(String(cause));
          setMessage('');
        }
      })
      .finally(() => {
        if (request === lifecycle.current) setBusy(false);
      });
    return () => {
      lifecycle.current++;
    };
  }, [refresh]);
  async function upload() {
    if (!file) return;
    const request = ++generation.current;
    setBusy(true);
    setError('');
    setMessage('Importing…');
    try {
      const imported = await importPreset(file);
      const items = await presetLibrary();
      if (request !== generation.current) return;
      setPresets(items);
      setMessage(`Stored ${imported.name}. Original preserved.`);
    } catch (cause) {
      if (request === generation.current) {
        setError(String(cause));
        setMessage('');
      }
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  return (
    <section className="instrument-surface" aria-label="Preset library">
      <nav className="text-tabs" aria-label="Library sections">
        <Button
          variant="ghost"
          aria-current={page === 'browse' ? 'page' : undefined}
          onClick={() => setPage('browse')}
        >
          Browse
        </Button>
        <Button
          variant="ghost"
          aria-current={page === 'author' ? 'page' : undefined}
          onClick={() => setPage('author')}
        >
          Author
        </Button>
        <Button
          variant="ghost"
          aria-current={page === 'new' ? 'page' : undefined}
          onClick={() => setPage('new')}
        >
          New preset
        </Button>
      </nav>
      {page === 'new' ? (
        <GraphAuthor connected={connected} onOpenRig={onOpenRig} />
      ) : page === 'browse' ? (
        <>
          <div className="my-3 flex min-w-0 items-center gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search presets</span>
              <MagnifyingGlass
                aria-hidden="true"
                size={18}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                className="h-11 w-full min-w-0 rounded-md border border-input bg-card pr-3 pl-10"
                placeholder="Find a preset…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {query && (
              <Button
                variant="ghost"
                className="w-11 px-0"
                aria-label="Clear preset search"
                onClick={() => setQuery('')}
              >
                <X aria-hidden="true" />
              </Button>
            )}
          </div>
          <div className="library-bar">
            <div
              className="library-toolbar"
              role="group"
              aria-label="Library view"
            >
              <Button
                variant="ghost"
                aria-pressed={!showArtwork}
                onClick={() => {
                  setShowArtwork(false);
                  try {
                    localStorage.setItem('oxidal-library-artwork', 'false');
                  } catch {
                    /* storage unavailable */
                  }
                }}
              >
                List
              </Button>
              <Button
                variant="ghost"
                aria-pressed={showArtwork}
                onClick={() => {
                  setShowArtwork(true);
                  try {
                    localStorage.setItem('oxidal-library-artwork', 'true');
                  } catch {
                    /* storage unavailable */
                  }
                }}
              >
                Artwork
              </Button>
            </div>
            <Button
              className="library-manage"
              variant="outline"
              aria-expanded={manage}
              onClick={() => setManage((v) => !v)}
            >
              Manage library
            </Button>
          </div>
          {manage && (
            <LibraryManagement
              connected={connected}
              onChanged={() => setRefresh((v) => v + 1)}
            />
          )}
          <EvenOut connected={connected} />
          <p className="caption">
            Tap a preset to play it with your current audio setup. Changing
            preset briefly interrupts audio; scenes switch without a gap on Rig.
            Edits are kept when you return.
          </p>
          <SavedRigs
            connected={connected}
            onOpenRig={onOpenRig}
            refresh={refresh}
            query={query}
          />
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {copiesError && (
            <div className="space-y-2">
              <p role="status">{copiesError}</p>
              <Button
                variant="outline"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Retry saved copies
              </Button>
            </div>
          )}
          <p role="status">{message}</p>
          {!busy && presets.length === 0 && <p>No stored presets yet.</p>}
          <div className="section-heading">
            <h2>Single chain</h2>
          </div>
          {query.trim() &&
            !busy &&
            !owned.some((p) => matches(p.name)) &&
            !presets.some((p) => matches(p.name)) && (
              <p role="status" className="caption">
                No single-chain presets match this name.
              </p>
            )}
          <ul className="preset-library">
            {owned
              .filter((p) => matches(p.name))
              .map((p) => (
                <li key={`owned-${p.id}`} className="library-row">
                  {loadButton(p.id, p.name, true)}
                  {showArtwork && <ArtworkDeck id={p.id} owned />}
                  <a
                    href={`/api/v1/presets/owned/${p.id}/download`}
                    download
                    aria-label={`Download saved copy ${p.name}`}
                  >
                    Download
                  </a>
                </li>
              ))}
            {presets
              .filter((p) => matches(p.name))
              .map((preset) => (
                <li
                  key={preset.sha256}
                  className="library-row"
                  data-testid={`preset-${preset.sha256}`}
                >
                  {loadButton(
                    preset.sha256,
                    preset.name,
                    false,
                    `${preset.block_count} blocks${preset.framing === 'legacy' ? ' · legacy format' : ''}`,
                  )}
                  {showArtwork && <ArtworkDeck id={preset.sha256} />}
                  <a
                    href={`/api/v1/presets/${preset.sha256}/original`}
                    download
                    aria-label={`Download original ${preset.name}`}
                  >
                    Download
                  </a>
                </li>
              ))}
          </ul>
          <details className="library-import">
            <summary>Import preset</summary>
            <p>
              Keep your TONE3000 originals here. Importing does not change the
              current rig. Originals are kept unchanged.
            </p>
            <div className="form-grid">
              <label className="field">
                TONE3000 preset file
                <input
                  type="file"
                  accept=".t3kpreset"
                  disabled={busy || !connected}
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </label>
              <Button
                disabled={!file || busy || !connected}
                onClick={() => void upload()}
              >
                Import original
              </Button>
            </div>
            <p className="caption">
              Up to 32 MiB per file. Original bytes are preserved; importing the
              same file twice keeps one copy.
            </p>
          </details>
        </>
      ) : (
        <NativeEditor presets={presets} connected={connected} />
      )}
    </section>
  );
}
