/**
 * A TONE3000 preset file's own facts and pictures, for its details.
 * @see docs/interface.md
 */
import { useEffect, useRef, useState } from 'react';

import { type AssetArtwork, presetArtwork, saveArtwork } from '../../api';
import { friendlyError } from '../../lib/friendlyError';

/** What the preset file says about itself, from the device's preset list. */
export type PresetFileFacts = {
  blocks: number;
  /** Bytes of model data inside the file. */
  modelBytes: number;
};

/** "TONE3000 original · 10 blocks · 3 captures", for the details header. */
export function presetFileSummary(
  owned: boolean,
  facts: PresetFileFacts | undefined,
  captures: number | undefined,
) {
  return [
    owned ? 'Your copy of a TONE3000 preset' : 'TONE3000 original',
    facts && `${facts.blocks} ${facts.blocks === 1 ? 'block' : 'blocks'}`,
    captures !== undefined &&
      `${captures} ${captures === 1 ? 'capture' : 'captures'}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The file's pictures; leave `id` out for a preset that is not a TONE3000 file. */
export function usePresetArtwork(id: string | null, owned: boolean) {
  const [items, setItems] = useState<AssetArtwork[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    lifetime.current = controller;
    void presetArtwork(id, owned, controller.signal)
      .then((found) => {
        if (!controller.signal.aborted) setItems(found);
      })
      .catch(() => {
        // Pictures are optional: the preset plays without them.
        if (!controller.signal.aborted) setItems([]);
      });
    return () => controller.abort();
  }, [id, owned]);
  async function download() {
    const signal = lifetime.current?.signal;
    if (!id || !signal || signal.aborted || busy || !items) return;
    setBusy(true);
    setError('');
    try {
      // One at a time; stop on a failure and keep the ones already saved.
      for (const item of items.filter((i) => i.key && !i.cached))
        await saveArtwork(id, owned, item.key!, signal);
    } catch (cause) {
      if (!signal.aborted)
        setError(
          `${friendlyError(cause, 'download the pictures')}. The preset still plays; try again when the unit is online.`,
        );
    } finally {
      if (!signal.aborted) {
        try {
          setItems(await presetArtwork(id, owned, signal));
        } catch {
          /* Keep what is shown. */
        }
        setBusy(false);
      }
    }
  }
  return { items, busy, error, download };
}
