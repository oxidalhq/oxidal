import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  type MediaAsset,
  mediaLibrary,
  type Monitoring,
  monitoring,
  playerCommand,
  type PlayerSnapshot,
  protectState,
  setPlayerOrder,
} from '../../api';
import { DeviceError } from '../../lib/friendlyError';
import { publishPlayer } from '../../lib/playerFeed';
import { useMonitorFeed } from '../../monitorFeed';
import { BackingTracks } from './BackingTracks';
import { NowPlaying } from './NowPlaying';
import { PerformPlayerRow } from './PerformPlayerRow';
import { MediaSheets } from './PlayerSheet';
import { type SessionMedia, SessionMediaContext } from './sessionMedia';
import { SessionMediaProvider } from './SessionMediaProvider';

vi.mock('../../api', async (original) => ({
  ...(await original<typeof import('../../api')>()),
  mediaLibrary: vi.fn(),
  monitoring: vi.fn(),
  playerCommand: vi.fn(),
  protectState: vi.fn(),
  setPlayerOrder: vi.fn(),
}));

const asset = (id: string, title: string, seconds: number): MediaAsset => ({
  id,
  title,
  kind: 'backing',
  schema: 1,
  created_at: `2026-11-11T10:00:0${id.length}Z`,
  playback: { trim_db: -6.2 },
  source: {
    bytes: 8_700_000,
    channels: 2,
    codec: 'mp3',
    container: 'mp3',
    file: 'original.mp3',
    frames: 44100 * seconds,
    lossy: true,
    rate: 44100,
    sha256: 'x',
  },
  renders: [
    {
      channels: 2,
      file: 'play-48000.f32',
      frames: 48000 * seconds,
      rate: 48000,
      sha256: 'y',
      loudness_lufs: -11.8,
      peak_dbfs: -0.4,
    },
  ],
});
const tracks = [
  asset('t1', 'Rehearsal 01', 222),
  asset('t2', 'Rehearsal 02', 245),
];
const snapshot = (
  state: PlayerSnapshot['state'],
  seconds = 72,
  extra: Partial<PlayerSnapshot> = {},
): PlayerSnapshot => ({
  state,
  frame: 48000 * seconds,
  repeat: false,
  levelDb: -6,
  order: ['t1', 't2'],
  revision: 3,
  underruns: 0,
  track:
    state === 'empty'
      ? null
      : {
          id: 't1',
          title: 'Rehearsal 01',
          frames: 48000 * 222,
          rate: 48000,
          channels: 2,
          trimDb: -6.2,
        },
  ...extra,
});

function media(overrides: Partial<SessionMedia> = {}): SessionMedia {
  const player = overrides.player ?? snapshot('ready', 0);
  return {
    ready: true,
    player,
    receivedAt: 0,
    shown: player.track ? player.state : 'empty',
    muted: false,
    slow: false,
    pending: false,
    refusal: '',
    clearRefusal: vi.fn(),
    notice: '',
    send: vi.fn(async () => true),
    library: { assets: tracks, quarantined: [], usedBytes: 0 },
    libraryError: '',
    refreshLibrary: vi.fn(),
    tracks,
    uploads: [],
    queue: null,
    sheet: null,
    setSheet: vi.fn(),
    ...overrides,
  };
}
const withMedia = (value: SessionMedia, ui: ReactNode) =>
  render(
    <SessionMediaContext.Provider value={value}>
      {ui}
    </SessionMediaContext.Provider>,
  );

