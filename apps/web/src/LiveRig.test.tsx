import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { LiveRig } from './LiveRig';
import { WorkspaceMemory } from './workspaceMemory';
import {
  presetArtwork,
  playbackCommand,
  playbackState,
  removalPreview,
  removePreset,
  type AudioState,
} from './api';
// Mute/Protect have their own tests; the Rig header only places them.
vi.mock('./features/stage/StageControls', () => ({
  StageControls: () => null,
}));
vi.mock('./api', () => ({
  presetArtwork: vi.fn(),
  playbackCommand: vi.fn(),
  playbackState: vi.fn(),
  removalPreview: vi.fn(),
  removePreset: vi.fn(),
}));
vi.mock('./RigPresetSelector', () => ({ RigPresetSelector: () => null }));
vi.mock('./GuitarSettings', () => ({
  GuitarPicker: () => null,
  GuitarSwitch: () => null,
}));
vi.mock('./SceneMidi', () => ({ MidiControls: () => null }));
vi.mock('./NativeAuthoring', () => ({ NativeAuthoring: () => null }));
vi.mock('./LiveEq', () => ({ LiveEq: () => null }));
vi.mock('./AssetArtwork', () => ({
  ArtworkDeck: () => <span>Artwork preview</span>,
}));
vi.mock('./ModelPicker', () => ({ ModelPicker: () => null }));
vi.mock('./AdjustmentDialog', () => ({
  AdjustmentDialog: ({
    title,
    children,
  }: {
    title: string;
    children: ReactNode;
  }) => (
    <div role="dialog" aria-label={title}>
      {children}
    </div>
  ),
}));
const opening = {
  phase: 'running',
  session: 's',
  revision: 10,
  modified: true,
  configured: {
    preset_id: 'saved-tone',
    owned: true,
    draft: false,
    working: 'working-edit',
    stream: { buffer: 128 },
    midi: { input: 'choco' },
  },
  preset_name: 'My tone',
  controls: [
    {
      target: 'outputLevel',
      label: 'Output level',
      display: '0 dB',
      value: 0.5,
      toggle: false,
    },
    {
      target: 'block:amp:enabled',
      label: 'Amp · left · enabled',
      display: 'On',
      value: 1,
      toggle: true,
    },
    {
      target: 'block:amp:inputGain',
      label: 'Amp · left · inputGain',
      display: '0 dB',
      value: 0.5,
      toggle: false,
    },
  ],
  authoring: { can_undo: true, can_redo: false },
} as unknown as AudioState;
beforeEach(() => {
  localStorage.clear();
  vi.mocked(presetArtwork).mockResolvedValue([]);
  vi.mocked(playbackState).mockResolvedValue(opening);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
function show() {
  return render(
    <LiveRig
      connected
      onPlaying={() => {}}
      onLibrary={() => {}}
      onAudioSetup={() => {}}
    />,
  );
}
it('keeps bypass in the block detail, opens a single model inspector and retains display preference', async () => {
  show();
  await screen.findByRole('button', { name: 'Save copy' });
  expect(
    screen.queryByRole('button', { name: 'Compact' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Change model' }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Amp' }));
  expect(screen.getAllByRole('button', { name: 'Change model' })).toHaveLength(
    1,
  );
  expect(
    screen.queryByRole('button', { name: 'Enable Amp' }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Amp on' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Preset actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Model artwork' }));
  expect(localStorage.getItem('oxidal-chain-view')).toBe('artwork');
  expect(playbackCommand).not.toHaveBeenCalled();
});
it('requires explicit discard and starts saved bytes using the stop reply cursor, preserving devices and MIDI', async () => {
  const stopped = { ...opening, phase: 'stopped', revision: 11 } as AudioState;
  vi.mocked(playbackCommand)
    .mockResolvedValueOnce(stopped)
    .mockResolvedValueOnce({ ...opening, modified: false, revision: 12 });
  show();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Preset actions' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved' }));
  expect(playbackCommand).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', { name: 'Discard edits and reload' }),
  );
  await waitFor(() => expect(playbackCommand).toHaveBeenCalledTimes(2));
  expect(playbackCommand).toHaveBeenNthCalledWith(1, opening, { kind: 'stop' });
  expect(playbackCommand).toHaveBeenNthCalledWith(2, stopped, {
    kind: 'start',
    settings: { ...opening.configured, working: null },
  });
});
it('never starts or retries after a failed stop', async () => {
  vi.mocked(playbackCommand).mockRejectedValue(new Error('Session changed'));
  show();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Preset actions' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Discard edits and reload' }),
  );
  await screen.findByText('Could not update the rig. Session changed.');
  expect(playbackCommand).toHaveBeenCalledTimes(1);
});

