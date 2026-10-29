import { useEffect, useRef, useState } from 'react';
import {
  importPreset,
  presetLibrary,
  playbackState,
  playbackCommand,
  nativeState,
  type AudioState,
  type Preset,
} from './api';
import {
  Play,
  SpeakerHigh,
  CircleNotch,
  DownloadSimple,
} from '@phosphor-icons/react';
import { LibraryManagement } from './LibraryManagement';
import { ArtworkDeck } from './AssetArtwork';
import { NativeEditor } from './NativeEditor';
import { GraphAuthor } from './GraphAuthor';
import { SavedRigs } from './SavedRigs';
import { Button } from './components/ui/button';

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
  const [page, setPage] = useState<'browse' | 'author' | 'new'>('browse');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('Loading library…');
  const [error, setError] = useState('');
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
        if (active)
          setOwned(s.owned.map((p) => ({ id: p.id, name: p.preset.name })));
      })
      .catch(() => {});
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
      const current = await playbackState();
      const next = await playbackCommand(current, {
        kind: 'load_preset',
        preset_id: id,
        owned: isOwned,
      });
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
  function loadButton(id: string, name: string, isOwned = false) {
    const active =
      playing?.phase === 'running' &&
      playing.configured?.preset_id === id &&
      playing.configured.owned === isOwned;
    return (
      <Button
        className="preset-load"
        variant={active ? 'secondary' : 'outline'}
        disabled={!connected || loadingId !== null}
        onClick={() => void play(id, isOwned)}
        aria-label={`Load ${name}`}
        aria-pressed={active}
      >
        {loadingId === id ? (
          <CircleNotch aria-hidden="true" />
        ) : active ? (
          <SpeakerHigh weight="fill" aria-hidden="true" />
        ) : (
          <Play weight="fill" aria-hidden="true" />
        )}
        <span>{name}</span>
        <small>
          {loadingId === id ? 'Loading…' : active ? 'Playing' : 'Load rig'}
        </small>
      </Button>
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
    <section className="panel" aria-label="Preset library">
      <nav className="settings-nav" aria-label="Library sections">
        <Button
          variant={page === 'browse' ? 'secondary' : 'ghost'}
          aria-current={page === 'browse' ? 'page' : undefined}
          onClick={() => setPage('browse')}
        >
          Browse
        </Button>
        <Button
          variant={page === 'author' ? 'secondary' : 'ghost'}
          aria-current={page === 'author' ? 'page' : undefined}
          onClick={() => setPage('author')}
        >
          Author
        </Button>
        <Button
          variant={page === 'new' ? 'secondary' : 'ghost'}
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
          <Button
            variant={manage ? 'secondary' : 'outline'}
            aria-expanded={manage}
            onClick={() => setManage((v) => !v)}
          >
            Manage library
          </Button>
          {manage && (
            <LibraryManagement
              connected={connected}
              onChanged={() => setRefresh((v) => v + 1)}
            />
          )}
          <SavedRigs
            connected={connected}
            onOpenRig={onOpenRig}
            refresh={refresh}
          />
          <h2 className="sr-only">Native preset library</h2>
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
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p role="status">{message}</p>
          {!busy && presets.length === 0 && <p>No stored presets yet.</p>}
          <p className="caption">
            Tap a rig to play. Your current audio setup is reused; edits are
            kept when you return.
          </p>
          <ul className="preset-library">
            {owned.map((p) => (
              <li key={`owned-${p.id}`}>
                {loadButton(p.id, p.name, true)}
                <ArtworkDeck id={p.id} owned />
                <a
                  href={`/api/v1/presets/owned/${p.id}/download`}
                  download
                  aria-label={`Download saved copy ${p.name}`}
                >
                  <DownloadSimple aria-hidden="true" /> Download saved copy
                </a>
              </li>
            ))}
            {presets.map((preset) => (
              <li key={preset.sha256} data-testid={`preset-${preset.sha256}`}>
                {loadButton(preset.sha256, preset.name)}
                <ArtworkDeck id={preset.sha256} />
                <details>
                  <summary>File details</summary>
                  <p>
                    {preset.framing === 'legacy'
                      ? 'Legacy format'
                      : 'Current format'}{' '}
                    · {preset.parameter_count} parameters · {preset.block_count}{' '}
                    chain entries
                  </p>
                </details>
                <a
                  href={`/api/v1/presets/${preset.sha256}/original`}
                  download
                  aria-label={`Download original ${preset.name}`}
                >
                  <DownloadSimple aria-hidden="true" /> Download original
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <NativeEditor presets={presets} connected={connected} />
      )}
    </section>
  );
}
