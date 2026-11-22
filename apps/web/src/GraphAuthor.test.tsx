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
  blockSettings,
  graphAudioCommand,
  type GraphAudioState,
  graphAudioState,
  graphLibrary,
  type GraphSettings,
  installedLv2,
  type Lv2Plugin,
  protectState,
} from './api';
import fixtures from './fixtures/factory-lv2.json';
import { GraphAuthor } from './GraphAuthor';
import { DeviceError } from './lib/friendlyError';

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  graphAudioCommand: vi.fn(),
  blockSettings: vi.fn(),
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

const option = (id: string, name: string, sample_rate = 48000) => ({
  id,
  preset: {
    version: 1,
    name,
    sample_rate,
    rig: configured.rig,
    bindings: [],
    recall: {
      bypassed: false,
      values: [],
      mappings: { version: 1, mappings: [] },
    },
  },
});
const a = option('a', 'Playing effects');
const b = option('b', 'Space effects');
const c = option('c', '44.1 kHz room', 44100);
const ready = {
  ...running,
  saved_copy: a.id,
  configured: { ...configured, library_id: a.id },
};
const nextSound = {
  ...ready,
  revision: 4,
  saved_copy: b.id,
  configured: { ...configured, library_id: b.id, name: b.preset.name },
};

beforeEach(() => {
  vi.mocked(graphLibrary).mockResolvedValue([a, b, c]);
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
  expect(screen.getByRole('group', { name: 'Switch preset' })).toBeVisible();
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
  await screen.findByText('Another effects preset', { selector: 'h2' });
  await user.click(
    within(dialog).getByRole('button', { name: 'Stop without saving' }),
  );
  expect(graphAudioCommand).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The playing session changed.',
  );
});

it('uses the confirmed cursor once and keeps the previous label while the next sound opens', async () => {
  const user = userEvent.setup();
  const playing = vi.fn();
  vi.mocked(graphAudioState).mockResolvedValue(ready);
  let finish!: (next: GraphAudioState) => void;
  vi.mocked(graphAudioCommand).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<GraphAuthor connected liveOnly onPlaying={playing} />);
  const next = await screen.findByRole('button', {
    name: 'Next preset: Space effects',
  });
  await user.dblClick(next);
  expect(graphAudioCommand).toHaveBeenCalledExactlyOnceWith(ready, {
    kind: 'recall_saved',
    id: b.id,
    discard_changes: false,
  });
  expect(next).toBeDisabled();
  expect(
    screen.getByRole('heading', { name: 'Playing effects' }),
  ).toBeVisible();
  expect(playing).toHaveBeenLastCalledWith('Playing effects');
  expect(screen.getByText('Opening Space effects…')).toBeVisible();
  finish(nextSound);
  expect(
    await screen.findByRole('button', {
      name: /Playing preset: Space effects/,
    }),
  ).toBeVisible();
  expect(playing).toHaveBeenLastCalledWith('Space effects');
});

