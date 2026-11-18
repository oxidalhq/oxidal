import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import type {
  MediaAsset,
  PlayerSnapshot,
  SavedSongMix,
  SongView,
} from '../../api';
import { SplitStatus } from './NowPlaying';
import { type SessionMedia, SessionMediaContext } from './sessionMedia';
import { StemMixEditor } from './StemMixEditor';
import { LiveStemsPanel } from './StemMixer';
import { StemSongs } from './StemSongs';

const source: MediaAsset = {
  id: 'song',
  schema: 1,
  title: 'Practice song',
  kind: 'backing',
  created_at: '2026-11-15T00:00:00.000Z',
  renders: [],
};
const neutral = { muted: false, solo: false, gain_tenths_db: 0 };
const mix: SavedSongMix = {
  id: 'mix',
  revision: 'one',
  asset: 'render',
  title: 'No guitar',
  split: 'six',
  recipe: {
    mode: 'six',
    vocals: neutral,
    drums: neutral,
    bass: neutral,
    other: neutral,
    guitar: { ...neutral, muted: true },
    piano: neutral,
  },
};
const song: SongView = {
  source: source.id,
  splits: [
    {
      id: 'four',
      mode: 'four',
      frames: 48000,
      rate: 48000,
      sourceSha256: 'match',
      modelSha256: 'four',
    },
    {
      id: 'six',
      mode: 'six',
      frames: 48000,
      rate: 48000,
      sourceSha256: 'match',
      modelSha256: 'six',
    },
  ],
  mixes: [mix],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('opens uploaded stems without the local model and shows only the supplied parts', async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      source: source.id,
      splits: [
        {
          ...song.splits[1],
          importedRoles: ['bass', 'guitar'],
          modelSha256: null,
        },
      ],
      mixes: [],
    }),
  );
  vi.stubGlobal('fetch', fetch);
  render(<StemMixEditor source={source} locked={false} onClose={() => {}} />);
  expect(
    await screen.findByRole('button', { name: 'Mute Guitar' }),
  ).toBeVisible();
  expect(screen.getByRole('button', { name: 'Solo Bass' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Mute Piano' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Split song' })).toBeNull();
  // Starting points only name the parts this song has.
  expect(screen.getByRole('button', { name: 'No guitar' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'No vocals' })).toBeNull();
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/v1/media/songs/song');
});

it.each(['wav', 'mp3'])(
  'offers both split modes for an existing %s track and shows progress',
  async (container) => {
    const started: unknown[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/split-options'))
        return Response.json({ modes: ['four', 'six'] });
      if (url.endsWith('/split-job') && init?.method === 'POST') {
        started.push(JSON.parse(String(init.body)));
        return Response.json({
          id: 'job',
          requestId: 'r',
          mode: 'four',
          phase: 'running',
          error: null,
          progress: { stage: 'separating', percent: 40 },
        });
      }
      if (url.endsWith('/split-job')) return Response.json(null);
      return Response.json({ source: source.id, splits: [], mixes: [] });
    });
    vi.stubGlobal('fetch', fetch);
    render(
      <StemMixEditor
        source={{
          ...source,
          source: {
            file: `original.${container}`,
            bytes: 100,
            sha256: 'source-hash',
            container,
            codec: container === 'wav' ? 'pcm' : 'mp3',
            rate: 44100,
            channels: 2,
            frames: 44100,
            lossy: container === 'mp3',
          },
        }}
        locked={false}
        onClose={() => {}}
      />,
    );
    const split = await screen.findByRole('button', { name: 'Split song' });
    expect(screen.getByRole('radio', { name: /6 stems/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /4 stems/ }));
    fireEvent.click(split);
    await waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '40',
      ),
    );
    expect(started).toMatchObject([{ mode: 'four' }]);
    expect(screen.getByRole('button', { name: 'Cancel split' })).toBeVisible();
  },
);

