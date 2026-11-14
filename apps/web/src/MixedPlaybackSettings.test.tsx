import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MixedPlaybackSettings } from './MixedPlaybackSettings';
import {
  probeAudio,
  rigAudioCommand,
  type AudioProbe,
  type RigAudioState,
} from './api';

vi.mock('./api', () => ({
  probeAudio: vi.fn(),
  rigAudioCommand: vi.fn(),
  rigAudioState: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const input: AudioProbe = {
  endpoint: 'hw:CARD=Jogg,DEV=0',
  direction: 'capture',
  sample_rate: 48000,
  channels: 1,
  format: 's24_packed',
  period_frames: 48,
  periods: 3,
};
const output: AudioProbe = {
  ...input,
  direction: 'playback',
  channels: 2,
};
const stopped = {
  phase: 'stopped',
  device_owned: false,
  configured: {
    revision: 'rig',
    stream: {
      hear_yourself: true,
      levels: {
        input_trim_db: 0,
        output_level_db: 0,
        mono: false,
        boost_db: 0,
      },
      input,
      output,
      input_map: [0, 0],
      output_map: [0, 1],
    },
    recall: null,
    prepared: [],
    midi: null,
  },
} as unknown as RigAudioState;

it('Resume checks the saved interface itself, then resumes', async () => {
  vi.mocked(probeAudio).mockImplementation(async (request) => ({
    configuration: request,
    buffer_frames: request.period_frames * request.periods,
    streaming_available: false,
  }));
  vi.mocked(rigAudioCommand).mockResolvedValue(stopped);
  render(
    <MixedPlaybackSettings
      state={stopped}
      connected
      input={null}
      output={null}
      onState={vi.fn()}
    />,
  );
  expect(screen.getByText(/Resume checks this session/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Resume audio' }));
  await waitFor(() =>
    expect(rigAudioCommand).toHaveBeenCalledWith(stopped, { kind: 'restart' }),
  );
  expect(probeAudio).toHaveBeenCalledWith(input);
  expect(probeAudio).toHaveBeenCalledWith(output);
});

it('Resume starts nothing when the saved interface is gone', async () => {
  vi.mocked(probeAudio).mockRejectedValue(new Error('No such device'));
  render(
    <MixedPlaybackSettings
      state={stopped}
      connected
      input={null}
      output={null}
      onState={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Resume audio' }));
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(rigAudioCommand).not.toHaveBeenCalled();
});

it('enables Resume after both saved directions pass the exact check', () => {
  render(
    <MixedPlaybackSettings
      state={stopped}
      connected
      input={input}
      output={output}
      onState={vi.fn()}
    />,
  );
  expect(screen.getByRole('button', { name: 'Resume audio' })).toBeEnabled();
});
