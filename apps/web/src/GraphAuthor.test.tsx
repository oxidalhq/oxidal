import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import {
  graphAudioCommand,
  type GraphAudioState,
  graphAudioState,
  type GraphSettings,
  protectState,
} from './api';
import { GraphAuthor } from './GraphAuthor';
import { DeviceError } from './lib/friendlyError';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  graphAudioCommand: vi.fn(),
  graphAudioState: vi.fn(),
  graphLibrary: vi.fn(async () => []),
  installedLv2: vi.fn(async () => []),
  monitoring: vi.fn(async () => ({ sequence: 1 })),
  playbackState: vi.fn(async () => ({ phase: 'stopped', device_owned: false })),
  protectState: vi.fn(async () => ({ on: false })),
}));

const input = {
  endpoint: 'default',
  direction: 'capture',
  sample_rate: 48000,
  channels: 2,
  format: 's16',
  period_frames: 128,
  periods: 3,
} as const;
const configured: GraphSettings = {
  name: 'Playing effects',
  stream: {
    input,
    output: { ...input, direction: 'playback' },
    input_map: [0, 1],
    output_map: [0, 1],
  },
  rig: {
    nodes: [
      { id: 'in', kind: 'input', level: 1 },
      { id: 'out', kind: 'output', level: 1 },
    ],
    edges: [{ from: 'in', to: 'out' }],
  },
  bindings: [],
};
const running: GraphAudioState = {
  session: 'graph-controller',
  revision: 1,
  phase: 'running',
  device_owned: true,
  experimental: true,
  native_values: [],
  processed_frames: 128,
  start_on_boot: false,
  saved_copy: null,
  configured,
  control: {
    session: 'graph-worker',
    protocol: 1,
    revision: 1,
    origin: 'worker',
    request_id: '',
    audio_available: true,
    bypassed: false,
    preset: '',
    actions: [],
    midi_mapped: false,
    rig: configured.rig,
    parameters: [],
    mappings: { version: 1, mappings: [] },
    feedback: [],
  },
};

beforeEach(() => {
  vi.mocked(graphAudioState).mockResolvedValue(running);
  vi.mocked(protectState).mockResolvedValue({ on: false });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('shows confirmed playing identity while a copy name is edited', async () => {
  const user = userEvent.setup();
  const onPlaying = vi.fn();
  const saved = {
    ...running,
    revision: 2,
    saved_copy: 'saved-revision',
    configured: { ...configured, name: 'New copy' },
  };
  vi.mocked(graphAudioCommand).mockResolvedValue(saved);
  render(<GraphAuthor connected liveOnly onPlaying={onPlaying} />);
  const opening = await screen.findByRole('heading', {
    name: 'Playing effects',
  });
  const name = screen.getByRole('textbox', { name: 'Save as' });
  await user.clear(name);
  await user.type(name, 'New copy');
  expect(opening).toBeVisible();
  expect(onPlaying).toHaveBeenLastCalledWith('Playing effects');
  expect(
    screen.queryByRole('group', { name: 'Switch preset' }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/Effects chain composer → Saved presets/),
  ).toBeVisible();
  expect(graphAudioCommand).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Save preset' }));
  expect(graphAudioCommand).toHaveBeenCalledWith(running, {
    kind: 'save_copy',
    name: 'New copy',
  });
  await screen.findByRole('heading', { name: 'New copy' });
  expect(onPlaying).toHaveBeenLastCalledWith('New copy');
  vi.mocked(graphAudioCommand).mockResolvedValueOnce({
    ...saved,
    revision: 3,
    phase: 'stopped',
    device_owned: false,
  });
  await user.click(screen.getByRole('button', { name: 'Stop audio' }));
  expect(graphAudioCommand).toHaveBeenLastCalledWith(saved, { kind: 'stop' });
  await waitFor(() => expect(onPlaying).toHaveBeenLastCalledWith(null));
});

it('keeps the playing session on cancel and shows the daemon’s Protect refusal on explicit Stop', async () => {
  const user = userEvent.setup();
  vi.mocked(protectState).mockResolvedValue({ on: true });
  vi.mocked(graphAudioCommand).mockRejectedValueOnce(
    new DeviceError(
      'Protect is on. Turn Protect off to change this.',
      'locked',
      423,
    ),
  );
  render(<GraphAuthor connected liveOnly />);
  await screen.findByRole('button', { name: 'Protected', pressed: true });
  const stop = screen.getByRole('button', { name: 'Stop audio' });
  await user.click(stop);
  const dialog = () =>
    screen.getByRole('dialog', { name: 'Stop effects audio?' });
  expect(graphAudioCommand).not.toHaveBeenCalled();
  await user.click(
    within(dialog()).getByRole('button', { name: 'Keep playing' }),
  );
  expect(graphAudioCommand).not.toHaveBeenCalled();
  await user.click(stop);
  await user.click(
    within(dialog()).getByRole('button', { name: 'Stop without saving' }),
  );
  expect(graphAudioCommand).toHaveBeenCalledExactlyOnceWith(running, {
    kind: 'stop',
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not stop effects audio. Protect is on.',
  );
  expect(
    screen.getByRole('heading', { name: 'Playing effects' }),
  ).toBeVisible();
});

it('keeps Stop disabled during an active adjustment', async () => {
  vi.mocked(graphAudioState).mockResolvedValue({
    ...running,
    control: {
      ...running.control!,
      edit: { owner: 'other-tab', target: 'fx.gain' },
    },
  });
  render(<GraphAuthor connected liveOnly />);
  const stop = await screen.findByRole('button', { name: 'Stop audio' });
  await waitFor(() => expect(stop).toBeDisabled());
  expect(graphAudioCommand).not.toHaveBeenCalled();
});

it('requires a fresh Stop confirmation if the playing session changes', async () => {
  const user = userEvent.setup();
  render(<GraphAuthor connected liveOnly />);
  await user.click(await screen.findByRole('button', { name: 'Stop audio' }));
  const dialog = screen.getByRole('dialog', { name: 'Stop effects audio?' });
  vi.mocked(graphAudioState).mockResolvedValue({
    ...running,
    revision: 2,
    configured: { ...configured, name: 'Another effects preset' },
  });
  await screen.findByText('Another effects preset');
  await user.click(
    within(dialog).getByRole('button', { name: 'Stop without saving' }),
  );
  expect(graphAudioCommand).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The playing session changed.',
  );
});
