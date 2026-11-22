import { afterEach, expect, it, vi } from 'vitest';

import {
  graphAudioState,
  playbackState,
  rigAudioCommand,
  rigAudioState,
} from '../../api';
import { copyPlaying, playingCopySource } from './copyPlaying';

vi.mock('../../api', () => ({
  graphAudioState: vi.fn(),
  playbackState: vi.fn(),
  rigAudioCommand: vi.fn(),
  rigAudioState: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

it('refuses a copy when ownership changed between the three status reads', async () => {
  vi.mocked(playbackState).mockResolvedValue({ phase: 'running' } as never);
  vi.mocked(graphAudioState).mockResolvedValue({ phase: 'stopped' } as never);
  vi.mocked(rigAudioState).mockResolvedValue({
    phase: 'running',
    save: { running: true },
  } as never);
  expect(await playingCopySource()).toBeNull();
});

it('rejects a replaced save receipt without repeating the mixed copy', async () => {
  const state = {
    phase: 'running',
    control: { session: 'session', revision: 2 },
  };
  vi.mocked(rigAudioCommand).mockResolvedValue({
    ...state,
    save: {
      running: false,
      copy_id: 'another-request',
      saved_revision: 'another-copy',
      source_session: 'session',
      source_control_revision: 2,
    },
  } as never);
  await expect(
    copyPlaying(
      { owner: 'mixed', state: state as never },
      'Encore',
      new AbortController().signal,
    ),
  ).rejects.toThrow('save receipt changed');
  expect(rigAudioCommand).toHaveBeenCalledOnce();
  expect(rigAudioState).not.toHaveBeenCalled();
});
