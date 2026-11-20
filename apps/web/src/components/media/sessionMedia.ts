import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  type MediaAsset,
  type MediaLibrary,
  type PlayerRequest,
  type PlayerSnapshot,
  protectState,
} from '../../api';
import type { UploadItem, UploadQueue } from '../../lib/mediaUpload';
import { formatTime, lengthOf, positionAt } from '../../lib/playerClock';

export type PlayerCommand = PlayerRequest['command'];

/** The overlay the player owns: the full player, its list or a track's details. */
export type MediaSheet =
  | { kind: 'player' }
  | { kind: 'list' }
  | { kind: 'details'; asset: string }
  /** Stems and mixes for a song, optionally opened on one mix. */
  | { kind: 'stems'; source: string; mix?: string }
  | null;

/** A split on this device: running, or just finished and still worth showing. */
export interface SplitActivity {
  source: string;
  mode: 'four' | 'six';
  percent: number;
  phase: 'running' | 'ready' | 'failed' | 'cancelled' | 'interrupted';
}

/**
 * What a surface shows for the player. `stalled` is not a device state: it is
 * a playing track whose underrun count rose in the last few seconds.
 */
export type ShownState = PlayerSnapshot['state'] | 'stalled';

/**
 * One source of truth for every backing-player surface: the device's last
 * snapshot (from the event stream or a command reply), the Library's media list
 * and the import queue. Buttons are pending for at most 300 ms after a command;
 * after that they show whatever the device reports, so two phones never disagree.
 * @see docs/media.md
 */
export interface SessionMedia {
  /** False outside the provider (tests, isolated screens): render nothing. */
  ready: boolean;
  player: PlayerSnapshot | null;
  /** `performance.now()` when `player` arrived, for local interpolation. */
  receivedAt: number;
  shown: ShownState;
  /** The device's output mute, shown so a silent running track is explained. */
  muted: boolean;
  /** E-paper: text state, 1 Hz time, step buttons instead of drag. */
  slow: boolean;
  pending: boolean;
  /** The newest refusal of a player command, in the device's words. */
  refusal: string;
  clearRefusal: () => void;
  /** The one-shot notice of the newest snapshot (a preset gap). */
  notice: string;
  send: (command: PlayerCommand) => Promise<boolean>;
  library: MediaLibrary | null;
  libraryError: string;
  refreshLibrary: () => void;
  /** Backing tracks in Backing-list order. */
  tracks: MediaAsset[];
  uploads: UploadItem[];
  queue: UploadQueue | null;
  sheet: MediaSheet;
  setSheet: (sheet: MediaSheet) => void;
  /** The device's split, shown on every page while it runs. */
  split?: SplitActivity | null;
  /** Check the split now, for example right after starting one. */
  refreshSplit?: () => void;
}

const inert: SessionMedia = {
  ready: false,
  player: null,
  receivedAt: 0,
  shown: 'empty',
  muted: false,
  slow: false,
  pending: false,
  refusal: '',
  clearRefusal: () => {},
  notice: '',
  send: async () => false,
  library: null,
  libraryError: '',
  refreshLibrary: () => {},
  tracks: [],
  uploads: [],
  queue: null,
  sheet: null,
  setSheet: () => {},
};

export const SessionMediaContext = createContext<SessionMedia>(inert);

export function useSessionMedia(): SessionMedia {
  return useContext(SessionMediaContext);
}

/** Words that carry each state, so colour or icons are never the only cue. */
export const stateWord: Record<ShownState, string> = {
  empty: 'No track cued',
  ready: 'Ready',
  playing: 'Playing',
  paused: 'Paused',
  ended: 'Track ended',
  stalled: 'Playback stalled',
  interrupted: 'Stopped by audio restart',
  unavailable: 'Not playable yet',
};

/**
 * The shown position in seconds, re-rendered four times a second while the
 * track plays (once a second on e-paper) and not at all otherwise.
 */
