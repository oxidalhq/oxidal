import * as React from 'react';
import type { ToneCatalogue, ToneSearch } from './model-browser';
import type { ModelChoice } from './swap-sheet';

const PER_PAGE = 6;
const FAVOURITES = ['t3k-dumble', 't3k-deluxe', 't3k-1969'];

/** Stands in for the device's TONE3000 downloads: each takes about half a second. */
export function useModelDownloads(initial: ModelChoice[]) {
  const [models, setModels] = React.useState(initial);
  const [downloads, setDownloads] = React.useState<Record<string, number>>({});
  const timers = React.useRef<ReturnType<typeof setInterval>[]>([]);
  React.useEffect(() => {
    const running = timers.current;
    return () => running.forEach(clearInterval);
  }, []);
  const onGet = (choice: ModelChoice) => {
    let progress = 0;
    setDownloads((d) => ({ ...d, [choice.id]: progress }));
    const timer = setInterval(() => {
      progress += 25;
      if (progress <= 100) {
        setDownloads((d) => ({ ...d, [choice.id]: progress }));
        return;
      }
      clearInterval(timer);
      setDownloads((d) => {
        const next = { ...d };
        delete next[choice.id];
        return next;
      });
      setModels((all) =>
        all.map((m) => (m.id === choice.id ? { ...m, downloaded: true } : m)),
      );
    }, 120);
    timers.current.push(timer);
  };
  const [search, setSearch] = React.useState<ToneSearch>({
    query: '',
    collection: 'trending',
    gear: null,
  });
  const [page, setPage] = React.useState(1);
  const onSearch = React.useCallback((next: ToneSearch) => {
    setSearch(next);
    setPage(1);
  }, []);
  const words = search.query.toLowerCase();
  const listed = models.filter(
    (m) =>
      m.from === 'tone3000' &&
      (!search.gear || m.gear === search.gear) &&
      `${m.label} ${m.caption} ${m.creator ?? ''}`
        .toLowerCase()
        .includes(words) &&
      (search.collection === 'favorites'
        ? FAVOURITES.includes(m.id)
        : search.collection === 'downloaded'
          ? m.downloaded
          : search.collection !== 'created'),
  );
  const found = search.collection === 'latest' ? listed.reverse() : listed;
  const catalogue: ToneCatalogue = {
    status: {
      state: 'ready',
      page,
      totalPages: Math.max(1, Math.ceil(found.length / PER_PAGE)),
    },
    results: found.slice(0, page * PER_PAGE),
    onSearch,
    onMore: () => setPage((p) => p + 1),
    onSignIn: () => {},
    onRetry: () => {},
  };
  return { models, downloads, onGet, catalogue };
}
