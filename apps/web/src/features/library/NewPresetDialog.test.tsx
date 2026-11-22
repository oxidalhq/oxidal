import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import {
  graphAudioState,
  playbackCommand,
  playbackState,
  publishRig,
  rigAudioState,
  rigLibrary,
  rigNativeSources,
} from '../../api';
import { DeviceError } from '../../lib/friendlyError';
import { NewPresetDialog } from './NewPresetDialog';

vi.mock('../../api', () => ({
  playbackCommand: vi.fn(),
  playbackState: vi.fn(),
  graphAudioState: vi.fn(),
  rigAudioState: vi.fn(),
  publishRig: vi.fn(),
  rigDocument: vi.fn(),
  rigLibrary: vi.fn(),
  rigNativeSources: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('tries the same request again, so a lost reply cannot make two presets', async () => {
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: [],
    native_profile: 'prof',
    next: null,
  } as never);
  vi.mocked(rigNativeSources).mockResolvedValue([]);
  vi.mocked(publishRig)
    .mockRejectedValueOnce(new DeviceError('Device busy', 'busy', 409))
    .mockResolvedValue({ revision: 'r', manifest: { name: 'Clean' } } as never);
  const created = vi.fn();
  render(
    <NewPresetDialog
      connected
      onPlayingCopied={vi.fn()}
      onCreated={created}
      onCancel={() => {}}
      onAdvanced={() => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Clean' },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Create preset' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Create preset' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(created).toHaveBeenCalledOnce());
  const [first, second] = vi.mocked(publishRig).mock.calls.map(([r]) => r);
  // Same manifest id and bytes: the device stores one revision, not two.
  expect(second).toEqual(first);
  expect(JSON.parse(first!.manifest_json).name).toBe('Clean');
});

it('copies the reviewed native session, including its edits, and never publishes an empty rig', async () => {
  const opening = {
    phase: 'running',
    session: 'native-test',
    revision: 4,
    modified: true,
    preset_name: 'Friday lead',
  } as const;
  vi.mocked(playbackState).mockResolvedValue(opening as never);
  vi.mocked(graphAudioState).mockResolvedValue({ phase: 'stopped' } as never);
  vi.mocked(rigAudioState).mockResolvedValue({ phase: 'stopped' } as never);
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: [],
    native_profile: 'prof',
    next: null,
  } as never);
  vi.mocked(rigNativeSources).mockResolvedValue([]);
  vi.mocked(playbackCommand).mockResolvedValue({
    ...opening,
    saved_copy: 'new-id',
  } as never);
  const copied = vi.fn();
  render(
    <NewPresetDialog
      connected
      onCreated={vi.fn()}
      onPlayingCopied={copied}
      onCancel={vi.fn()}
      onAdvanced={vi.fn()}
    />,
  );
  const option = await screen.findByRole('radio', {
    name: /A copy of what is playing.*Friday lead/,
  });
  fireEvent.click(option);
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Encore' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create preset' }));
  await waitFor(() => expect(copied).toHaveBeenCalledWith('Encore'));
  expect(playbackCommand).toHaveBeenCalledExactlyOnceWith(opening, {
    kind: 'save_copy',
    name: 'Encore',
  });
  expect(publishRig).not.toHaveBeenCalled();
});
