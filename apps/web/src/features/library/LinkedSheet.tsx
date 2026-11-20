import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { parseSong } from '@oxidal/design-system/lib/song';
import { SheetViewer } from '@oxidal/design-system/widgets/sheet-viewer';

import {
  chordSheet,
  chordSheetLinks,
  type SheetDocument,
  type SheetLinks,
} from '../../api';
import { useSessionMedia } from '../../components/media/sessionMedia';
import { friendlyError } from '../../lib/friendlyError';
import { useMonitorFeed } from '../../monitorFeed';
import { resolveSheet, SHEETS_CHANGED } from './sheetResolution';

type Reading = { document: SheetDocument; source: string };
type SharedSheet = {
  reading?: Reading;
  source: string;
  sheet?: string;
  loading: boolean;
  error: string;
  missing: boolean;
  refresh: () => void;
  size: number;
  setSize: (size: number) => void;
  chordsVisible: boolean;
  setChordsVisible: (visible: boolean) => void;
  speed: number;
  setSpeed: (speed: number) => void;
  scrollPosition: (id: string) => number;
  rememberScroll: (id: string, top: number) => void;
};
const LinkedSheetContext = createContext<SharedSheet | null>(null);
const VIEWER_KEY = 'oxidal.chord-viewer.v1';
const defaultViewer = { size: 3, speed: 4, chordsVisible: true };
function readViewer() {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(VIEWER_KEY) ?? 'null',
    );
    if (
      value &&
      typeof value === 'object' &&
      'size' in value &&
      'speed' in value &&
      'chordsVisible' in value &&
      typeof value.size === 'number' &&
      Number.isInteger(value.size) &&
      value.size >= 0 &&
      value.size <= 8 &&
      typeof value.speed === 'number' &&
      Number.isInteger(value.speed) &&
      value.speed >= 1 &&
      value.speed <= 10 &&
      typeof value.chordsVisible === 'boolean'
    )
      return {
        size: value.size,
        speed: value.speed,
        chordsVisible: value.chordsVisible,
      };
  } catch {
    /* Optional viewer storage. */
  }
  return defaultViewer;
}

/** One shell-level read owner for every performance sheet; never sends audio commands.
 * @see docs/media.md
 */
export function LinkedSheetProvider({
  connected,
  slow = false,
  children,
}: {
  connected: boolean;
  slow?: boolean;
  children: ReactNode;
}) {
  const monitor = useMonitorFeed(slow ? 5000 : 2000);
  const media = useSessionMedia();
  const preset = monitor.snapshot?.preset;
  const track = media.player?.track?.id;
  const occurrence = monitor.snapshot?.set_entry;
  const source = JSON.stringify([
    preset ?? null,
    track ?? null,
    occurrence?.entry.id ?? null,
  ]);
  const [links, setLinks] = useState<SheetLinks>();
  const [reading, setReading] = useState<Reading>();
  const [linkError, setLinkError] = useState('');
  const [documentError, setDocumentError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [viewer, setViewer] = useState(readViewer);
  const { size, speed, chordsVisible } = viewer;
  const setSize = (size: number) =>
    setViewer((old) => ({
      ...old,
      size: Math.max(0, Math.min(8, Math.round(size))),
    }));
  const setSpeed = (speed: number) =>
    setViewer((old) => ({
      ...old,
      speed: Math.max(1, Math.min(10, Math.round(speed))),
    }));
  const setChordsVisible = (chordsVisible: boolean) =>
    setViewer((old) => ({ ...old, chordsVisible }));
  useEffect(() => {
    try {
      localStorage.setItem(VIEWER_KEY, JSON.stringify(viewer));
    } catch {
      /* Keep the current session usable. */
    }
  }, [viewer]);
  const scroll = useRef(new Map<string, number>());
  useEffect(() => {
    if (!connected) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let generation = 0;
    const refresh = async () => {
      clearTimeout(timer);
      const request = ++generation;
      try {
        const next = await chordSheetLinks();
        if (active && generation === request) {
          setLinks(next);
          setLinkError('');
        }
      } catch (cause) {
        if (active && generation === request)
          setLinkError(friendlyError(cause, 'read song links'));
      } finally {
        if (active && generation === request)
          timer = setTimeout(() => void refresh(), 6000);
      }
    };
    const changed = () => void refresh();
    window.addEventListener(SHEETS_CHANGED, changed);
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener(SHEETS_CHANGED, changed);
    };
  }, [connected, retry]);
  const link = resolveSheet(links?.links ?? [], preset, track);
  const sheet = occurrence?.entry.settings.sheet ?? link?.sheet;
  useEffect(() => {
    if (!connected || !sheet) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true);
      try {
        const document = await chordSheet(sheet);
        if (active) {
          setReading({ document, source });
          setDocumentError('');
        }
      } catch (cause) {
        if (active)
          setDocumentError(friendlyError(cause, 'read the linked song'));
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [connected, sheet, source, links?.registry_revision, retry]);
  return (
    <LinkedSheetContext.Provider
      value={{
        reading,
        source,
        sheet,
        loading: !!sheet && loading,
        error:
          !connected || monitor.disconnected
            ? 'Connection lost. Showing the previous reading.'
            : linkError || documentError,
        missing: !sheet,
        refresh: () => setRetry((n) => n + 1),
        size,
        setSize,
        speed,
        setSpeed,
        chordsVisible,
        setChordsVisible,
        scrollPosition: (id) => scroll.current.get(id) ?? 0,
        rememberScroll: (id, top) => {
          if (!Number.isFinite(top)) return;
          if (!scroll.current.has(id) && scroll.current.size >= 128)
            scroll.current.delete(scroll.current.keys().next().value!);
          scroll.current.set(id, Math.max(0, top));
        },
      }}
    >
      {children}
    </LinkedSheetContext.Provider>
  );
}

/** Stage and the dock share selected source and viewer preferences. */
export function LinkedSheet({ stage = false }: { stage?: boolean }) {
  const shared = useContext(LinkedSheetContext);
  const document = shared?.reading?.document;
  const song = useMemo(
    () =>
      document && parseSong(document.source, document.format, document.title),
    [document],
  );
  if (!shared) return null;
  const current =
    shared.reading?.source === shared.source &&
    shared.reading?.document.id === shared.sheet &&
    !shared.missing;
  return (
    <section aria-label="Linked chord sheet" className="grid min-h-0 gap-2">
      {(shared.error || shared.loading || !current) && (
        <div role="status" className="space-y-2 px-3 text-sm">
          <p>
            {shared.error ||
              (shared.loading
                ? 'Reading the linked song…'
                : shared.missing
                  ? 'No chord sheet is linked to this preset or cued track. Add a link in Library → Songbook.'
                  : 'Reading the current song…')}
          </p>
          {song && <p>Previous sheet: {song.title}</p>}
          <Button variant="outline" size="sm" onClick={shared.refresh}>
            Refresh song links
          </Button>
        </div>
      )}
      {song && (
        <SheetViewer
          key={document!.id}
          song={song}
          size={shared.size}
          onSize={shared.setSize}
          speed={shared.speed}
          onSpeed={shared.setSpeed}
          chordsVisible={shared.chordsVisible}
          onChordsVisible={shared.setChordsVisible}
          stage={stage}
          linked={
            current && !shared.error
              ? ['Current preset or cued track']
              : ['Previous sheet']
          }
          initialScroll={shared.scrollPosition(document!.id)}
          onScrollPosition={(top) => {
            shared.rememberScroll(document!.id, top);
          }}
          className="h-[min(65dvh,48rem)] min-h-64"
        />
      )}
    </section>
  );
}