beforeEach(() => {
  vi.mocked(protectState).mockResolvedValue({ on: false });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('hides the mini-player until a track is cued', () => {
  const view = withMedia(
    media({ player: snapshot('empty') }),
    <NowPlaying placement="masthead" />,
  );
  expect(screen.queryByRole('region', { name: 'Now playing' })).toBeNull();
  view.rerender(
    <SessionMediaContext.Provider value={{ ...media(), ready: false }}>
      <NowPlaying placement="masthead" />
    </SessionMediaContext.Provider>,
  );
  expect(screen.queryByRole('region', { name: 'Now playing' })).toBeNull();
});

it.each([
  ['ready', ['Play'], '0:00 / 3:42', 'Ready'],
  ['playing', ['Pause', 'Stop track'], '1:12 / 3:42', null],
  ['paused', ['Play', 'Stop track'], '1:12 / 3:42', 'Paused'],
  ['ended', ['Play again', 'Next'], '3:42 / 3:42', 'Ended'],
  [
    'interrupted',
    ['Resume', 'Stop track'],
    'Audio restarted at 1:12',
    'Stopped',
  ],
] as const)(
  'shows %s in words with its transport',
  (state, buttons, time, chip) => {
    const value = media({ player: snapshot(state) });
    withMedia(value, <NowPlaying placement="bottom" />);
    const bar = screen.getByRole('region', { name: 'Now playing' });
    const group = within(bar).getByRole('group', {
      name: 'Backing track transport',
    });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(buttons);
    expect(bar).toHaveTextContent(time);
    if (chip) expect(bar).toHaveTextContent(chip);
    fireEvent.click(within(group).getAllByRole('button')[0]!);
    expect(value.send).toHaveBeenCalledWith({
      kind: state === 'playing' ? 'pause' : 'play',
    });
  },
);

it('explains a silent track and an unplayable one, and opens the full player', () => {
  const value = media({ player: snapshot('playing'), muted: true });
  const view = withMedia(value, <NowPlaying placement="masthead" />);
  expect(screen.getByText('Output muted')).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Open backing player: Rehearsal 01, Playing',
    }),
  );
  expect(value.setSheet).toHaveBeenCalledWith({ kind: 'player' });
  view.rerender(
    <SessionMediaContext.Provider
      value={media({
        player: snapshot('unavailable', 0, {
          reason: 'Prepared for 44.1 kHz; the audio runs at 48 kHz',
        }),
      })}
    >
      <NowPlaying placement="masthead" />
    </SessionMediaContext.Provider>,
  );
  expect(
    screen.getByText('Prepared for 44.1 kHz; the audio runs at 48 kHz'),
  ).toBeVisible();
  expect(screen.getByText('Not playable')).toBeVisible();
  expect(screen.queryByRole('group')).toBeNull();
});

it('full player: seek keys, repeat, level and the refusal', () => {
  const value = media({
    player: snapshot('paused'),
    sheet: { kind: 'player' },
    refusal: 'Start the audio to play the track.',
  });
  withMedia(value, <MediaSheets />);
  const sheet = screen.getByRole('dialog', { name: 'Backing player' });
  expect(within(sheet).getByRole('alert')).toHaveTextContent(
    'Start the audio to play the track.',
  );
  expect(sheet).toHaveTextContent('Stereo · MP3 · 3:42 · Paused');
  expect(sheet).toHaveTextContent('Next up: Rehearsal 02');
  const position = within(sheet).getByRole('slider', { name: 'Position' });
  expect(position).toHaveAttribute(
    'aria-valuetext',
    '1 minute 12 of 3 minutes 42',
  );
  fireEvent.keyDown(position, { key: 'ArrowRight' });
  expect(value.send).toHaveBeenLastCalledWith({
    kind: 'seek_to',
    frame: 48000 * 77,
  });
  fireEvent.keyDown(position, { key: 'PageDown' });
  expect(value.send).toHaveBeenLastCalledWith({
    kind: 'seek_to',
    frame: 48000 * 42,
  });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Repeat Track' }));
  expect(value.send).toHaveBeenLastCalledWith({
    kind: 'set_repeat',
    repeat: true,
  });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Next track' }));
  expect(value.send).toHaveBeenLastCalledWith({ kind: 'next' });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Stop track' }));
  expect(value.send).toHaveBeenLastCalledWith({ kind: 'stop' });
  fireEvent.change(within(sheet).getByRole('slider', { name: 'Level' }), {
    target: { value: '-12' },
  });
  expect(value.send).toHaveBeenLastCalledWith({ kind: 'set_level', db: -12 });
});

