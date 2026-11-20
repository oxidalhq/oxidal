import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import type { StartAudio } from './api';
import { changeAudio, type useAudioChange } from './audioChangeFeed';
import { TimedAudioReconfigure } from './TimedAudioReconfigure';

vi.mock('./audioChangeFeed', () => ({
  changeAudio: vi.fn(async () => {}),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const input: StartAudio['stream']['input'] = {
  endpoint: 'hw:test',
  direction: 'capture',
  channels: 2,
  format: 's16',
  sample_rate: 48000,
  period_frames: 64,
  periods: 3,
};
const initial: StartAudio['stream'] = {
  input,
  output: { ...input, direction: 'playback' },
  input_map: [0, 0],
  output_map: [0, 1],
  hear_yourself: false,
};
const cursor = {
  owner: 'native' as const,
  session: 'playing-session',
  expected_revision: 7,
};

it('sends the exact hardware proposal and current cursor without replacing tone settings', async () => {
  const feed: ReturnType<typeof useAudioChange> = {
    state: { phase: 'idle' },
    receivedAt: 0,
    error: '',
    pending: false,
    readFailed: false,
    active: false,
    secondsLeft: 0,
  };
  const user = userEvent.setup();
  render(
    <TimedAudioReconfigure
      initial={initial}
      checkedInput={null}
      checkedOutput={null}
      cursor={cursor}
      feed={feed}
      disabled={false}
    />,
  );
  await user.click(screen.getByRole('combobox', { name: 'Session buffer' }));
  await user.click(screen.getByRole('option', { name: '256' }));
  expect(changeAudio).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole('button', { name: 'Apply and restart audio' }),
  );
  expect(changeAudio).toHaveBeenCalledWith({
    kind: 'apply',
    ...cursor,
    input: { ...input, period_frames: 256 },
    output: { ...initial.output, period_frames: 256 },
    input_map: [0, 0],
    output_map: [0, 1],
  });
});

it('shows unknown counters and sends Revert for the confirmed trial even while editing is disabled', async () => {
  const feed: ReturnType<typeof useAudioChange> = {
    state: {
      phase: 'proving',
      owner: 'native',
      id: 'owned-trial',
      observed: { frames: 1024 },
    },
    receivedAt: 0,
    error: '',
    pending: false,
    readFailed: false,
    active: true,
    secondsLeft: 0,
  };
  const user = userEvent.setup();
  render(
    <TimedAudioReconfigure
      initial={initial}
      checkedInput={null}
      checkedOutput={null}
      cursor={cursor}
      feed={feed}
      disabled
    />,
  );
  expect(screen.getAllByText('Unknown')).toHaveLength(3);
  expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Go back now' }));
  expect(changeAudio).toHaveBeenCalledWith({
    kind: 'revert',
    id: 'owned-trial',
  });
});

it('keeps Revert available after the device refuses Keep', async () => {
  const feed: ReturnType<typeof useAudioChange> = {
    state: { phase: 'proving', owner: 'native', id: 'protected-trial' },
    receivedAt: 0,
    error: 'Protect is on.',
    pending: false,
    readFailed: false,
    active: true,
    secondsLeft: 8,
  };
  const user = userEvent.setup();
  render(
    <TimedAudioReconfigure
      initial={initial}
      checkedInput={null}
      checkedOutput={null}
      cursor={cursor}
      feed={feed}
      disabled={false}
    />,
  );
  expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Go back now' }));
  expect(changeAudio).toHaveBeenCalledWith({
    kind: 'revert',
    id: 'protected-trial',
  });
});

it('offers ID-bound safety Stop even while a Keep reply is pending', async () => {
  const feed: ReturnType<typeof useAudioChange> = {
    state: { phase: 'proving', owner: 'native', id: 'stop-trial' },
    receivedAt: 0,
    error: '',
    pending: true,
    pendingAction: 'keep',
    readFailed: false,
    active: true,
    secondsLeft: 8,
  };
  const user = userEvent.setup();
  render(
    <TimedAudioReconfigure
      initial={initial}
      checkedInput={null}
      checkedOutput={null}
      cursor={cursor}
      feed={feed}
      disabled
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Stop audio' }));
  expect(changeAudio).toHaveBeenCalledWith({ kind: 'stop', id: 'stop-trial' });
});