it('restores mute, undoes an edit, saves the new level and switches to four stems', async () => {
  const updates: unknown[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const update = JSON.parse(String(init.body)) as {
        recipe: SavedSongMix['recipe'];
      };
      updates.push(update);
      return Response.json({ ...mix, revision: 'two', recipe: update.recipe });
    }
    if (url.endsWith('/split-options'))
      return Response.json({ modes: ['four', 'six'] });
    if (url.endsWith('/split-job')) return Response.json(null);
    return Response.json(song);
  });
  vi.stubGlobal('fetch', fetch);
  render(<StemMixEditor source={source} locked={false} onClose={() => {}} />);

  const mute = await screen.findByRole('button', { name: 'Mute Guitar' });
  expect(mute).toHaveAttribute('aria-pressed', 'true');
  expect(
    within(screen.getByRole('group', { name: 'Start from' })).getByRole(
      'button',
      { name: 'No guitar' },
    ),
  ).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(mute);
  expect(mute).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
  expect(mute).toHaveAttribute('aria-pressed', 'true');
  const drums = screen.getByRole('slider', { name: 'Drums level' });
  for (let step = 0; step < 5; step += 1)
    fireEvent.keyDown(drums, { key: 'ArrowRight' });
  expect(
    screen.getByRole('button', { name: /^Drums \+2\.5 dB/ }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByText('Saved')).toBeVisible());
  expect(updates).toEqual([
    {
      title: 'No guitar',
      split: 'six',
      replace: { id: 'mix', revision: 'one' },
      recipe: { ...mix.recipe, drums: { ...neutral, gain_tenths_db: 25 } },
    },
  ]);
  expect(screen.getByRole('link', { name: 'All stems (ZIP)' })).toHaveAttribute(
    'href',
    '/api/v1/media/songs/song/splits/six/stems.zip',
  );
  fireEvent.mouseDown(screen.getByRole('radio', { name: '4 stems' }));
  fireEvent.click(screen.getByRole('radio', { name: '4 stems' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Mute Guitar' })).toBeNull(),
  );
  expect(
    screen.getByRole('link', { name: 'Download Drums WAV' }),
  ).toHaveAttribute(
    'href',
    '/api/v1/media/songs/song/splits/four/stems/drums/wav',
  );
});

it('applies a starting point and names a new mix after it', async () => {
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/split-options'))
      return Response.json({ modes: ['four', 'six'] });
    if (url.endsWith('/split-job')) return Response.json(null);
    return Response.json({ ...song, mixes: [] });
  });
  vi.stubGlobal('fetch', fetch);
  render(<StemMixEditor source={source} locked={false} onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: 'No vocals' }));
  expect(screen.getByRole('button', { name: 'Mute Vocals' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByLabelText('Mix name')).toHaveValue(
    'Practice song – No vocals',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Drums and bass' }));
  expect(screen.getByLabelText('Mix name')).toHaveValue(
    'Practice song – Drums and bass',
  );
  expect(screen.getByRole('button', { name: 'Mute Other' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(screen.getByRole('button', { name: 'Mute Drums' })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
});

const player = (extra: Partial<PlayerSnapshot> = {}): PlayerSnapshot => ({
  state: 'ready',
  frame: 0,
  repeat: false,
  levelDb: -6,
  order: [source.id],
  revision: 1,
  underruns: 0,
  track: {
    id: source.id,
    title: source.title,
    frames: 48000,
    rate: 48000,
    channels: 2,
    trimDb: 0,
  },
  ...extra,
});

function session(
  snapshot: PlayerSnapshot,
  overrides: Partial<SessionMedia> = {},
) {
  const send = vi.fn(async () => true);
  const value: SessionMedia = {
    ready: true,
    player: snapshot,
    receivedAt: 0,
    shown: snapshot.state,
    muted: false,
    slow: false,
    pending: false,
    refusal: '',
    clearRefusal: vi.fn(),
    notice: '',
    send,
    library: { assets: [source], quarantined: [], usedBytes: 0 },
    libraryError: '',
    refreshLibrary: vi.fn(),
    tracks: [source],
    uploads: [],
    queue: null,
    sheet: null,
    setSheet: vi.fn(),
    ...overrides,
  };
  const wrap = (ui: ReactNode) => (
    <SessionMediaContext.Provider value={value}>
      {ui}
    </SessionMediaContext.Provider>
  );
  return { value, send, wrap };
}

function songFetch() {
  return vi.fn(async (url: string) => {
    if (url.endsWith('/split-options'))
      return Response.json({ modes: ['four', 'six'] });
    if (url.endsWith('/split-job')) return Response.json(null);
    return Response.json(song);
  });
}

it('plays the stems live from the editor and sends each change as it is made', async () => {
  vi.stubGlobal('fetch', songFetch());
  const { send, wrap, value } = session(player());
  const view = render(
    wrap(<StemMixEditor source={source} locked={false} onClose={() => {}} />),
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Play the stems' }),
  );
  await waitFor(() => expect(send).toHaveBeenCalledWith({ kind: 'play' }));
  expect(send).toHaveBeenCalledWith({
    kind: 'cue_stems',
    source: 'song',
    split: 'six',
    recipe: mix.recipe,
  });

  // The device now reports these stems playing live.
  const live = player({
    state: 'playing',
    stems: { source: 'song', split: 'six', roles: [], recipe: mix.recipe },
  });
  view.rerender(
    <SessionMediaContext.Provider
      value={{ ...value, player: live, shown: 'playing' }}
    >
      <StemMixEditor source={source} locked={false} onClose={() => {}} />
    </SessionMediaContext.Provider>,
  );
  expect(screen.getByText('Playing the stems live')).toBeVisible();
  send.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Mute Vocals' }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      kind: 'set_stem_mix',
      recipe: { ...mix.recipe, vocals: { ...neutral, muted: true } },
    }),
  );
});

it('asks in an Oxidal dialog before replacing another playing track', async () => {
  vi.stubGlobal('fetch', songFetch());
  const confirm = vi.spyOn(window, 'confirm');
  const other = player({
    state: 'playing',
    track: {
      id: 'other',
      title: 'Encore',
      frames: 1,
      rate: 48000,
      channels: 2,
      trimDb: 0,
    },
  });
  const { send, wrap } = session(other);
  render(
    wrap(<StemMixEditor source={source} locked={false} onClose={() => {}} />),
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Play the stems' }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: 'Play these stems?',
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Play these stems?' }),
    ).toBeNull(),
  );
  expect(send).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
});

it('lets the player change a playing mix stem by stem and save it to that mix', async () => {
  const mixTrack: MediaAsset = {
    ...source,
    id: 'render',
    title: 'Practice song – No guitar',
    provenance: { splitMix: { source: 'song', mix: 'mix' } },
  };
  const saves: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        saves.push(JSON.parse(String(init.body)));
        return Response.json({ ...mix, revision: 'two' });
      }
      return Response.json(song);
    }),
  );
  const live = player({
    state: 'playing',
    track: {
      id: 'render',
      title: mixTrack.title,
      frames: 48000,
      rate: 48000,
      channels: 2,
      trimDb: 0,
    },
    stems: {
      source: 'song',
      split: 'six',
      roles: ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'],
      recipe: mix.recipe,
    },
  });
  const { send, wrap } = session(live, { tracks: [source, mixTrack] });
  render(wrap(<LiveStemsPanel />));
  const guitar = screen.getByRole('button', { name: 'Mute Guitar' });
  expect(guitar).toHaveAttribute('aria-pressed', 'true');
  // Other is listed last, as in the editor.
  expect(screen.getAllByRole('listitem').at(-1)).toHaveTextContent('Other');
  fireEvent.click(guitar);
  const unmuted = { ...mix.recipe, guitar: neutral };
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith({
      kind: 'set_stem_mix',
      recipe: unmuted,
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save to this mix' }));
  await waitFor(() =>
    expect(screen.getByText('Saved to “No guitar”.')).toBeVisible(),
  );
  expect(saves).toEqual([
    {
      title: 'No guitar',
      split: 'six',
      recipe: unmuted,
      replace: { id: 'mix', revision: 'one' },
    },
  ]);
});

