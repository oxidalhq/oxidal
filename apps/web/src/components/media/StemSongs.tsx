/**
 * Library › Stems: every song with stems and its saved mixes, with Split and
 * Import as the ways in. Mixes play their stems live in the backing player.
 *
 * @see docs/media.md#stem-mix-recipes
 */
import { Faders, FilePlus, Pause, Play, Scissors } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@oxidal/design-system/components/badge';
import { Button } from '@oxidal/design-system/components/button';
import { ActionRow } from '@oxidal/design-system/components/form-layout';
import { useConfirm } from '@oxidal/design-system/components/confirm';
import { Progress } from '@oxidal/design-system/components/states';
import { Caption, Title } from '@oxidal/design-system/components/text';

import { AdjustmentDialog } from '../../AdjustmentDialog';
import { type MediaAsset, type SongList, songList } from '../../api';
import { deviceSentence } from '../../lib/friendlyError';
import { formatTime } from '../../lib/playerClock';
import {
  canSplitBackingTrack,
  durationOf,
  mixSourceOf,
  PROTECT_REASON,
  useProtect,
  useSessionMedia,
} from './sessionMedia';
import { StateChip } from './StateChip';
import { StemImportForm } from './StemImportForm';
import { describeRecipe, splitLabel, splitRoles } from './stemMix';

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
      await send({ kind: 'pause' }, asset);
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
      await send({ kind: 'play' }, asset);
  }

  return (
    <section className="grid min-w-0 gap-3" aria-label="Stems">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 [&>h2]:m-0 [&>h3]:m-0 [&>h3]:text-base [&>h3]:font-semibold">
        <div>
          <Title as="h2" size="sm">
            Stems
          </Title>
          <Caption>
            Split a song into its parts, mute or level each one as it plays, and
            save mixes for the Set list and your rigs.
          </Caption>
        </div>
        <ActionRow>
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
        </ActionRow>
      </div>
      {protect && <Caption>{PROTECT_REASON}</Caption>}
      {(error || media.refusal) && (
        <p
          role="alert"
          className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0"
        >
          {error || media.refusal}
        </p>
      )}
      {running && !songs.some(({ asset }) => asset.id === running.source) && (
        <div
          className="grid min-w-0 gap-2 rounded-lg border border-border bg-card p-3"
          role="status"
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 [&>h2]:m-0 [&>h3]:m-0 [&>h3]:text-base [&>h3]:font-semibold">
            <div className="grid min-w-0 gap-0.5">
              <strong>
                {tracks.find((track) => track.id === running.source)?.title ??
                  'Song'}
              </strong>
              <Caption as="span">
                Splitting into {running.mode === 'six' ? 6 : 4} stems ·{' '}
                {running.percent}%
              </Caption>
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
          <Progress label="Stem split progress" value={running.percent} />
        </div>
      )}
      {list && !songs.length && !running && (
        <Caption>
          No songs with stems yet. Split one of your backing tracks, or import
          stems exported from another app.
        </Caption>
      )}
      <ul
        className="m-0 grid min-w-0 list-none gap-3 p-0"
        aria-label="Songs with stems"
      >
        {songs.map(({ song, asset }) => (
          <li
            key={asset.id}
            className="grid min-w-0 gap-2 rounded-lg border border-border bg-card p-3"
          >
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 [&>h2]:m-0 [&>h3]:m-0 [&>h3]:text-base [&>h3]:font-semibold">
              <div className="grid min-w-0 gap-0.5">
                <strong>
                  {asset.title}{' '}
                  {running?.source === asset.id && (
                    <Badge data-kind="stems">
                      Splitting {running.percent}%
                    </Badge>
                  )}
                </strong>
                <Caption as="span">
                  {[
                    formatTime(durationOf(asset)),
                    ...song.splits.map((split) =>
                      splitLabel(split, song.splits),
                    ),
                  ].join(' · ')}
                </Caption>
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
                className="m-0 grid list-none gap-1 p-0 [&>li]:flex [&>li]:min-w-0 [&>li]:flex-wrap [&>li]:items-center [&>li]:gap-2"
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
                      <span className="grid min-w-0 flex-1 gap-0.5 [&>[data-slot=caption]]:truncate">
                        <strong>{name}</strong>
                        <Caption as="span">
                          {split
                            ? describeRecipe(mix.recipe, splitRoles(split))
                            : ''}
                        </Caption>
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
              <Caption>
                No saved mixes yet. Open it to play the stems and make one.
              </Caption>
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
          <div className="grid min-w-0 gap-3">
            {splittable.length ? (
              <ul
                className="flex flex-wrap items-center gap-1"
                aria-label="Backing tracks to split"
              >
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
                      <Caption as="span">
                        {formatTime(durationOf(track))}
                      </Caption>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <Caption>
                Every WAV and MP3 already has stems. Import a new one in Backing
                tracks first.
              </Caption>
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
