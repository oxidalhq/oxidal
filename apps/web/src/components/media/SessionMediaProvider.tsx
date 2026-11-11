import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  mediaLibrary,
  monitoring,
  playerCommand,
  type MediaLibrary,
  type PlayerSnapshot,
} from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import { UploadQueue } from '../../lib/mediaUpload';
import { onPlayer } from '../../lib/playerFeed';
import './media.css';
import {
  SessionMediaContext,
  stateWord,
  type MediaSheet,
  type PlayerCommand,
  type SessionMedia,
  type ShownState,
} from './sessionMedia';

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