it('lists songs with stems, plays a mix and offers only unsplit tracks to split', async () => {
  const plain: MediaAsset = {
    ...source,
    id: 'plain',
    title: 'Encore',
    source: {
      file: 'original.wav',
      bytes: 100,
      sha256: 'x',
      container: 'wav',
      codec: 'pcm',
      rate: 48000,
      channels: 2,
      frames: 48000,
      lossy: false,
    },
  };
  const split = { ...plain, id: 'song', title: 'Practice song' };
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ songs: [song] })),
  );
  const { send, wrap } = session(player({ track: null, state: 'empty' }), {
    tracks: [split, plain],
  });
  render(wrap(<StemSongs connected />));
  expect(await screen.findByText('Practice song')).toBeVisible();
  expect(screen.getByText(/0:01 · 4 stems · 6 stems/)).toBeVisible();
  expect(screen.getByText('Guitar muted')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Play No guitar' }));
  await waitFor(() => expect(send).toHaveBeenCalledWith({ kind: 'play' }));
  expect(send).toHaveBeenCalledWith({ kind: 'cue', asset: 'render' });
  fireEvent.click(screen.getByRole('button', { name: /Split a track/ }));
  const picker = await screen.findByRole('dialog', { name: 'Split a track' });
  expect(
    within(picker).getAllByRole('button', { name: /Encore/ }),
  ).toHaveLength(1);
  expect(
    within(picker).queryByRole('button', { name: /Practice song/ }),
  ).toBeNull();
});

it('shows a running split on every page and opens its stems', () => {
  const { value, wrap } = session(player({ track: null, state: 'empty' }), {
    split: { source: 'song', mode: 'six', percent: 42, phase: 'running' },
  });
  render(wrap(<SplitStatus />));
  const chip = screen.getByRole('button', {
    name: 'Splitting Practice song, 42%. Open stems',
  });
  expect(chip).toHaveTextContent('42%');
  fireEvent.click(chip);
  expect(value.setSheet).toHaveBeenCalledWith({
    kind: 'stems',
    source: 'song',
  });
});
