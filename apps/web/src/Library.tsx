import { useEffect, useRef, useState } from 'react';
import { importPreset, presetLibrary, type Preset } from './api';
import { ArtworkDeck } from './AssetArtwork';
import { NativeEditor } from './NativeEditor';
import { GraphAuthor } from './GraphAuthor';
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
  const [page, setPage] = useState<'browse' | 'author' | 'new'>('browse');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('Loading library…');
  const [error, setError] = useState('');
  const generation = useRef(0);
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
  }, []);
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
          <h2 className="sr-only">Native preset library</h2>
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
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p role="status">{message}</p>
          {!busy && presets.length === 0 && <p>No stored presets yet.</p>}
          <ul className="preset-library">
            {presets.map((preset) => (
              <li key={preset.sha256} data-testid={`preset-${preset.sha256}`}>
                <h3>{preset.name}</h3>
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
                  Download original
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
