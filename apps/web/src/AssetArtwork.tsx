import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';

import {
  artworkPath,
  type AssetArtwork,
  presetArtwork,
  saveArtwork,
} from './api';
import { GearIcon, GearLabel } from './GearIcon';
import { friendlyError } from './lib/friendlyError';

/** Device-owned images only: no third-party URLs, tracking or network fetches by img. */
type ArtworkProps = {
  id: string;
  owned?: boolean;
  model?: boolean;
  blockId?: string;
  compact?: boolean;
  tile?: boolean;
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
  tile = false,
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
      if (!signal.aborted) setError(friendlyError(cause, 'load the artwork'));
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
  if (tile) {
    const item = shown.find((entry) => entry.key && entry.cached) ?? shown[0];
    return (
      <span
        className="block aspect-[4/3] w-full overflow-hidden bg-muted [&>img]:size-full [&>img]:rounded-none [&>img]:border-0 [&>img]:object-cover [&>span]:size-full [&>span]:place-content-center [&>span]:border-0 [&>span_svg]:size-10"
        aria-hidden="true"
      >
        <ArtworkImage
          key={`${item?.block_id}-${item?.key}-${item?.cached}`}
          src={
            item?.cached && item.key
              ? artworkPath(id, owned, item.key, model)
              : undefined
          }
          title={item?.title ?? 'Model'}
          gear={item?.gear ?? ''}
        />
      </span>
    );
  }
  if (!shown.length) return null;
  const pending = shown.some((item) => item.key && !item.cached);
  const pictured = shown.filter((item) => item.key);
  const missing = shown.filter((item) => !item.key);
  const entry = (item: AssetArtwork) => (
    <figure
      key={item.block_id}
      className="m-0 flex max-w-full min-w-0 items-center gap-2"
    >
      {item.key && (
        <div
          className={
            compact
              ? 'w-9 shrink-0 [[data-chain-view=artwork]_&]:w-16'
              : 'w-14 shrink-0 [[data-chain-view=artwork]_&]:w-16'
          }
          data-artwork-image
        >
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
      <figcaption className="grid min-w-0 text-xs [overflow-wrap:anywhere] [[data-chain-view=artwork]_&]:text-2xs">
        {!compact && <strong>{item.title}</strong>}
        <span className="text-muted-foreground">
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
      className="grid min-w-0 gap-2 [&>button]:max-w-full [&>button]:justify-self-start"
      aria-label="Asset artwork"
      data-artwork-density={compact ? 'compact' : 'gallery'}
    >
      {pictured.length > 0 && (
        <div className="flex flex-wrap gap-2">{pictured.map(entry)}</div>
      )}
      {missing.length > 0 && !compact && (
        <details className="border-y border-border py-1 text-sm [&>p]:mb-3 [&>p]:text-muted-foreground [&>summary]:flex [&>summary]:min-h-touch [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:justify-between [&>summary]:gap-3 [&>summary]:font-medium [&>summary]:after:text-lg [&>summary]:after:text-muted-foreground [&>summary]:after:content-['›'] open:[&>summary]:after:content-['−']">
          <summary>
            {missing.length} {missing.length === 1 ? 'asset' : 'assets'} without
            artwork
          </summary>
          <div className="flex flex-wrap gap-2">{missing.map(entry)}</div>
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
    <span
      className="grid place-items-center gap-1 rounded-md border border-dashed border-border p-1 text-center text-2xs break-words [&>svg]:size-6"
      aria-label={`${title}: image unavailable`}
    >
      <GearIcon gear={gear} />
      <span>
        <GearLabel gear={gear} />
      </span>
    </span>
  );
}
