import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MidiSettings } from './MidiSettings';
import {
  playbackState,
  playbackCommand,
  rigAudioState,
  rigAudioCommand,
  type AudioState,
  type RigAudioState,
} from './api';
vi.mock('./api', () => ({
  playbackState: vi.fn(),
  playbackCommand: vi.fn(),
  rigAudioState: vi.fn(),
  rigAudioCommand: vi.fn(),
}));
vi.mock('./SceneMidi', () => ({
  MidiControls: ({
    onApply,
    disabled,
  }: {
    onApply: (v: null) => Promise<void>;
    disabled: boolean;
  }) => (
    <button disabled={disabled} onClick={() => void onApply(null)}>
      Disable MIDI
    </button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('sends native MIDI configuration to the native owner and keeps rejection visible', async () => {
  const native = {
    phase: 'running',
    session: 'n',
    revision: 2,
    controls: [],
  } as unknown as AudioState;
  vi.mocked(playbackState).mockResolvedValue(native);
  vi.mocked(rigAudioState).mockResolvedValue({
    phase: 'stopped',
  } as RigAudioState);
  vi.mocked(playbackCommand).mockRejectedValue(new Error('Session changed'));
  render(<MidiSettings connected />);
  fireEvent.click(await screen.findByRole('button', { name: 'Disable MIDI' }));
  await screen.findByRole('alert');
  expect(playbackCommand).toHaveBeenCalledWith(native, {
    kind: 'midi',
    settings: null,
  });
  expect(rigAudioCommand).not.toHaveBeenCalled();
});
it('sends mixed MIDI configuration only to the active mixed owner', async () => {
  const mixed = {
    phase: 'running',
    session: 'm',
    revision: 3,
    control: { controls: [] },
  } as unknown as RigAudioState;
  vi.mocked(playbackState).mockResolvedValue({
    phase: 'stopped',
  } as AudioState);
  vi.mocked(rigAudioState).mockResolvedValue(mixed);
  vi.mocked(rigAudioCommand).mockResolvedValue(mixed);
  render(<MidiSettings connected />);
  fireEvent.click(await screen.findByRole('button', { name: 'Disable MIDI' }));
  await waitFor(() =>
    expect(rigAudioCommand).toHaveBeenCalledWith(mixed, {
      kind: 'midi',
      settings: null,
    }),
  );
  expect(playbackCommand).not.toHaveBeenCalled();
});
