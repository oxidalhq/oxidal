import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MixedPlaybackSettings } from './MixedPlaybackSettings';
import type { AudioProbe, RigAudioState } from './api';

vi.mock('./api', () => ({
  rigAudioCommand: vi.fn(),
  rigAudioState: vi.fn(),
}));

afterEach(cleanup);

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

it('keeps Resume disabled while the saved interface is absent', () => {
  render(
    <MixedPlaybackSettings
      state={stopped}
      connected
      input={null}
      output={null}
      onState={vi.fn()}
      boot={null}
    />,
  );
  expect(screen.getByRole('button', { name: 'Resume session' })).toBeDisabled();
  expect(screen.getByText(/Reconnect and check this session/)).toBeVisible();
});

it('enables Resume after both saved directions pass the exact check', () => {
  render(
    <MixedPlaybackSettings
      state={stopped}
      connected
      input={input}
      output={output}
      onState={vi.fn()}
      boot={null}
    />,
  );
  expect(screen.getByRole('button', { name: 'Resume session' })).toBeEnabled();
});