it('e-paper player: text state, 1 Hz time and step buttons, no drag', () => {
  const value = media({
    player: snapshot('playing'),
    sheet: { kind: 'player' },
    slow: true,
  });
  withMedia(value, <MediaSheets />);
  const sheet = screen.getByRole('dialog', { name: 'Backing player' });
  expect(within(sheet).queryByRole('slider')).toBeNull();
  expect(sheet).toHaveTextContent('PLAYING · Position 1:12 of 3:42');
  expect(sheet).toHaveTextContent('(updates every second)');
  for (const label of ['Previous', 'Back 10 s', 'Pause', 'Fwd 10 s', 'Next'])
    expect(within(sheet).getByRole('button', { name: label })).toBeVisible();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Back 10 s' }));
  expect(value.send).toHaveBeenLastCalledWith({
    kind: 'skip_by',
    seconds: -10,
  });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Lower level' }));
  expect(value.send).toHaveBeenLastCalledWith({ kind: 'set_level', db: -7 });
});

it('Backing list cues a track; Details shows the facts', () => {
  const value = media({ sheet: { kind: 'list' } });
  const view = withMedia(value, <MediaSheets />);
  const list = screen.getByRole('list', { name: 'Backing list' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  expect(within(list).getByText('Cued')).toBeVisible();
  fireEvent.click(
    within(list).getByRole('button', { name: 'Cue Rehearsal 02' }),
  );
  expect(value.send).toHaveBeenCalledWith({ kind: 'cue', asset: 't2' });
  view.rerender(
    <SessionMediaContext.Provider
      value={media({ sheet: { kind: 'details', asset: 't1' } })}
    >
      <MediaSheets />
    </SessionMediaContext.Provider>,
  );
  const details = screen.getByRole('dialog', {
    name: 'Rehearsal 01 · Details',
  });
  expect(details).toHaveTextContent('MP3 · 8.7 MB · mp3 · lossy');
  expect(details).toHaveTextContent('44.1 kHz · stereo · 3:42');
  expect(details).toHaveTextContent('-11.8 LUFS · peak -0.4 dBFS');
  expect(within(details).getByLabelText('Track trim (dB)')).toHaveValue(-6.2);
  expect(
    within(details).getByRole('link', { name: 'Download original' }),
  ).toHaveAttribute('href', '/api/v1/media/assets/t1/original');
});

it('Perform row: choose a track when empty; transport and Next when playing', () => {
  const empty = media({ player: snapshot('empty') });
  const view = withMedia(empty, <PerformPlayerRow />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose track' }));
  expect(empty.setSheet).toHaveBeenCalledWith({ kind: 'list' });
  const playing = media({ player: snapshot('playing'), muted: true });
  view.rerender(
    <SessionMediaContext.Provider value={playing}>
      <PerformPlayerRow />
    </SessionMediaContext.Provider>,
  );
  const row = screen.getByRole('region', { name: 'Backing track' });
  expect(row).toHaveTextContent('Rehearsal 01');
  expect(row).toHaveTextContent('1:12');
  expect(row).toHaveTextContent('Output muted');
  expect(
    within(row)
      .getAllByRole('button')
      .map((b) => b.textContent),
  ).toEqual(['Rehearsal 01', 'Pause', 'Stop track', 'Next']);
});

it('Library lists tracks in Backing order; Play cues then plays; Protect locks edits', async () => {
  const value = media({
    player: snapshot('ready', 0, { order: ['t2', 't1'] }),
    tracks: [tracks[1]!, tracks[0]!],
  });
  vi.mocked(setPlayerOrder).mockResolvedValue(snapshot('ready'));
  const view = withMedia(value, <BackingTracks connected />);
  const list = screen.getByRole('list', { name: 'Backing list' });
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.getAttribute('aria-label')),
  ).toEqual(['Rehearsal 02', 'Rehearsal 01']);
  fireEvent.click(screen.getByRole('button', { name: 'Play Rehearsal 02' }));
  await waitFor(() =>
    expect(value.send).toHaveBeenNthCalledWith(1, { kind: 'cue', asset: 't2' }),
  );
  await waitFor(() =>
    expect(value.send).toHaveBeenNthCalledWith(2, { kind: 'play' }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: 'More for Rehearsal 01' }),
  );
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move up' }));
  await waitFor(() =>
    expect(setPlayerOrder).toHaveBeenCalledWith(['t1', 't2']),
  );
  vi.mocked(protectState).mockResolvedValue({ on: true });
  view.unmount();
  withMedia(value, <BackingTracks connected />);
  expect(
    await screen.findByText(/Protect is on\. Turn Protect off to import/),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: /Import WAV or MP3…/ }),
  ).toBeDisabled();
  // Playing still works under Protect.
  expect(
    screen.getByRole('button', { name: 'Play Rehearsal 01' }),
  ).toBeEnabled();
});