it('restores valid block context across navigation but never carries it into a different sounding session', async () => {
  const memory = new Map<string, unknown>();
  const props = {
    connected: true,
    onPlaying: vi.fn(),
    onLibrary: vi.fn(),
    onAudioSetup: vi.fn(),
  };
  const view = render(
    <WorkspaceMemory.Provider value={memory}>
      <LiveRig {...props} />
    </WorkspaceMemory.Provider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Amp' }));
  expect(screen.getByRole('button', { name: 'Change model' })).toBeVisible();
  view.rerender(
    <WorkspaceMemory.Provider value={memory}>
      <p>Settings</p>
    </WorkspaceMemory.Provider>,
  );
  view.rerender(
    <WorkspaceMemory.Provider value={memory}>
      <LiveRig {...props} />
    </WorkspaceMemory.Provider>,
  );
  await screen.findByRole('button', { name: 'Change model' });
  view.rerender(
    <WorkspaceMemory.Provider value={memory}>
      <p>Settings</p>
    </WorkspaceMemory.Provider>,
  );
  vi.mocked(playbackState).mockResolvedValue({
    ...opening,
    session: 'another-sound',
  });
  view.rerender(
    <WorkspaceMemory.Provider value={memory}>
      <LiveRig {...props} />
    </WorkspaceMemory.Provider>,
  );
  await screen.findByRole('button', { name: 'Amp' });
  expect(
    screen.queryByRole('button', { name: 'Change model' }),
  ).not.toBeInTheDocument();
  expect(playbackCommand).not.toHaveBeenCalled();
});
it('offers Resume after audio stops so unsaved edits come back without a library trip', async () => {
  const stopped = { ...opening, phase: 'stopped' } as AudioState;
  vi.mocked(playbackState).mockResolvedValue(stopped);
  vi.mocked(playbackCommand).mockResolvedValue(opening);
  show();
  const resume = await screen.findByRole('button', {
    name: `Resume ${opening.preset_name}`,
  });
  expect(screen.getByText(/including\s+unsaved edits/)).toBeInTheDocument();
  fireEvent.click(resume);
  await waitFor(() =>
    expect(playbackCommand).toHaveBeenCalledWith(stopped, { kind: 'resume' }),
  );
});
it('says it is waiting for the interface instead of asking for a Resume', async () => {
  vi.mocked(playbackState).mockResolvedValue({
    ...opening,
    phase: 'stopped',
    configured: null,
    waiting_for_device: true,
  } as AudioState);
  show();
  expect(
    await screen.findByRole('heading', {
      name: 'Waiting for your audio interface',
    }),
  ).toBeVisible();
  expect(screen.getByText(/Audio starts by itself/)).toBeVisible();
});
it('keeps an adjustment usable when beginning it advances the session revision', async () => {
  // The real engine moves the revision forward on gesture begin; the dialog
  // must follow it instead of reporting a changed session (regression).
  vi.mocked(playbackCommand).mockImplementation(async (state) => ({
    ...(state as AudioState),
    revision: (state as AudioState).revision + 1,
  }));
  show();
  fireEvent.click(
    await screen.findByRole('button', { name: 'Adjust sounding Output level' }),
  );
  const dialog = await screen.findByRole('dialog', { name: 'Output level' });
  await waitFor(() =>
    expect(playbackCommand).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 10 }),
      expect.objectContaining({ kind: 'authoring' }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Done' })).toBeEnabled(),
  );
  expect(dialog).not.toHaveTextContent('Sounding session changed');
});

it('keeps an automatic Mine copy without touching the immutable source', async () => {
  const copied = {
    ...opening,
    configured: { ...opening.configured, preset_id: 'copy-id' },
    copy_on_edit: {
      copy_id: 'copy-id',
      source_id: 'source-id',
      source_name: 'Provider tone',
    },
  } as AudioState;
  vi.mocked(playbackState).mockResolvedValue(copied);
  vi.mocked(playbackCommand).mockResolvedValue({
    ...copied,
    copy_on_edit: null,
  });
  show();
  expect(
    await screen.findByText('Editing a copy of Provider tone'),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Keep copy' }));
  await waitFor(() =>
    expect(playbackCommand).toHaveBeenCalledWith(copied, {
      kind: 'resolve_copy',
      keep: true,
    }),
  );
  expect(removalPreview).not.toHaveBeenCalled();
  expect(removePreset).not.toHaveBeenCalled();
});

it('returns to the source before permanently discarding an automatic copy', async () => {
  const copied = {
    ...opening,
    configured: { ...opening.configured, preset_id: 'copy-id' },
    copy_on_edit: {
      copy_id: 'copy-id',
      source_id: 'source-id',
      source_name: 'Provider tone',
    },
  } as AudioState;
  const source = {
    ...opening,
    revision: 11,
    modified: false,
    configured: {
      ...opening.configured,
      preset_id: 'source-id',
      owned: false,
    },
    copy_on_edit: null,
  } as AudioState;
  vi.mocked(playbackState).mockResolvedValue(copied);
  vi.mocked(playbackCommand).mockResolvedValue(source);
  vi.mocked(removalPreview).mockResolvedValue({
    blocked: null,
    token: 'sealed-preview',
  } as Awaited<ReturnType<typeof removalPreview>>);
  vi.mocked(removePreset).mockResolvedValue(
    {} as Awaited<ReturnType<typeof removePreset>>,
  );
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Discard copy' }));
  await waitFor(() =>
    expect(playbackCommand).toHaveBeenCalledWith(copied, {
      kind: 'resolve_copy',
      keep: false,
    }),
  );
  expect(removalPreview).toHaveBeenCalledWith({
    entry_kind: 'owned',
    id: 'copy-id',
  });
  expect(removePreset).toHaveBeenCalledWith({
    entry_kind: 'owned',
    id: 'copy-id',
    expected_preview: 'sealed-preview',
    delete_models: false,
  });
});
