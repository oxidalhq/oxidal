import { Faders, Pause, Play, UploadSimple } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';

import {
  type MediaAsset,
  originalPath,
  setPlayerOrder,
  songList,
  wavPath,
} from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import { formatTime } from '../../lib/playerClock';
import type { MenuItem } from '../RowMenu';
import { MediaRow } from './MediaRow';
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
import { StateChip } from './StateChip';
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
  return (
    <section className="media-backing" aria-label="Backing tracks">
      <div className="media-section-head">
        <div>
          <h2>Backing tracks</h2>
          <p className="caption">
            Plays from the device over your guitar, even with this page closed.
          </p>
        </div>
        <div className="media-section-meta">
          {free !== null && (
            <span className="caption">Free space: {gigabytes(free)}</span>
          )}
          <Button disabled={locked} onClick={() => file.current?.click()}>
            <UploadSimple aria-hidden="true" />
            Import WAV or MP3…
          </Button>
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
        </div>
      </div>
      {protect && <p className="caption">{PROTECT_REASON}</p>}
      <UploadQueue />
      {(error || media.refusal) && (
        <p role="alert" className="media-note">
          {error || media.refusal}
        </p>
      )}
      {media.libraryError && <p role="alert">{media.libraryError}</p>}
      {library && !tracks.length ? (
        <p className="caption">
          No backing tracks yet. Import a WAV or MP3 to play it over your
          guitar.
        </p>
      ) : (
        <ol className="media-rows" aria-label="Backing list">
          {tracks.map((track, index) => {
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
            const openStems = () =>
              media.setSheet(
                song
                  ? { kind: 'stems', source: song.id, mix: track.id }
                  : { kind: 'stems', source: track.id },
              );
            const splitting =
              media.split?.source === track.id &&
              media.split.phase === 'running'
                ? media.split.percent
                : null;
            const cued = player?.track?.id === track.id;
            const playing = cued && player?.state === 'playing';
            const menu: MenuItem[] = [
              {
                label: 'Cue',
                disabled: cued,
                onSelect: () => void send({ kind: 'cue', asset: track.id }),
              },
              {
                label: 'Details',
                onSelect: () =>
                  media.setSheet({ kind: 'details', asset: track.id }),
              },
              ...(hasStems || song || canSplitBackingTrack(track)
                ? [
                    {
                      label: song
                        ? 'Edit this mix'
                        : hasStems
                          ? 'Stems and mixes'
                          : 'Split into stems…',
                      disabled: !connected,
                      onSelect: openStems,
                    },
                  ]
                : []),
              {
                label: 'Rename',
                disabled: locked,
                onSelect: () => setDialog({ kind: 'rename', asset: track }),
              },
              'separator',
              {
                label: 'Move up',
                disabled: locked || index === 0,
                onSelect: () => void move(track, -1),
              },
              {
                label: 'Move down',
                disabled: locked || index === tracks.length - 1,
                onSelect: () => void move(track, 1),
              },
              'separator',
              {
                label: track.source ? 'Download original' : 'Download WAV',
                href: track.source ? originalPath(track.id) : wavPath(track.id),
                download: true,
              },
              {
                label: 'Delete…',
                disabled: locked,
                onSelect: () => setDialog({ kind: 'delete', asset: track }),
              },
            ];
            return (
              <MediaRow
                key={track.id}
                num={index + 1}
                name={track.title}
                cued={cued}
                state={
                  <>
                    {mixOf && (
                      <span className="media-chip" data-kind="mix">
                        Mix
                      </span>
                    )}
                    {splitting !== null ? (
                      <span className="media-chip" data-kind="stems">
                        Splitting {splitting}%
                      </span>
                    ) : (
                      hasStems && (
                        <span className="media-chip" data-kind="stems">
                          {stemKind ?? 'Stems'}
                        </span>
                      )
                    )}
                    {cued && <StateChip state={playing ? 'playing' : 'cued'} />}
                  </>
                }
                sub={[
                  formatTime(durationOf(track)),
                  mixOf
                    ? `Mix of ${song?.title ?? 'a removed song'}`
                    : channelsLabel(
                        track.source?.channels ??
                          track.renders[0]?.channels ??
                          2,
                      ),
                  mixOf ? null : imported ? null : formatLabel(track),
                  mixes ? `${mixes} ${mixes === 1 ? 'mix' : 'mixes'}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                actions={
                  <>
                    {(hasStems || song || splitting !== null) && (
                      <Button
                        variant="ghost"
                        aria-label={`${song ? 'Edit mix' : 'Stems'}: ${track.title}`}
                        title={song ? 'Edit this mix' : 'Stems and mixes'}
                        disabled={!connected}
                        onClick={openStems}
                      >
                        <Faders aria-hidden="true" />
                        <span className="media-stems-label">
                          {song ? 'Edit' : 'Stems'}
                        </span>
                      </Button>
                    )}
                    {playing ? (
                      <Button
                        variant="outline"
                        aria-label={`Pause ${track.title}`}
                        disabled={!connected}
                        onClick={() => void send({ kind: 'pause' }, track.id)}
                      >
                        <Pause aria-hidden="true" weight="fill" />
                        Pause
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        aria-label={`Play ${track.title}`}
                        disabled={!connected}
                        onClick={() => void play(track)}
                      >
                        <Play aria-hidden="true" weight="fill" />
                        Play
                      </Button>
                    )}
                  </>
                }
                menu={menu}
              />
            );
          })}
        </ol>
      )}
      {!!library?.quarantined.length && (
        <p className="caption">
          {library.quarantined.length === 1
            ? 'One file failed its check and is kept aside on the device.'
            : `${library.quarantined.length} files failed their check and are kept aside on the device.`}
        </p>
      )}
      <p className="caption">
        Imports are levelled to −18 LUFS and prepared for the audio rate.
        Playing, pausing and skipping work with Protect on.
      </p>
      {dialog?.kind === 'rename' && (
        <RenameDialog asset={dialog.asset} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteDialog asset={dialog.asset} onClose={() => setDialog(null)} />
      )}
    </section>
  );
}
