import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import './media.css';
import {
  currentSplit,
  type MediaLibrary,
  mediaLibrary,
  monitoring,
  playerCommand,
  type PlayerSnapshot,
  songSplitJob,
} from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import { UploadQueue } from '../../lib/mediaUpload';
import { onPlayer } from '../../lib/playerFeed';
import {
  type MediaSheet,
  type PlayerCommand,
  type SessionMedia,
  SessionMediaContext,
  type ShownState,
  type SplitActivity,
  stateWord,
} from './sessionMedia';

/** How often the device's split is checked while one runs and while idle. */
const SPLIT_RUNNING_MS = 1500;
const SPLIT_IDLE_MS = 6000;
/** A finished split stays visible this long. */
const SPLIT_DONE_MS = 15000;

/** Pending feedback lasts at most this long; then the device's state shows. */
const PENDING_MS = 300;
/** A rise in underruns this recent shows the track as stalled. */
const STALL_MS = 3000;
/** Commands that act on "the cued track" carry it, so a stale one is refused. */
const cueBound = new Set<PlayerCommand['kind']>([
  'previous',
  'next',
  'seek_to',
  'skip_by',
  'set_practice_range',
  'set_click',
  'set_speed',
  'set_stem_mix',
]);
const levelKinds = new Set<PlayerCommand['kind']>([
  'set_level',
  'adjust_level',
]);
const empty: never[] = [];

/** E-paper is the app's display mode, kept on the root element. */
const epaper = () => document.documentElement.dataset.display === 'epaper';
function watchDisplay(change: () => void) {
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-display'],
  });
  return () => observer.disconnect();
}

/**
 * Owns the backing player for the whole app: the snapshots from the tab's
 * device event stream, one command path with request IDs, the media list and
 * the import queue.
 * Every surface (mini-player, full player, Perform, Library) reads it through
 * `useSessionMedia()`.
 * @see docs/media.md
 */