export function usePlayerPosition(): { at: number; length: number } {
  const { player, receivedAt, slow } = useSessionMedia();
  const playing = player?.state === 'playing';
  const [now, setNow] = useState(receivedAt);
  useEffect(() => {
    const tick = () => setNow(performance.now());
    const first = window.setTimeout(tick, 0);
    if (!playing)
      return () => {
        window.clearTimeout(first);
      };
    const timer = window.setInterval(tick, slow ? 1000 : 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [playing, slow, receivedAt]);
  const length = lengthOf(player);
  // Between a new snapshot and the next tick, `now` may predate it.
  const at = positionAt(player, receivedAt, Math.max(now, receivedAt));
  return { at: slow ? Math.floor(at) : at, length };
}

/** The asset after the cued one in the Backing list, if any. */
export function nextUp(
  player: PlayerSnapshot | null,
  tracks: MediaAsset[],
): MediaAsset | undefined {
  if (!player) return undefined;
  const index = player.order.indexOf(player.track?.id ?? '');
  const id = player.order[index + 1];
  return tracks.find((track) => track.id === id);
}

/** The time line a compact surface shows for each state. */
export function useTimeText(state: ShownState): string {
  const { player } = useSessionMedia();
  const { at, length } = usePlayerPosition();
  switch (state) {
    case 'ready':
      return `0:00 / ${formatTime(length)}`;
    case 'ended':
      return `${formatTime(length)} / ${formatTime(length)}`;
    case 'interrupted':
      return `Audio restarted at ${formatTime(at)}`;
    case 'unavailable':
      return player?.reason ?? 'Not playable yet';
    default:
      return `${formatTime(at)} / ${formatTime(length)}`;
  }
}

/** Protect as the device reports it, re-read every 5 s while shown. */
export function useProtect(active = true): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const read = () =>
      void protectState()
        .then((state) => alive && setOn(state.on))
        .catch(() => undefined);
    read();
    const timer = window.setInterval(read, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [active]);
  return on;
}

export const PROTECT_REASON =
  'Protect is on. Turn Protect off to import, rename, reorder or delete tracks.';

export function channelsLabel(channels: number): string {
  return channels === 1
    ? 'Mono'
    : channels === 2
      ? 'Stereo'
      : `${channels} channels`;
}

/** The song a saved stem mix was rendered from, if this track is one. */
export function mixSourceOf(asset: MediaAsset): string | null {
  const details = asset.provenance as
    { splitMix?: { source?: unknown } } | null | undefined;
  const source = details?.splitMix?.source;
  return typeof source === 'string' ? source : null;
}

/** A backing song assembled from uploaded stems. */
export function isStemSong(asset: MediaAsset): boolean {
  const details = asset.provenance as { importedStems?: unknown } | null;
  return !!details && typeof details === 'object' && 'importedStems' in details;
}

type LiveRecipe = Extract<PlayerCommand, { kind: 'set_stem_mix' }>['recipe'];

/**
 * Sends live stem mixes as they change. While one is in flight only the
 * newest waits, so a slider drag never queues a backlog.
 */
export function useStemMixSender() {
  const { send } = useSessionMedia();
  const sending = useRef(false);
  type Change = { split: string; expected: LiveRecipe; recipe: LiveRecipe };
  const waiting = useRef<Change | null>(null);
  return useCallback(
    async (change: Change) => {
      if (sending.current) {
        const prior = waiting.current;
        waiting.current =
          prior?.split === change.split
            ? { ...change, expected: prior.expected }
            : change;
        return;
      }
      sending.current = true;
      let next: Change | null = change;
      while (next) {
        waiting.current = null;
        if (!(await send({ kind: 'set_stem_mix', ...next }))) {
          waiting.current = null;
          break;
        }
        next = waiting.current;
      }
      sending.current = false;
    },
    [send],
  );
}

export function canSplitBackingTrack(asset: MediaAsset): boolean {
  const format = asset.source?.container.toLowerCase();
  return asset.kind === 'backing' && (format === 'wav' || format === 'mp3');
}

/** "MP3" or "WAV", from the stored source. */
export function formatLabel(asset: MediaAsset): string {
  return (asset.source?.container ?? asset.renders[0]?.file ?? '')
    .replace(/^.*\./, '')
    .toUpperCase();
}

/** Seconds of the play-ready render (the source when there is none). */
export function durationOf(asset: MediaAsset): number {
  const render = asset.renders[0];
  if (render && render.rate > 0) return render.frames / render.rate;
  const source = asset.source;
  return source && source.rate > 0 ? source.frames / source.rate : 0;
}

export function fileSize(bytes: number): string {
  return bytes < 100_000
    ? `${Math.max(1, Math.round(bytes / 1000))} kB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}
