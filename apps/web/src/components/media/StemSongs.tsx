/**
 * Library › Stems: every song with stems and its saved mixes, with Split and
 * Import as the ways in. Mixes play their stems live in the backing player.
 *
 * @see docs/media.md#stem-mix-recipes
 */
import { Faders, FilePlus, Pause, Play, Scissors } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { useConfirm } from '@oxidal/design-system/components/confirm';
import { Progress } from '@oxidal/design-system/components/states';
import { Caption } from '@oxidal/design-system/components/text';
import { useRemembered } from '@oxidal/design-system/lib/use-remembered';
import {
  type LibraryItem,
  LibraryList,
} from '@oxidal/design-system/patterns/library-list';

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
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  // Favourites are kept on this browser, as the list's star promises.
  const [favourites, setFavourites] = useRemembered<string[]>(
    'oxidal.stems.favourites',
    [],
  );
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

  const items: LibraryItem[] = songs.map(({ song, asset }) => {
    const first = song.mixes[0];
    const cued = !!first && player?.track?.id === first.asset;
    const playing = cued && player?.state === 'playing';
    return {
      id: asset.id,
      title: asset.title,
      caption: [
        formatTime(durationOf(asset)),
        ...song.splits.map((split) => splitLabel(split, song.splits)),
        song.mixes.length
          ? `${song.mixes.length} ${song.mixes.length === 1 ? 'mix' : 'mixes'}`
          : 'no saved mixes',
      ].join(' · '),
      playable: connected && !!first,
      badge:
        running?.source === asset.id
          ? { text: `Splitting ${running.percent}%` }
          : cued
            ? { text: playing ? 'Playing' : 'Cued', tone: 'live' }
            : undefined,
      favourite: favourites.includes(asset.id),
      facts: [
        ['Length', formatTime(durationOf(asset))],
        [
          'Stems',
          song.splits.map((split) => splitLabel(split, song.splits)).join(', '),
        ],
        ['Mixes', String(song.mixes.length)],
      ],
    };
  });
  const songOf = (id: string) => songs.find(({ asset }) => asset.id === id);
  return (
    <section className="grid min-w-0 gap-3" aria-label="Stems">
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
          className="grid min-w-0 gap-2 border-b border-border pb-3"
          role="status"
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="grid min-w-0 gap-0.5">
              <strong className="text-sm">
                {tracks.find((track) => track.id === running.source)?.title ??
                  'Song'}
              </strong>
              <Caption as="span" className="text-xs">
                Splitting into {running.mode === 'six' ? 6 : 4} stems ·{' '}
                {running.percent}%
              </Caption>
            </div>
            <Button
              size="sm"
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
      <LibraryList
        items={items}
        query={query}
        onQuery={setQuery}
        searchLabels={{
          input: 'Search songs with stems',
          clear: 'Clear stem search',
          placeholder: 'Find a song…',
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
          const first = songOf(id)?.song.mixes[0];
          if (first) void playMix(first.asset, first.title);
        }}
        tile={<Faders />}
        noun={['song', 'songs']}
        primary={
          <>
            <Button
              size="sm"
              disabled={locked}
              onClick={() => setPicking(true)}
            >
              <Scissors aria-hidden="true" />
              Split a track…
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={locked}
              onClick={() => setImporting(true)}
            >
              <FilePlus aria-hidden="true" />
              Import stems…
            </Button>
          </>
        }
        empty={{
          title: list ? 'No songs with stems yet' : 'Reading stems…',
          text: list
            ? 'Split one of your backing tracks, or import stems exported from another app.'
            : undefined,
        }}
        mainAction={() => ({
          label: 'Open mixer',
          icon: <Faders />,
          disabled: !connected,
          run: (id) => {
            const found = songOf(id);
            if (found) open(found.asset);
          },
        })}
        detail={(item) => {
          const found = songOf(item.id);
          if (!found) return null;
          const { song, asset } = found;
          return song.mixes.length ? (
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
                      size="icon-sm"
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
                      <strong className="text-sm">{name}</strong>
                      <Caption as="span" className="text-xs">
                        {split
                          ? describeRecipe(mix.recipe, splitRoles(split))
                          : ''}
                      </Caption>
                    </span>
                    {cued && <StateChip state={playing ? 'playing' : 'cued'} />}
                    <Button
                      size="sm"
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
            <Caption className="text-xs">
              No saved mixes yet. Open the mixer to play the stems and make one.
            </Caption>
          );
        }}
      />
      <Caption className="text-xs">
        Split a song into its parts, mute or level each one as it plays, and
        save mixes for the Set list and your rigs.
      </Caption>

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
