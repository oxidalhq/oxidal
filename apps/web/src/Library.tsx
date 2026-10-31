import { useEffect, useRef, useState } from 'react';
import { useWorkspaceState } from './workspaceMemory';
import {
  importPreset,
  presetLibrary,
  playbackState,
  nativeState,
  presetDetails,
  type PresetDetails,
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
import { PresetDetailsDialog } from './PresetDetails';
import { detailsKey, detailsMatch } from './presetMetadata';
import { ModelLibrary } from './ModelLibrary';
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
  const [details, setDetails] = useState<Record<string, PresetDetails>>({});
  const [detailsError, setDetailsError] = useState('');
  const [category, setCategory] = useState('');
  const [preview, setPreview] = useState<{
    kind: 'original' | 'owned' | 'rig';
    id: string;
    name: string;
  } | null>(null);
  const matches = (name: string, kind: 'original' | 'owned', id: string) =>
    detailsMatch(name, details[`${kind}:${id}`], query, category);
  const categories = [
    ...new Set(Object.values(details).flatMap((d) => d.categories)),
  ].sort((a, b) => a.localeCompare(b));
  const [page, setPage] = useWorkspaceState<
    'browse' | 'author' | 'new' | 'nam' | 'ir'
  >('library-page', 'browse');
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
    void presetDetails()
      .then((c) => {
        if (active) {
          setDetails(
            Object.fromEntries(
              c.entries.map((e) => [detailsKey(e.entry), e.details]),
            ),
          );
          setDetailsError('');
        }
      })
      .catch(() => {
        if (active) setDetailsError('Preset details could not be read.');
      });
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
    <section className="instrument-surface" aria-label="Library">
      <nav
        className="text-tabs library-section-tabs"
        aria-label="Library sections"
      >
        <Button
          variant="ghost"
          aria-current={page !== 'nam' && page !== 'ir' ? 'page' : undefined}
          onClick={() => setPage('browse')}
        >
          Presets
        </Button>
        <Button
          variant="ghost"
          aria-label="NAM models"
          aria-current={page === 'nam' ? 'page' : undefined}
          onClick={() => setPage('nam')}
        >
          NAM models
        </Button>
        <Button
          variant="ghost"
          aria-current={page === 'ir' ? 'page' : undefined}
          onClick={() => setPage('ir')}
        >
          IRs
        </Button>
      </nav>
      {(page === 'author' || page === 'new') && (
        <Button variant="ghost" onClick={() => setPage('browse')}>
          ← Back to presets
        </Button>
      )}
      {page === 'nam' || page === 'ir' ? (
        <ModelLibrary
          key={page}
          format={page}
          connected={connected}
          onOpenRig={onOpenRig}
        />
      ) : page === 'new' ? (
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
          {categories.length > 0 && (
            <label className="field mb-3">
              Category
              <select
                aria-label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          {detailsError && <p role="status">{detailsError}</p>}
          {preview && (
            <PresetDetailsDialog
              entry={preview}
              editable
              onChanged={() => setRefresh((v) => v + 1)}
              onCancel={() => setPreview(null)}
            />
          )}
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
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="ghost" onClick={() => setPage('author')}>
                Author
              </Button>
              <Button variant="ghost" onClick={() => setPage('new')}>
                New preset
              </Button>
              <Button
                className="library-manage"
                variant="outline"
                aria-expanded={manage}
                onClick={() => setManage((v) => !v)}
              >
                Manage library
              </Button>
            </div>
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
            category={category}
            details={details}
            origin="mine"
            title="Mine · scenes and effects"
            onDetails={(id, name) => setPreview({ kind: 'rig', id, name })}
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
            <h2>Mine · single chain</h2>
          </div>
          {(query.trim() || category) &&
            !busy &&
            !owned.some((p) => matches(p.name, 'owned', p.id)) && (
              <p role="status" className="caption">
                No Mine single-chain presets match these filters.
              </p>
            )}
          <ul className="preset-library">
            {owned
              .filter((p) => matches(p.name, 'owned', p.id))
              .map((p) => (
                <li key={`owned-${p.id}`} className="library-row">
                  {loadButton(p.id, p.name, true)}
                  <Button
                    variant="ghost"
                    className="library-details"
                    aria-label={`Details: ${p.name}`}
                    onClick={() =>
                      setPreview({ kind: 'owned', id: p.id, name: p.name })
                    }
                  >
                    Details
                  </Button>
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
          </ul>
          <SavedRigs
            connected={connected}
            onOpenRig={onOpenRig}
            refresh={refresh}
            query={query}
            category={category}
            details={details}
            origin="oxidal_example"
            title="Oxidal examples"
            onDetails={(id, name) => setPreview({ kind: 'rig', id, name })}
          />
          <div className="section-heading">
            <h2>TONE3000</h2>
          </div>
          {(query.trim() || category) &&
            !busy &&
            !presets.some((p) => matches(p.name, 'original', p.sha256)) && (
              <p role="status" className="caption">
                No TONE3000 presets match these filters.
              </p>
            )}
          <ul className="preset-library">
            {presets
              .filter((p) => matches(p.name, 'original', p.sha256))
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
                  <Button
                    variant="ghost"
                    className="library-details"
                    aria-label={`Details: ${preset.name}`}
                    onClick={() =>
                      setPreview({
                        kind: 'original',
                        id: preset.sha256,
                        name: preset.name,
                      })
                    }
                  >
                    Details
                  </Button>
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
