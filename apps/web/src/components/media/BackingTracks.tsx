import {
  ArrowDown,
  ArrowUp,
  DownloadSimple,
  Faders,
  Info,
  MusicNotes,
  PencilSimple,
  Queue,
  Trash,
  UploadSimple,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Caption } from '@oxidal/design-system/components/text';
import { useRemembered } from '@oxidal/design-system/lib/use-remembered';
import {
  type LibraryBadge,
  type LibraryItem,
  LibraryList,
} from '@oxidal/design-system/patterns/library-list';

import {
  type MediaAsset,
  originalPath,
  setPlayerOrder,
  songList,
  wavPath,
} from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import { formatTime } from '../../lib/playerClock';
import {
  canSplitBackingTrack,
  channelsLabel,
  durationOf,
  formatLabel,
  isStemSong,
  mixSourceOf,
  PROTECT_REASON,
  useProtect,
  useSessionMedia,
} from './sessionMedia';
import { splitLabel } from './stemMix';
import { DeleteDialog, RenameDialog } from './TrackDialogs';
import { UploadQueue } from './UploadQueue';

function gigabytes(bytes: number) {
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/**
 * Library ▸ Backing tracks: the Backing list in its playing order, with Play
 * (cues and starts), Cue, Details, Rename, Move up/down, Download original and
 * Delete, plus "Import WAV or MP3…" and its queue. Changing the list needs
 * Protect off; playing does not.
 * @see docs/media.md
 */
export function BackingTracks({ connected }: { connected: boolean }) {
  const media = useSessionMedia();
  const { player, tracks, library, send } = media;
  const protect = useProtect();
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  // Songs with stems and how they were made, such as "6 stems".
  const [stemKinds, setStemKinds] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  // Favourites are kept on this browser, as the list's star promises.
  const [favourites, setFavourites] = useRemembered<string[]>(
    'oxidal.backing.favourites',
    [],
  );
  const [dialog, setDialog] = useState<{
    kind: 'rename' | 'delete';
    asset: MediaAsset;
  } | null>(null);
  const space = library?.space;
  const free = space
    ? Math.max(0, space.availableBytes - space.reserveBytes)
    : null;

  useEffect(() => {
    let active = true;
    songList().then(
      ({ songs }) => {
        if (!active) return;
        setStemKinds(
          new Map(
            songs.map((song) => [
              song.source,
              song.splits.map((split) => splitLabel(split, song.splits))[0] ??
                'Stems',
            ]),
          ),
        );
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [library]);

  async function play(asset: MediaAsset) {
    setError('');
    if (player?.track?.id !== asset.id) {
      const cued = await send({ kind: 'cue', asset: asset.id });
      if (!cued) return;
    }
    await send({ kind: 'play' }, asset.id);
  }
  async function move(asset: MediaAsset, by: -1 | 1) {
    const order = tracks.map((track) => track.id);
    const from = order.indexOf(asset.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= order.length) return;
    order.splice(from, 1);
    order.splice(to, 0, asset.id);
    setError('');
    try {
      await setPlayerOrder(order);
    } catch (cause) {
      setError(deviceSentence(cause, 'reorder the backing tracks'));
    }
  }
  const locked = protect || !connected;
  /** What the shared list and its details need to know about one track. */
  function describe(track: MediaAsset, index: number) {
    const imported = isStemSong(track);
    const mixOf = mixSourceOf(track);
    const song = mixOf
      ? tracks.find((candidate) => candidate.id === mixOf)
      : undefined;
    const mixes = tracks.filter(
      (candidate) => mixSourceOf(candidate) === track.id,
    ).length;
    const stemKind = stemKinds.get(track.id);
    const hasStems = !!stemKind || imported;
    const splitting =
      media.split?.source === track.id && media.split.phase === 'running'
        ? media.split.percent
        : null;
    const cued = player?.track?.id === track.id;
    const playing = cued && player?.state === 'playing';
    return {
      track,
      index,
      song,
      mixOf,
      mixes,
      stemKind,
      hasStems,
      splitting,
      cued,
      playing,
      canStems: hasStems || !!song || canSplitBackingTrack(track),
      openStems: () =>
        media.setSheet(
          song
            ? { kind: 'stems', source: song.id, mix: track.id }
            : { kind: 'stems', source: track.id },
        ),
    };
  }
  const rows = tracks.map(describe);
  const byId = new Map(rows.map((row) => [row.track.id, row]));
  const items: LibraryItem[] = rows.map((row) => {
    const { track } = row;
    const badges: LibraryBadge[] = [];
    if (row.mixOf) badges.push({ text: 'Mix' });
    if (row.splitting !== null)
      badges.push({ text: `Splitting ${row.splitting}%` });
    else if (row.hasStems) badges.push({ text: row.stemKind ?? 'Stems' });
    return {
      id: track.id,
      title: track.title,
      caption: [
        formatTime(durationOf(track)),
        row.mixOf
          ? `Mix of ${row.song?.title ?? 'a removed song'}`
          : channelsLabel(
              track.source?.channels ?? track.renders[0]?.channels ?? 2,
            ),
        row.mixOf || isStemSong(track) ? null : formatLabel(track),
        row.mixes ? `${row.mixes} ${row.mixes === 1 ? 'mix' : 'mixes'}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      playable: connected,
      badge: row.cued
        ? { text: row.playing ? 'Playing' : 'Cued', tone: 'live' }
        : undefined,
      badges,
      favourite: favourites.includes(track.id),
      facts: [
        ['Length', formatTime(durationOf(track))],
        ['Place', `${row.index + 1} of ${tracks.length} in the Backing list`],
      ],
    };
  });
  const row = (id: string) => byId.get(id);
  return (
    <section className="grid min-w-0 gap-3" aria-label="Backing tracks">
      {protect && <Caption>{PROTECT_REASON}</Caption>}
      <UploadQueue />
      {(error || media.refusal) && (
        <p
          role="alert"
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
        >
          {error || media.refusal}
        </p>
      )}
      {media.libraryError && <p role="alert">{media.libraryError}</p>}
      <input
        ref={file}
        type="file"
        hidden
        multiple
        aria-label="Choose WAV or MP3 files"
        accept=".wav,.mp3,audio/wav,audio/x-wav,audio/mpeg"
        onChange={(event) => {
          for (const chosen of event.target.files ?? [])
            media.queue?.add(chosen);
          event.target.value = '';
        }}
      />
      <LibraryList
        items={items}
        query={query}
        onQuery={setQuery}
        searchLabels={{
          input: 'Search backing tracks',
          clear: 'Clear backing track search',
          placeholder: 'Find a track…',
        }}
        selected={selected}
        onOpen={setSelected}
        onFavourite={(id, on) =>
          setFavourites(
            on
              ? [...new Set([...favourites, id])]
              : favourites.filter((f) => f !== id),
          )
        }
        onPlay={(id) => {
          const r = row(id);
          if (!r) return;
          if (r.playing) void send({ kind: 'pause' }, id);
          else void play(r.track);
        }}
        tile={<MusicNotes />}
        noun={['track', 'tracks']}
        primary={
          <Button
            size="sm"
            variant="outline"
            disabled={locked}
            onClick={() => file.current?.click()}
          >
            <UploadSimple aria-hidden="true" />
            Import WAV or MP3…
          </Button>
        }
        toolbarEnd={
          free !== null && (
            <Caption as="span" className="text-xs">
              Free space: {gigabytes(free)}
            </Caption>
          )
        }
        empty={{
          title: library ? 'No backing tracks yet' : 'Reading backing tracks…',
          text: library
            ? 'Import a WAV or MP3 to play it over your guitar.'
            : undefined,
        }}
        mainAction={(item) => {
          const r = row(item.id);
          return r && !r.cued
            ? {
                label: 'Cue',
                icon: <Queue />,
                disabled: !connected,
                run: () => void send({ kind: 'cue', asset: item.id }),
              }
            : null;
        }}
        actions={[
          {
            label: 'Details',
            icon: <Info />,
            run: (id) => media.setSheet({ kind: 'details', asset: id }),
          },
          {
            label: 'Stems and mixes',
            icon: <Faders />,
            disabled: !connected,
            run: (id) => row(id)?.openStems(),
          },
          {
            label: 'Rename',
            icon: <PencilSimple />,
            disabled: locked,
            run: (id) => {
              const r = row(id);
              if (r) setDialog({ kind: 'rename', asset: r.track });
            },
          },
          {
            label: 'Move up',
            icon: <ArrowUp />,
            disabled: locked,
            run: (id) => {
              const r = row(id);
              if (r && r.index > 0) void move(r.track, -1);
            },
          },
          {
            label: 'Move down',
            icon: <ArrowDown />,
            disabled: locked,
            run: (id) => {
              const r = row(id);
              if (r && r.index < tracks.length - 1) void move(r.track, 1);
            },
          },
          {
            label: 'Delete…',
            icon: <Trash />,
            destructive: true,
            disabled: locked,
            run: (id) => {
              const r = row(id);
              if (r) setDialog({ kind: 'delete', asset: r.track });
            },
          },
        ]}
        detail={(item) => {
          const r = row(item.id);
          if (!r) return null;
          return (
            <Button size="sm" variant="outline" asChild>
              <a
                href={
                  r.track.source
                    ? originalPath(r.track.id)
                    : wavPath(r.track.id)
                }
                download
              >
                <DownloadSimple aria-hidden="true" />
                {r.track.source ? 'Download original' : 'Download WAV'}
              </a>
            </Button>
          );
        }}
      />
      {!!library?.quarantined.length && (
        <Caption>
          {library.quarantined.length === 1
            ? 'One file failed its check and is kept aside on the device.'
            : `${library.quarantined.length} files failed their check and are kept aside on the device.`}
        </Caption>
      )}
      <Caption className="text-xs">
        Plays from the device over your guitar, even with this page closed.
        Imports are levelled to −18 LUFS and prepared for the audio rate.
        Playing, pausing and skipping work with Protect on.
      </Caption>
      {dialog?.kind === 'rename' && (
        <RenameDialog asset={dialog.asset} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog asset={dialog.asset} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}