it('provider: draws from the stream and sends one command path with IDs and the cue', async () => {
  vi.mocked(mediaLibrary).mockResolvedValue({
    assets: tracks,
    quarantined: [],
    usedBytes: 0,
  });
  vi.mocked(monitoring).mockResolvedValue({
    audio: { monitoring: { output_muted: false } },
  } as unknown as Monitoring);
  vi.mocked(playerCommand).mockRejectedValueOnce(
    new DeviceError('This is the last track', 'conflict', 409),
  );
  render(
    <SessionMediaProvider>
      <PerformPlayerRow />
      <MediaSheets />
    </SessionMediaProvider>,
  );
  act(() => publishPlayer(snapshot('ready', 0)));
  const row = await screen.findByRole('region', { name: 'Backing track' });
  fireEvent.click(within(row).getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(playerCommand).toHaveBeenCalledTimes(1));
  const request = vi.mocked(playerCommand).mock.calls[0]![0];
  expect(request).toMatchObject({
    origin: 'ui',
    expectedCue: 't1',
    command: { kind: 'next' },
  });
  expect(request.requestId).toMatch(/[0-9a-f-]{36}/);
  expect(await within(row).findByRole('alert')).toHaveTextContent(
    'This is the last track.',
  );
  // A reply never replaces a newer snapshot from the stream.
  vi.mocked(playerCommand).mockResolvedValueOnce(
    snapshot('ready', 0, { revision: 2 }),
  );
  act(() => publishPlayer(snapshot('paused', 30, { revision: 5 })));
  fireEvent.click(await within(row).findByRole('button', { name: 'Play' }));
  await waitFor(() => expect(playerCommand).toHaveBeenCalledTimes(2));
  expect(vi.mocked(playerCommand).mock.calls[1]![0].expectedCue).toBeNull();
  expect(row).toHaveTextContent('Paused');
  await waitFor(() => expect(mediaLibrary).toHaveBeenCalled());
});

it('provider: shares the monitor reader with other views and never writes while reading mute', async () => {
  vi.mocked(mediaLibrary).mockResolvedValue({
    assets: tracks,
    quarantined: [],
    usedBytes: 0,
  });
  vi.mocked(monitoring).mockResolvedValue({
    sequence: 100,
    audio: { monitoring: { output_muted: true } },
  } as unknown as Monitoring);
  function AnotherView() {
    useMonitorFeed(1000);
    return null;
  }
  render(
    <SessionMediaProvider>
      <AnotherView />
      <PerformPlayerRow />
    </SessionMediaProvider>,
  );
  act(() => publishPlayer(snapshot('ready', 0)));
  await screen.findByText('Output muted');
  expect(monitoring).toHaveBeenCalledTimes(1);
  expect(playerCommand).not.toHaveBeenCalled();
});
