/**
 * The TONE3000 catalogue as the shared `ModelBrowser` asks for it: search,
 * collection and gear filters through the device, paging, which tones are
 * already on the device, and each tone as a browser choice. Used by
 * Library › TONE3000 and by Change… (the model chooser), so both search and
 * look the same.
 * @see docs/native-tone3000.md
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ModelChoice,
  ToneCatalogue,
  ToneCatalogueStatus,
  ToneGear,
  ToneSearch,
} from '@oxidal/design-system/patterns/model-browser';

import {
  localModels,
  tone3000Models,
  tone3000Tones,
  toneImage,
  type TonePage,
} from '../../api';
import { friendlyError } from '../../lib/friendlyError';
import { remoteProblem } from '../../lib/sessionState';

export type Tone = TonePage['data'][number];

const GEAR_LABEL: Record<string, string> = {
  amp: 'Amp',
  'amp-cab': 'Full rig',
  pedal: 'Pedal',
  outboard: 'Outboard',
  cab: 'Cab',
  space: 'Room or space',
  experimental: 'Experimental',
};

export const isIr = (tone: Tone) => /ir/i.test(tone.format);

/** A TONE3000 tone as the shared browser shows it. */
export function choiceOf(tone: Tone, downloaded: boolean): ModelChoice {
  const gear = GEAR_LABEL[tone.gear] ?? tone.gear;
  const creator = tone.user.display_name || tone.user.username;
  return {
    id: String(tone.id),
    label: tone.title,
    caption: [
      downloaded ? 'Downloaded' : null,
      gear,
      isIr(tone)
        ? 'IR'
        : `${tone.models_count} ${tone.models_count === 1 ? 'model' : 'models'}`,
    ]
      .filter(Boolean)
      .join(' · '),
    kind:
      tone.gear === 'cab' || tone.gear === 'space' || isIr(tone)
        ? 'cab'
        : tone.gear === 'pedal'
          ? 'pedal'
          : 'amp',
    from: 'tone3000',
    creator,
    licence: tone.license,
    downloaded,
    gear: tone.gear as ToneGear,
    origin: {
      kind: 'tone3000',
      title: tone.title,
      creator: {
        name: creator,
        username: tone.user.username,
        profile: tone.user.profile_url ?? undefined,
      },
      page: tone.url,
      image: tone.images?.length ? toneImage(tone.id) : undefined,
      counts: {
        standard: tone.a1_models_count || undefined,
        a2: tone.a2_models_count || undefined,
        custom: tone.custom_models_count || undefined,
      },
      gear,
      format: isIr(tone) ? 'IR' : 'NAM',
      models: tone.models_count,
      licence: tone.license,
    },
  };
}

export function useToneCatalogue({
  connected,
  onSignIn,
}: {
  connected: boolean;
  onSignIn: () => void;
}) {
  const [search, setSearch] = useState<ToneSearch>({
    query: '',
    collection: 'trending',
    gear: null,
  });
  const [page, setPage] = useState(1);
  const [tones, setTones] = useState<Tone[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState('');
  const [retry, setRetry] = useState(0);
  const [kept, setKept] = useState<Set<number>>(new Set());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Tones already on the device, by their TONE3000 tone id.
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    localModels(null, controller.signal, true).then(
      (local) =>
        setKept(
          new Set(
            local.data.flatMap((model) =>
              model.tone_id == null ? [] : [model.tone_id],
            ),
          ),
        ),
      () => {},
    );
    return () => controller.abort();
  }, [connected]);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    tone3000Tones(
      {
        query: search.query,
        collection: search.collection,
        gear: search.gear,
        page,
      },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setTones((previous) => {
          if (page === 1) return result.data;
          const seen = new Set(previous.map((tone) => tone.id));
          return [
            ...previous,
            ...result.data.filter((tone) => !seen.has(tone.id)),
          ];
        });
        setTotalPages(result.total_pages ?? 1);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setCatalogueError(friendlyError(cause, 'read TONE3000'));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [connected, search, page, retry]);

  // Stable handlers: the browser asks again whenever its search handler
  // changes, so a new function each render would search without end.
  const onSearch = useCallback((next: ToneSearch) => {
    setSearch((current) => {
      if (
        current.query === next.query &&
        current.collection === next.collection &&
        current.gear === next.gear
      )
        return current;
      // Each new request shows it is searching and clears the last problem.
      setLoading(true);
      setCatalogueError('');
      setPage(1);
      return next;
    });
  }, []);
  const onMore = useCallback(() => {
    setLoading(true);
    setPage((n) => n + 1);
  }, []);
  const onRetry = useCallback(() => {
    setLoading(true);
    setCatalogueError('');
    setRetry((n) => n + 1);
  }, []);

  /** The tone's models in one format; the first is the one to play. */
  const modelsOf = useCallback(
    async (toneId: number, signal: AbortSignal, format?: 'nam' | 'ir') => {
      const tone = tones.find((t) => t.id === toneId);
      return tone3000Models(
        toneId,
        1,
        signal,
        format ?? (tone && isIr(tone) ? 'ir' : 'nam'),
      );
    },
    [tones],
  );
  const markKept = useCallback(
    (toneId: number) => setKept((all) => new Set(all).add(toneId)),
    [],
  );

  const problem = remoteProblem(catalogueError);
  const status: ToneCatalogueStatus = !connected
    ? { state: 'offline' }
    : catalogueError
      ? problem === 'account'
        ? { state: 'signed-out' }
        : problem === 'offline'
          ? { state: 'offline' }
          : { state: 'failed', message: catalogueError }
      : loading && page === 1
        ? { state: 'searching' }
        : { state: 'ready', page, totalPages };

  const catalogue: ToneCatalogue = {
    status,
    results: tones.map((tone) => choiceOf(tone, kept.has(tone.id))),
    onSearch,
    onMore,
    onSignIn,
    onRetry,
  };
  return { catalogue, tones, kept, markKept, modelsOf };
}
