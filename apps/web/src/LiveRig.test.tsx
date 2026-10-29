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
  type AudioState,
} from './api';
vi.mock('./api', () => ({
  presetArtwork: vi.fn(),
  playbackCommand: vi.fn(),
  playbackState: vi.fn(),
}));
vi.mock('./RigPresetSelector', () => ({ RigPresetSelector: () => null }));
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
  fireEvent.click(await screen.findByRole('button', { name: 'Reload saved' }));
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
  fireEvent.click(await screen.findByRole('button', { name: 'Reload saved' }));
  fireEvent.click(
    screen.getByRole('button', { name: 'Discard edits and reload' }),
  );
  await screen.findByText('Error: Session changed');
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