it('finds effects presets, blocks a different sample rate and protects unsaved changes', async () => {
  const user = userEvent.setup();
  vi.mocked(graphAudioCommand).mockResolvedValueOnce(nextSound);
  render(<GraphAuthor connected liveOnly />);
  const picker = await screen.findByRole('button', {
    name: /Playing preset: Playing effects/,
  });
  await user.click(picker);
  const list = screen.getByRole('dialog', { name: 'Choose an effects preset' });
  expect(
    within(list).getByRole('button', { name: c.preset.name }),
  ).toBeDisabled();
  await user.type(within(list).getByRole('searchbox'), 'space');
  expect(
    within(list).queryByRole('button', { name: c.preset.name }),
  ).toBeNull();
  await user.click(within(list).getByRole('button', { name: b.preset.name }));
  const confirm = screen.getByRole('dialog', {
    name: 'Switch effects preset?',
  });
  await user.click(
    within(confirm).getByRole('button', { name: 'Keep current sound' }),
  );
  expect(graphAudioCommand).not.toHaveBeenCalled();
  await user.click(
    screen.getByRole('button', { name: 'Next preset: Playing effects' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Switch without saving' }),
  );
  expect(graphAudioCommand).toHaveBeenCalledWith(running, {
    kind: 'recall_saved',
    id: a.id,
    discard_changes: true,
  });
});

it('requires a fresh selection after another viewer changes the session while confirming', async () => {
  const user = userEvent.setup();
  render(<GraphAuthor connected liveOnly />);
  await user.click(
    await screen.findByRole('button', { name: 'Next preset: Playing effects' }),
  );
  const dialog = screen.getByRole('dialog', { name: 'Switch effects preset?' });
  vi.mocked(graphAudioState).mockResolvedValue({
    ...nextSound,
    configured: { ...configured, name: 'Other viewer effects' },
  });
  await screen.findByText('Other viewer effects', { selector: 'h2' });
  await user.click(
    within(dialog).getByRole('button', { name: 'Switch without saving' }),
  );
  expect(graphAudioCommand).not.toHaveBeenCalled();
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The effects session changed.',
  );
});

it('shows Protect refusal and immediate failed or stopped readback without leaving Rig', async () => {
  const user = userEvent.setup();
  const present = vi.fn();
  vi.mocked(graphAudioState).mockResolvedValue(ready);
  vi.mocked(graphAudioCommand).mockRejectedValueOnce(
    new DeviceError(
      'Protect is on. Turn Protect off to change this.',
      'locked',
      423,
    ),
  );
  render(<GraphAuthor connected liveOnly onPresent={present} />);
  await user.click(
    await screen.findByRole('button', { name: 'Next preset: Space effects' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('Protect is on');
  expect(
    screen.getByRole('heading', { name: 'Playing effects' }),
  ).toBeVisible();
  vi.mocked(graphAudioState).mockResolvedValueOnce({
    ...ready,
    phase: 'failed',
    revision: 3,
    device_owned: false,
  });
  vi.mocked(graphAudioCommand).mockRejectedValueOnce(
    new DeviceError(
      'Effects preset could not start; previous sound could not restart.',
      'conflict',
      409,
    ),
  );
  await user.click(
    screen.getByRole('button', { name: 'Next preset: Space effects' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Resume effects' }),
  ).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'previous sound could not restart',
  );
  expect(
    screen.getByRole('button', {
      name: /Choose an effects preset: Playing effects/,
    }),
  ).toBeVisible();
  expect(present).toHaveBeenLastCalledWith(true);
});

it('explains what happens to a caught loop in the effects-only Moment rig', async () => {
  const rig: GraphSettings['rig'] = {
    nodes: [
      { id: 'in', kind: 'input', level: 1 },
      { id: 'moment', kind: 'lv2', level: 1 },
      { id: 'out', kind: 'output', level: 1 },
    ],
    edges: [
      { from: 'in', to: 'moment' },
      { from: 'moment', to: 'out' },
    ],
  };
  vi.mocked(graphAudioState).mockResolvedValue({
    ...running,
    configured: {
      ...configured,
      rig,
      bindings: [{ node: 'moment', uri: 'urn:oxidal:plugin:moment#stereo' }],
    },
    control: { ...running.control!, rig },
  });
  render(<GraphAuthor connected liveOnly />);
  const notice = await screen.findByText(/the caught loop lives in memory/i);
  expect(notice).toHaveTextContent('At full Clock, Moment holds four seconds.');
  expect(notice).toHaveTextContent(
    'Saving or exporting a preset keeps the control settings only.',
  );
  expect(graphAudioCommand).not.toHaveBeenCalled();
});

it('applies named settings to the reviewed effects instance in a single device command', async () => {
  const plugin = (fixtures as Lv2Plugin[]).find(
    (p) => p.uri === 'urn:oxidal:plugin:moment#stereo',
  )!;
  const ports = plugin.ports.filter((p) => p.input && p.control);
  const rig: GraphSettings['rig'] = {
    nodes: [
      { id: 'in', kind: 'input', level: 1 },
      { id: 'fx', kind: 'lv2', level: 1 },
      { id: 'out', kind: 'output', level: 1 },
    ],
    edges: [
      { from: 'in', to: 'fx' },
      { from: 'fx', to: 'out' },
    ],
  };
  const opening: GraphAudioState = {
    ...running,
    configured: {
      ...configured,
      rig,
      bindings: [{ node: 'fx', uri: plugin.uri }],
    },
    control: {
      ...running.control!,
      rig,
      parameters: ports.map((p) => ({
        id: 'fx.' + p.symbol,
        label: p.name ?? p.symbol,
        min: 0,
        max: 1,
        step: 0.01,
        default: 0,
        value: 0,
        writable: true,
        unit: '',
      })),
    },
    native_values: ports.map((p) => ({
      target: 'fx.' + p.symbol,
      value: p.default!,
    })),
  };
  const controls = Object.fromEntries(ports.map((p) => [p.symbol, p.default!]));
  controls.time = 42;
  const entry = {
    id: 'a'.repeat(32),
    name: 'Encore',
    plugin: plugin.uri,
    controls,
  };
  vi.mocked(installedLv2).mockResolvedValue([plugin]);
  vi.mocked(blockSettings).mockResolvedValue({ revision: 1, entries: [entry] });
  vi.mocked(graphAudioState).mockResolvedValue(opening);
  vi.mocked(graphAudioCommand).mockResolvedValue({
    ...opening,
    native_values: ports.map((p) => ({
      target: 'fx.' + p.symbol,
      value: controls[p.symbol]!,
    })),
  });
  const user = userEvent.setup();
  render(<GraphAuthor connected liveOnly />);
  await user.click(await screen.findByText('Named settings'));
  await user.selectOptions(
    await screen.findByLabelText(/Saved settings for/),
    await screen.findByRole('option', { name: 'Encore' }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Apply to playing block' }),
  );
  expect(
    await screen.findByText('Settings applied to the playing block.'),
  ).toBeVisible();
  expect(graphAudioCommand).toHaveBeenCalledExactlyOnceWith(opening, {
    kind: 'apply_block_settings',
    plugin: plugin.uri,
    controls,
    command: {
      session: opening.control!.session,
      expected_revision: 1,
      node: 'fx',
    },
  });
});
