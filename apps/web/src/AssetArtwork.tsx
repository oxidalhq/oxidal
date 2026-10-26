import { useEffect, useRef, useState } from 'react';
import {
  artworkPath,
  presetArtwork,
  saveArtwork,
  type AssetArtwork,
} from './api';
import { Button } from './components/ui/button';

/** Device-owned images only: no third-party URLs, tracking or network fetches by img. */
export function ArtworkDeck({
  id,
  owned = false,
  blockId,
  compact = false,
}: {
  id: string;
  owned?: boolean;
  blockId?: string;
  compact?: boolean;
}) {
  const [items, setItems] = useState<AssetArtwork[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    void presetArtwork(id, owned, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setItems(result);
      })
      .catch(() => {
        // Optional artwork never replaces editor or audio errors.
      });
    return () => controller.abort();
  }, [id, owned]);
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
        await saveArtwork(id, owned, item.key!, signal);
    } catch (cause) {
      if (!signal.aborted)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (!signal.aborted) {
        try {
          setItems(await presetArtwork(id, owned, signal));
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
  return (
    <div
      className="space-y-2"
      aria-label="Asset artwork"
      data-artwork-density={compact ? 'compact' : 'gallery'}
    >
      <div className="flex flex-wrap gap-2">
        {shown.map((item) => (
          <figure
            key={item.block_id}
            className={
              compact
                ? 'flex min-w-0 items-center gap-2 py-1'
                : 'max-w-36 min-w-0 flex-1 basis-24'
            }
          >
            <div
              className={compact ? 'w-10 shrink-0' : undefined}
              data-artwork-image
            >
              <ArtworkImage
                key={`${item.block_id}-${item.key}-${item.cached}`}
                src={
                  item.cached && item.key
                    ? artworkPath(id, owned, item.key)
                    : undefined
                }
                title={item.title}
                gear={item.gear}
              />
            </div>
            <figcaption className="mt-1 text-xs wrap-anywhere">
              {!compact && (
                <>
                  <strong>{item.title}</strong>
                  <br />
                </>
              )}
              {item.gear}
              <span className="flex">
                {item.cached
                  ? 'Saved offline'
                  : item.key
                    ? 'Image not saved'
                    : 'No image supplied'}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
      {pending && !compact && (
        <Button
          variant="outline"
          className="h-auto min-h-11 w-full whitespace-normal"
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
      className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-current/50 p-2 text-center text-xs"
      aria-label={`${title}: image unavailable`}
    >
      {gear}
    </div>
  );
}