export function SessionMediaProvider({ children }: { children: ReactNode }) {
  const slow = useSyncExternalStore(watchDisplay, epaper, () => false);
  const [player, setPlayer] = useState<PlayerSnapshot | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [notice, setNotice] = useState('');
  const [muted, setMuted] = useState(false);
  const [stalledAt, setStalledAt] = useState<number | null>(null);
  const [library, setLibrary] = useState<MediaLibrary | null>(null);
  const [libraryError, setLibraryError] = useState('');
  const [sheet, setSheet] = useState<MediaSheet>(null);
  const [split, setSplit] = useState<SplitActivity | null>(null);
  const splitCheck = useRef<() => void>(() => {});
  const refreshSplit = useCallback(() => splitCheck.current(), []);
  const [announcement, setAnnouncement] = useState('');
  const current = useRef<PlayerSnapshot | null>(null);
  const busy = useRef(false);
  const libraryRun = useRef(0);

  const refreshLibrary = useCallback(() => {
    const run = ++libraryRun.current;
    void mediaLibrary()
      .then((next) => {
        if (run !== libraryRun.current) return;
        setLibrary(next);
        setLibraryError('');
      })
      .catch((cause: unknown) => {
        if (run === libraryRun.current)
          setLibraryError(deviceSentence(cause, 'read backing tracks'));
      });
  }, []);

  const [queue] = useState(() => new UploadQueue());
  useEffect(
    () =>
      queue.whenReady((_asset, title) => {
        setAnnouncement(`${title} imported`);
        refreshLibrary();
      }),
    [queue, refreshLibrary],
  );
  const uploads = useSyncExternalStore(queue.subscribe, queue.snapshot);

  /** Take a snapshot unless a newer one already arrived. */
  const accept = useCallback((next: PlayerSnapshot, stream: boolean) => {
    const previous = current.current;
    if (!stream && previous && next.revision < previous.revision) return;
    current.current = next;
    const at = performance.now();
    setPlayer(next);
    setReceivedAt(at);
    if (previous && next.underruns > previous.underruns) setStalledAt(at);
    if (next.notice && next.notice !== previous?.notice) setNotice(next.notice);
    if (previous && previous.state !== next.state)
      setAnnouncement(stateWord[next.state]);
  }, []);

  // Snapshots come from the app's one device event stream.
  useEffect(() => onPlayer((next) => accept(next, true)), [accept]);

  // The Library list follows the Backing list: a new, removed or reordered
  // track (from any client) changes the order and refreshes it.
  const orderKey = player ? player.order.join(',') : null;
  const titleKey = player?.track?.title;
  useEffect(() => {
    if (orderKey === null) return;
    const timer = window.setTimeout(refreshLibrary, 0);
    return () => window.clearTimeout(timer);
  }, [orderKey, titleKey, refreshLibrary]);

  const cued = !!player?.track;
  useEffect(() => {
    if (!cued) return;
    let alive = true;
    const read = () =>
      void monitoring()
        .then((m) => {
          if (alive) setMuted(m.audio?.monitoring?.output_muted ?? false);
        })
        .catch(() => undefined);
    read();
    const timer = window.setInterval(read, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [cued]);

  useEffect(() => {
    if (stalledAt === null) return;
    const timer = window.setTimeout(() => setStalledAt(null), STALL_MS);
    return () => window.clearTimeout(timer);
  }, [stalledAt]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 8000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const send = useCallback(
    async (command: PlayerCommand) => {
      // Level moves are coalesced by their control and never wait on transport.
      const transport = !levelKinds.has(command.kind);
      if (transport && busy.current) return false;
      if (transport) {
        busy.current = true;
        setPending(true);
      }
      setRefusal('');
      const release = transport
        ? window.setTimeout(() => {
            busy.current = false;
            setPending(false);
          }, PENDING_MS)
        : undefined;
      const cue = current.current?.track?.id;
      const request = {
        requestId: crypto.randomUUID(),
        origin: 'ui' as const,
        expectedCue: cueBound.has(command.kind) ? (cue ?? null) : null,
        command,
      };
      try {
        let next: PlayerSnapshot;
        try {
          next = await playerCommand(request);
        } catch (cause) {
          // A lost response is retried once with the same request ID, so the
          // device answers with the first result instead of acting twice.
          if (!(cause instanceof TypeError)) throw cause;
          await new Promise((resolve) => setTimeout(resolve, 400));
          next = await playerCommand(request);
        }
        accept(next, false);
        return true;
      } catch (cause) {
        setRefusal(deviceSentence(cause, 'control the backing track'));
        return false;
      } finally {
        window.clearTimeout(release);
        if (transport) {
          busy.current = false;
          setPending(false);
        }
      }
    },
    [accept],
  );

  const tracks = useMemo(() => {
    const backing = (library?.assets ?? empty).filter(
      (asset) => asset.kind === 'backing',
    );
    const order = player?.order ?? [];
    const place = (id: string) => {
      const index = order.indexOf(id);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    return [...backing].sort(
      (a, b) =>
        place(a.id) - place(b.id) || a.created_at.localeCompare(b.created_at),
    );
  }, [library, player?.order]);

  const shown: ShownState =
    !player || !player.track
      ? 'empty'
      : player.state === 'playing' && stalledAt !== null
        ? 'stalled'
        : player.state;

  // The one split on the device, followed from every page. When it ends, the
  // library reloads and the result stays visible for a short while.
  useEffect(() => {
    let alive = true;
    let timer = 0;
    let running: string | null = null;
    let cleared = 0;
    async function check() {
      window.clearTimeout(timer);
      try {
        const current = await currentSplit();
        if (!alive) return;
        if (current) {
          running = current.source;
          setSplit({
            source: current.source,
            mode: current.job.mode,
            percent: current.job.progress?.percent ?? 0,
            phase: 'running',
          });
        } else if (running) {
          const source = running;
          running = null;
          const done = await songSplitJob(source).catch(() => null);
          if (!alive) return;
          setSplit(
            done && done.phase !== 'running'
              ? { source, mode: done.mode, percent: 100, phase: done.phase }
              : null,
          );
          refreshLibrary();
          window.clearTimeout(cleared);
          cleared = window.setTimeout(
            () => setSplit((now) => (now?.phase === 'running' ? now : null)),
            SPLIT_DONE_MS,
          );
        }
      } catch {
        // The next check tries again; a missing endpoint means no splitter.
      }
      if (alive)
        timer = window.setTimeout(
          () => void check(),
          running ? SPLIT_RUNNING_MS * (slow ? 2 : 1) : SPLIT_IDLE_MS,
        );
    }
    splitCheck.current = () => void check();
    void check();
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearTimeout(cleared);
    };
  }, [refreshLibrary, slow]);

  const value = useMemo<SessionMedia>(
    () => ({
      ready: true,
      player,
      receivedAt,
      shown,
      muted,
      slow,
      pending,
      refusal,
      clearRefusal: () => setRefusal(''),
      notice,
      send,
      library,
      libraryError,
      refreshLibrary,
      tracks,
      uploads,
      queue,
      sheet,
      setSheet,
      split,
      refreshSplit,
    }),
    [
      player,
      receivedAt,
      shown,
      muted,
      slow,
      pending,
      refusal,
      notice,
      send,
      library,
      libraryError,
      refreshLibrary,
      tracks,
      uploads,
      queue,
      sheet,
      split,
      refreshSplit,
    ],
  );
  return (
    <SessionMediaContext.Provider value={value}>
      {children}
      <div className="sr-only" aria-live="polite">
        {announcement}
      </div>
    </SessionMediaContext.Provider>
  );
}
