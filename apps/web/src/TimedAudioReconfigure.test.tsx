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
  // Up to five common choices show side by side (C2).
  expect(
    screen.getByRole('radiogroup', { name: 'Session buffer' }),
  ).toBeVisible();
  await user.click(screen.getByRole('radio', { name: '256' }));
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

it('keeps the rarer buffer sizes and period counts one step away', () => {
  render(
    <TimedAudioReconfigure
      initial={initial}
      checkedInput={null}
      checkedOutput={null}
      cursor={cursor}
      feed={{
        state: { phase: 'idle' },
        receivedAt: 0,
        error: '',
        pending: false,
        readFailed: false,
        active: false,
        secondsLeft: 0,
      }}
      disabled={false}
    />,
  );
  // 512, 1024 and 6 periods are no longer side by side, but still offered.
  expect(
    screen.getByRole('combobox', { name: 'Session buffer: other values' }),
  ).toBeVisible();
  expect(
    screen.getByRole('combobox', {
      name: 'Session buffer periods: other values',
    }),
  ).toBeVisible();
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

const finderFeed = (
  state: 'running' | 'done',
): ReturnType<typeof useAudioChange> => ({
  state: {
    phase: state === 'running' ? 'proving' : 'reverted',
    owner: 'native',
    id: 'finder-id',
    previous: {
      input,
      output: initial.output,
      input_map: initial.input_map,
      output_map: initial.output_map,
    },
    finder: {
      state,
      session: cursor.session,
      expected_revision: cursor.expected_revision,
      total: 1,
      candidate: { frames: 48, periods: 2 },
      recommended: { frames: 48, periods: 2 },
      trials:
        state === 'done'
          ? [
              {
                frames: 48,
                periods: 2,
                outcome: 'clean',
                elapsed_ms: 60000,
                xruns: 0,
                deadline_misses: 0,
                invalid_samples: 0,
              },
            ]
          : [],
    },
  },
  receivedAt: 0,
  error: '',
  pending: false,
  readFailed: false,
  active: state === 'running',
  secondsLeft: 60,
});

it('starts device-owned buffer screening with only the confirmed owner cursor', async () => {
  const user = userEvent.setup();
  render(
    <TimedAudioReconfigure
      initial={initial}
      checkedInput={null}
      checkedOutput={null}
      cursor={cursor}
      disabled={false}
      feed={{
        state: { phase: 'idle' },
        receivedAt: 0,
        error: '',
        pending: false,
        readFailed: false,
        active: false,
        secondsLeft: 0,
      }}
    />,
  );
  await user.click(
    screen.getByRole('button', { name: 'Find the smallest safe buffer…' }),
  );
  await user.click(screen.getByRole('button', { name: 'Start' }));
  expect(changeAudio).toHaveBeenCalledTimes(1);
  expect(changeAudio).toHaveBeenCalledWith({ kind: 'find_buffer', ...cursor });
});

it('keeps screening alive when its view closes and sends explicit ID-bound cancellation under Protect', async () => {
  const user = userEvent.setup();
  render(
    <TimedAudioReconfigure
      initial={initial}
      checkedInput={null}
      checkedOutput={null}
      cursor={cursor}
      disabled
      feed={finderFeed('running')}
    />,
  );
  expect(
    screen.queryByRole('dialog', { name: 'Keep this audio setting?' }),
  ).toBeNull();
  await user.click(screen.getByRole('button', { name: 'View buffer test…' }));
  await user.click(screen.getByRole('button', { name: 'Close panel' }));
  expect(changeAudio).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole('button', { name: 'Stop test and restore' }),
  );
  expect(changeAudio).toHaveBeenCalledWith({ kind: 'revert', id: 'finder-id' });
});

it('applies measured sizing to the tested routing and refuses an old result after the owner cursor changes', async () => {
  const user = userEvent.setup();
  const feed = finderFeed('done');
  const props = {
    initial,
    cursor,
    disabled: false,
    feed,
    checkedInput: { ...input, endpoint: 'hw:other' },
    checkedOutput: { ...initial.output, endpoint: 'hw:other' },
  };
  const view = render(<TimedAudioReconfigure {...props} />);
  await user.click(screen.getByText('Interface routing', { exact: true }));
  await user.click(
    screen.getByRole('button', { name: 'Use checked interface' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'View buffer results…' }),
  );
  await user.click(screen.getByRole('button', { name: 'Use 48 × 2' }));
  expect(changeAudio).toHaveBeenCalledWith({
    kind: 'apply',
    ...cursor,
    input: { ...input, period_frames: 48, periods: 2 },
    output: { ...initial.output, period_frames: 48, periods: 2 },
    input_map: initial.input_map,
    output_map: initial.output_map,
  });
  view.rerender(
    <TimedAudioReconfigure
      {...props}
      cursor={{ ...cursor, expected_revision: 8 }}
    />,
  );
  await user.click(
    screen.getByRole('button', { name: 'View buffer results…' }),
  );
  expect(screen.getByRole('button', { name: 'Use 48 × 2' })).toBeDisabled();
  expect(screen.getByText(/rig changed after screening/)).toBeVisible();
});
