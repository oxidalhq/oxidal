import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreatedPreset } from './CreatedPreset';
import {
  graphAudioState,
  playbackState,
  rigAudioState,
  type AudioState,
  type RigAudioState,
  type GraphAudioState,
} from '../../api';
import { playScenes } from '../../presetChoices';
vi.mock('../../api', () => ({
  graphAudioState: vi.fn(),
  playbackState: vi.fn(),
  rigAudioState: vi.fn(),
}));
vi.mock('../../presetChoices', () => ({ playScenes: vi.fn() }));
const native = {
  session: 'native',
  revision: 3,
  phase: 'running',
  modified: true,
} as AudioState;
const mixed = {
  session: 'mixed',
  revision: 4,
  phase: 'running',
  control: { modified: true },
} as RigAudioState;
const effects = {
  session: 'effects',
  revision: 5,
  phase: 'running',
} as GraphAudioState;
beforeEach(() => {
  vi.mocked(playbackState).mockResolvedValue(native);
  vi.mocked(rigAudioState).mockResolvedValue(mixed);
  vi.mocked(graphAudioState).mockResolvedValue(effects);
  vi.mocked(playScenes).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function show() {
  const open = vi.fn(),
    dismiss = vi.fn();
  render(
    <CreatedPreset
      name="New clean"
      revision="new"
      connected
      onOpenRig={open}
      onDismiss={dismiss}
    />,
  );
  return { open, dismiss };
}
it('keeps creation and dismissal silent even with existing dirty owners', () => {
  const { dismiss, open } = show();
  expect(screen.getByText(/Your playing sound is unchanged/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Keep in Library' }));
  expect(dismiss).toHaveBeenCalledOnce();
  expect(playScenes).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect(playbackState).not.toHaveBeenCalled();
});
it('requires a separate playback review and explicit replacement confirmation', async () => {
  const { open } = show();
  fireEvent.click(screen.getByRole('button', { name: 'Play to edit…' }));
  await screen.findByRole('dialog');
  expect(screen.getByText(/Unsaved edits/)).toBeVisible();
  expect(playScenes).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(playScenes).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Play to edit…' }));
  await screen.findByRole('dialog');
  fireEvent.click(
    screen.getByRole('button', { name: 'Replace sound and play' }),
  );
  await waitFor(() => expect(open).toHaveBeenCalledOnce());
  expect(playScenes).toHaveBeenCalledExactlyOnceWith('new');
});
it.each(['native', 'mixed', 'effects'])(
  'rejects a stale %s playback review without discarding new work',
  async (owner) => {
    const { open } = show();
    fireEvent.click(screen.getByRole('button', { name: 'Play to edit…' }));
    await screen.findByRole('dialog');
    if (owner === 'native')
      vi.mocked(playbackState).mockResolvedValue({ ...native, revision: 8 });
    if (owner === 'mixed')
      vi.mocked(rigAudioState).mockResolvedValue({ ...mixed, revision: 8 });
    if (owner === 'effects')
      vi.mocked(graphAudioState).mockResolvedValue({ ...effects, revision: 8 });
    fireEvent.click(
      screen.getByRole('button', { name: 'Replace sound and play' }),
    );
    await screen.findByRole('alert');
    expect(playScenes).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  },
);
