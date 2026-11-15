/**
 * Library › Stems: every song with stems and its saved mixes, with Split and
 * Import as the ways in. Mixes play their stems live in the backing player.
 *
 * @see docs/media.md#stem-mix-recipes
 */
import { useCallback, useEffect, useState } from 'react';
import { Faders, FilePlus, Pause, Play, Scissors } from '@phosphor-icons/react';
import { songList, type MediaAsset, type SongList } from '../../api';
import { AdjustmentDialog } from '../../AdjustmentDialog';
import { deviceSentence } from '../../lib/friendlyError';
import { formatTime } from '../../lib/playerClock';
import { Button } from '../ui/button';
import { useConfirm } from '../ui/confirm';
import {
  PROTECT_REASON,
  canSplitBackingTrack,
  durationOf,
  mixSourceOf,
  useProtect,
  useSessionMedia,
} from './sessionMedia';
import { StateChip } from './StateChip';
import { StemImportForm } from './StemImportForm';
import { describeRecipe, splitLabel, splitRoles } from './stemMix';
import './media.css';

export function StemSongs({ connected }: { connected: boolean }) {
  const media = useSessionMedia();
  const { tracks, player, send, library } = media;
  const protect = useProtect();
  const locked = protect || !connected;
  const { ask, dialog } = useConfirm();
  const [list, setList] = useState<SongList | null>(null);
  const [error, setError] = useState('');
  const open = (source: MediaAsset, mix?: string) =>
    media.setSheet({ kind: 'stems', source: source.id, mix });
  const [importing, setImporting] = useState(false);
  const [picking, setPicking] = useState(false);

  const load = useCallback(() => {
    songList().then(
      (result) => {
        setList(result);
        setError('');
      },
      (cause: unknown) => setError(deviceSentence(cause, 'load the stems')),
    );
  }, []);
  // The library object changes whenever tracks are added, renamed or removed.
  useEffect(load, [load, library]);

  const running = media.split?.phase === 'running' ? media.split : null;
  const songs = (list?.songs ?? []).flatMap((song) => {
    const asset = tracks.find((track) => track.id === song.source);
    return asset ? [{ song, asset }] : [];
  });
  const splittable = tracks.filter(
    (track) =>
      canSplitBackingTrack(track) &&
      !mixSourceOf(track) &&
      !songs.some(({ asset }) => asset.id === track.id),
  );

  async function playMix(asset: string, title: string) {
    const cued = player?.track?.id === asset;
    if (cued && player.state === 'playing') {
      await send({ kind: 'pause' });
      return;
    }
    if (
      !cued &&
      player?.state === 'playing' &&
      !(await ask({
        title: `Play “${title}”?`,
        body: `“${player.track?.title ?? 'Another track'}” is playing. It stops and this mix starts.`,
        confirm: 'Stop and play',
      }))
    )
      return;
    if (cued || (await send({ kind: 'cue', asset })))
      await send({ kind: 'play' });
  }

  return (
    <section className="media-backing" aria-label="Stems">
      <div className="media-section-head">
        <div>
          <h2>Stems</h2>
          <p className="caption">
            Split a song into its parts, mute or level each one as it plays, and
            save mixes for the Set list and your rigs.
          </p>
        </div>
        <div className="media-section-meta">
          <Button disabled={locked} onClick={() => setPicking(true)}>
            <Scissors aria-hidden="true" />
            Split a track…
          </Button>
          <Button
            variant="outline"
            disabled={locked}
            onClick={() => setImporting(true)}
          >
            <FilePlus aria-hidden="true" />
            Import stems…
          </Button>
        </div>
      </div>
      {protect && <p className="caption">{PROTECT_REASON}</p>}
      {error && (
        <p role="alert" className="media-note">
          {error}
        </p>
      )}
      {running && !songs.some(({ asset }) => asset.id === running.source) && (
        <div className="stem-song" role="status">
          <div className="stem-song-head">
            <div className="stem-song-title">
              <strong>
                {tracks.find((track) => track.id === running.source)?.title ??
                  'Song'}
              </strong>
              <span className="caption">
                Splitting into {running.mode === 'six' ? 6 : 4} stems ·{' '}
                {running.percent}%
              </span>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                media.setSheet({ kind: 'stems', source: running.source })
              }
            >
              <Faders aria-hidden="true" />
              Open
            </Button>
          </div>
          <div className="stem-bar" aria-hidden="true">
            <i style={{ width: `${running.percent}%` }} />
          </div>
        </div>
      )}
      {list && !songs.length && !running && (
        <p className="caption">
          No songs with stems yet. Split one of your backing tracks, or import
          stems exported from another app.
        </p>
      )}
      <ul className="stem-songs" aria-label="Songs with stems">
        {songs.map(({ song, asset }) => (
          <li key={asset.id} className="stem-song">
            <div className="stem-song-head">
              <div className="stem-song-title">
                <strong>
                  {asset.title}{' '}
                  {running?.source === asset.id && (
                    <span className="media-chip" data-kind="stems">
                      Splitting {running.percent}%
                    </span>
                  )}
                </strong>
                <span className="caption">
                  {[
                    formatTime(durationOf(asset)),
                    ...song.splits.map((split) =>
                      splitLabel(split, song.splits),
                    ),
                  ].join(' · ')}
                </span>
              </div>
              <Button
                variant="outline"
                disabled={!connected}
                onClick={() => open(asset)}
              >
                <Faders aria-hidden="true" />
                Open
              </Button>
            </div>
            {song.mixes.length ? (
              <ul
                className="stem-song-mixes"
                aria-label={`${asset.title} mixes`}
              >
                {song.mixes.map((mix) => {
                  const split = song.splits.find((s) => s.id === mix.split);
                  const cued = player?.track?.id === mix.asset;
                  const playing = cued && player?.state === 'playing';
                  const prefix = `${asset.title} – `;
                  const name = mix.title.startsWith(prefix)
                    ? mix.title.slice(prefix.length)
                    : mix.title;
                  return (
                    <li key={mix.id}>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`${playing ? 'Pause' : 'Play'} ${mix.title}`}
                        disabled={!connected}
                        onClick={() => void playMix(mix.asset, mix.title)}
                      >
                        {playing ? (
                          <Pause aria-hidden="true" weight="fill" />
                        ) : (
                          <Play aria-hidden="true" weight="fill" />
                        )}
                      </Button>
                      <span className="stem-song-mix">
                        <strong>{name}</strong>
                        <span className="caption">
                          {split
                            ? describeRecipe(mix.recipe, splitRoles(split))
                            : ''}
                        </span>
                      </span>
                      {cued && (
                        <StateChip state={playing ? 'playing' : 'cued'} />
                      )}
                      <Button
                        variant="ghost"
                        disabled={!connected}
                        onClick={() => open(asset, mix.id)}
                      >
                        Edit
                      </Button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="caption">
                No saved mixes yet. Open it to play the stems and make one.
              </p>
            )}
          </li>
        ))}
      </ul>

      {picking && (
        <AdjustmentDialog
          title="Split a track"
          description="Choose a backing track to separate"
          onCancel={() => setPicking(false)}
        >
          <div className="media-dialog-form">
            {splittable.length ? (
              <ul className="stem-pick" aria-label="Backing tracks to split">
                {splittable.map((track) => (
                  <li key={track.id}>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPicking(false);
                        open(track);
                      }}
                    >
                      <span>{track.title}</span>
                      <span className="caption">
                        {formatTime(durationOf(track))}
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="caption">
                Every WAV and MP3 already has stems. Import a new one in Backing
                tracks first.
              </p>
            )}
          </div>
        </AdjustmentDialog>
      )}
      {importing && (
        <StemImportForm
          locked={locked}
          onClose={() => setImporting(false)}
          onImported={(song) => {
            setImporting(false);
            media.refreshLibrary();
            open(song);
          }}
        />
      )}
      {dialog}
    </section>
  );
}
