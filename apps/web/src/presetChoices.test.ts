import { afterEach, expect, it, vi } from 'vitest';
import {
  graphAudioState,
  playbackState,
  rigAudioCommand,
  rigAudioState,
} from './api';
import { discardsSceneEdits, playScenes } from './presetChoices';
vi.mock('./api', () => ({
  graphAudioCommand: vi.fn(),
  graphAudioState: vi.fn(),
  nativeState: vi.fn(),
  playbackCommand: vi.fn(),
  playbackState: vi.fn(),
  presetLibrary: vi.fn(),
  rigAudioCommand: vi.fn(),
  rigAudioState: vi.fn(),
  rigLibrary: vi.fn(),
}));
afterEach(() => {
  vi.resetAllMocks();
});
const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
const scenes = (revision: string) =>
  ({ kind: 'scenes', revision, name: revision, scenes: [] }) as const;

it('asks before another scenes preset replaces unsaved edits, unless it is kept ready', () => {
  const playing = { revision: a, modified: true, ready: [] as string[] };
  expect(discardsSceneEdits(scenes(b), playing)).toBe(true);
  expect(discardsSceneEdits(scenes(a), playing)).toBe(false);
  expect(discardsSceneEdits(scenes(b), { ...playing, ready: [b] })).toBe(false);
  expect(discardsSceneEdits(scenes(b), { ...playing, modified: false })).toBe(
    false,
  );
  expect(
    discardsSceneEdits(
      { kind: 'tone3000', id: 'x', owned: false, name: 'x' },
      playing,
    ),
  ).toBe(false);
});

it('resumes the last scenes preset with its edits instead of starting it fresh', async () => {
  const stopped = {
    phase: 'stopped',
    device_owned: false,
    configured: { revision: a, stream: {} },
  };
  vi.mocked(rigAudioState).mockResolvedValue(stopped as never);
  vi.mocked(playbackState).mockResolvedValue({ device_owned: false } as never);
  vi.mocked(graphAudioState).mockResolvedValue({
    device_owned: false,
  } as never);
  await playScenes(a);
  expect(rigAudioCommand).toHaveBeenCalledTimes(1);
  expect(vi.mocked(rigAudioCommand).mock.calls[0]![1]).toEqual({
    kind: 'restart',
  });
  await playScenes(b);
  expect(vi.mocked(rigAudioCommand).mock.calls[1]![1]).toMatchObject({
    kind: 'start',
    settings: { revision: b, recall: null },
  });
});
