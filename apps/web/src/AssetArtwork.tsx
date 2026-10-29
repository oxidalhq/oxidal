import { GearIcon, GearLabel } from './GearIcon';
import { useEffect, useRef, useState } from 'react';
import {
  artworkPath,
  presetArtwork,
  saveArtwork,
  type AssetArtwork,
} from './api';
import { Button } from './components/ui/button';

/** Device-owned images only: no third-party URLs, tracking or network fetches by img. */
type ArtworkProps = {
  id: string;
  owned?: boolean;
  model?: boolean;
  blockId?: string;
  compact?: boolean;
};
export function ArtworkDeck(props: ArtworkProps) {
  // Changing the source must immediately discard old metadata, errors and pending UI.
  return (
    <ArtworkContent
      key={`${props.model}:${props.owned}:${props.id}`}
      {...props}
    />
  );
}
function ArtworkContent({
  id,
  owned = false,
  model = false,
  blockId,
  compact = false,
}: ArtworkProps) {
  const [items, setItems] = useState<AssetArtwork[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void presetArtwork(id, owned, controller.signal, model)
      .then((result) => {
        if (!controller.signal.aborted) setItems(result);
      })
      .catch(() => {
        // Optional artwork never replaces editor or audio errors.
      });
    return () => controller.abort();
  }, [id, owned, model]);
  async function save() {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || busy) return;
    setBusy(true);
    setError('');
    try {
      const pending = items.filter(
        (item) =>
          item.key && !item.cached && (!blockId || item.block_id === blockId),
      );
      // One request at a time; stop on failure and retain successfully cached images.
      for (const item of pending)
        await saveArtwork(id, owned, item.key!, signal, model);
    } catch (cause) {
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) {
        try {
          setItems(await presetArtwork(id, owned, signal, model));
        } catch {
          /* Keep metadata. */
        }
        if (!signal.aborted) setBusy(false);
      }
    }
  }
  const shown = items.filter((item) => !blockId || item.block_id === blockId);
  if (!shown.length) return null;
  const pending = shown.some((item) => item.key && !item.cached);
  const pictured = shown.filter((item) => item.key);
  const missing = shown.filter((item) => !item.key);
  const entry = (item: AssetArtwork) => (
    <figure key={item.block_id} className="artwork-entry">
      {item.key && (
        <div className="artwork-thumb" data-artwork-image>
          <ArtworkImage
            key={`${item.block_id}-${item.key}-${item.cached}`}
            src={
              item.cached ? artworkPath(id, owned, item.key, model) : undefined
            }
            title={item.title}
            gear={item.gear}
          />
        </div>
      )}
      <figcaption>
        <strong>{item.title}</strong>
        <span>
          <GearLabel gear={item.gear} /> ·{' '}
          {item.cached
            ? 'Saved offline'
            : item.key
              ? 'Image not saved'
              : 'No image supplied'}
        </span>
      </figcaption>
    </figure>
  );
  return (
    <div
      className="artwork-deck"
      aria-label="Asset artwork"
      data-artwork-density={compact ? 'compact' : 'gallery'}
    >
      {pictured.length > 0 && (
        <div className="artwork-list">{pictured.map(entry)}</div>
      )}
      {missing.length > 0 && !compact && (
        <details className="control-help">
          <summary>
            {missing.length} {missing.length === 1 ? 'asset' : 'assets'} without
            artwork
          </summary>
          <div className="artwork-list">{missing.map(entry)}</div>
        </details>
      )}

      {pending && !compact && (
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? 'Saving artwork…' : 'Save artwork offline'}
        </Button>
      )}
      {error && (
        <p role="status" className="text-xs wrap-anywhere">
          {error}. Audio is unaffected; retry when connected to the internet.
        </p>
      )}
    </div>
  );
}
function ArtworkImage({
  src,
  title,
  gear,
}: {
  src?: string;
  title: string;
  gear: string;
}) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img
      src={src}
      alt={`${title} · ${gear}`}
      loading="lazy"
      decoding="async"
      width={96}
      height={96}
      className="aspect-square w-full rounded-md border border-current/25 object-contain"
      onError={() => setFailed(true)}
    />
  ) : (
    <div
      className="artwork-placeholder"
      aria-label={`${title}: image unavailable`}
    >
      <GearIcon gear={gear} />
      <span>
        <GearLabel gear={gear} />
      </span>
    </div>
  );
}
