import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  graphAudioState,
  nativeState,
  presetLibrary,
  rigLibrary,
  libraryCatalog,
  presetDetails,
  playbackState,
  rigAudioCommand,
  rigAudioState,
} from './api';
import {
  discardsSceneEdits,
  gaplessBank,
  loadPresetChoices,
  choiceKey,
  playScenes,
  rigTopologyLabel,
  type PresetChoice,
} from './presetChoices';
vi.mock('./api', () => ({
  graphAudioCommand: vi.fn(),
  graphAudioState: vi.fn(),
  nativeState: vi.fn(),
  presetDetails: vi.fn().mockResolvedValue({ revision: 'empty', entries: [] }),
  libraryCatalog: vi.fn().mockResolvedValue({ revision: 'empty', items: [] }),
  playbackCommand: vi.fn(),
  playbackState: vi.fn(),
  presetLibrary: vi.fn(),
  rigAudioCommand: vi.fn(),
  rigAudioState: vi.fn(),
  rigLibrary: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(presetDetails).mockResolvedValue({
    revision: 'empty',
    entries: [],
  });
});
afterEach(() => {
  vi.resetAllMocks();
});
const a = 'a'.repeat(64);
const b = 'b'.repeat(64);
const scenes = (revision: string): PresetChoice => ({
  kind: 'scenes',
  revision,
  name: revision,
  scenes: [],
  topology: 'serial',
  nativeInstances: 1,
  lv2Instances: 2,
  origin: 'mine',
});

it('makes bounded adjacent live banks without inventing an engine lane limit', () => {
  const revisions = ['a', 'b', 'c', 'd', 'e'].map((letter) =>
    letter.repeat(64),
  );
  expect(gaplessBank(revisions[2]!, revisions)).toEqual(revisions.slice(0, 4));
  expect(gaplessBank(revisions[4]!, revisions)).toEqual(revisions.slice(4));
});

it('describes routing and actual processor counts without treating scenes as lanes', () => {
  expect(
    rigTopologyLabel({
      topology: 'serial',
      scenes: [],
      native_instances: 2,
      lv2_instances: 6,
    }),
  ).toBe('Serial chain · 2 native engines · 6 effects');
  expect(
    rigTopologyLabel({
      topology: 'parallel',
      scenes: [],
      native_instances: 2,
      lv2_instances: 1,
    }),
  ).toBe('Parallel graph · 2 native engines · 1 effect');
  expect(
    rigTopologyLabel({
      topology: 'scenes',
      scenes: ['Clean', 'Crunch', 'Heavy'],
      native_instances: 3,
      lv2_instances: 0,
    }),
  ).toBe('3 scenes · 3 native engines · 0 effects');
});

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
      {
        kind: 'tone3000',
        id: 'x',
        owned: false,
        name: 'x',
        origin: 'tone3000',
      },
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

it('starts an adjacent live bank so later preset choices use the resident switch', async () => {
  const stopped = {
    phase: 'stopped',
    device_owned: false,
    configured: { revision: 'c'.repeat(64), stream: {} },
  };
  vi.mocked(rigAudioState).mockResolvedValue(stopped as never);
  vi.mocked(playbackState).mockResolvedValue({ device_owned: false } as never);
  vi.mocked(graphAudioState).mockResolvedValue({
    device_owned: false,
  } as never);
  await playScenes(a, [a, b]);
  expect(vi.mocked(rigAudioCommand).mock.calls.at(-1)?.[1]).toMatchObject({
    kind: 'start',
    settings: {
      revision: a,
      prepared: [{ revision: b, recall: null }],
    },
  });
});

it('switches inside the loaded live bank without releasing the interface', async () => {
  vi.mocked(rigAudioState).mockResolvedValue({
    phase: 'running',
    configured: {
      revision: a,
      stream: { input: { sample_rate: 48_000 } },
    },
    control: {
      session: 'resident',
      revision: 7,
      prepared: [{ revision: b, error: null }],
    },
  } as never);
  await playScenes(b, [a, b]);
  expect(rigAudioCommand).toHaveBeenCalledWith(expect.anything(), {
    kind: 'switch',
    command: {
      session: 'resident',
      expected_revision: 7,
      revision: b,
      fade_frames: 480,
    },
  });
  expect(playbackState).not.toHaveBeenCalled();
  expect(graphAudioState).not.toHaveBeenCalled();
});

it('uses one cross-kind catalog order and ignores archived stale source rows', async () => {
  vi.mocked(presetLibrary).mockResolvedValue([
    { sha256: 'a', name: 'Original A' },
    { sha256: 'b', name: 'Original B' },
  ] as never);
  vi.mocked(nativeState).mockResolvedValue({
    owned: [{ id: 'a', preset: { name: 'Copy' } }],
  } as never);
  vi.mocked(rigLibrary).mockResolvedValue({
    presets: [
      {
        revision: 'r',
        name: 'Scenes',
        scenes: ['Clean', 'Heavy'],
        topology: 'scenes',
        native_instances: 2,
        lv2_instances: 0,
      },
    ],
  } as never);
  const item = (
    kind: 'original' | 'owned' | 'rig',
    id: string,
    name: string,
    archived = false,
  ) => ({ kind, id, name, source_name: name, archived });
  vi.mocked(libraryCatalog).mockResolvedValue({
    revision: 'confirmed',
    items: [
      item('original', 'b', 'First'),
      item('rig', 'r', 'Scenes'),
      item('owned', 'a', 'Copy'),
      item('original', 'a', 'Original A', true),
    ],
  });
  const result = await loadPresetChoices();
  expect(result.items.map(choiceKey)).toEqual([
    'original:b',
    'scenes:r',
    'copy:a',
  ]);
  expect(result.items[0]?.name).toBe('First');
  expect(result.error).toBe('');
});
