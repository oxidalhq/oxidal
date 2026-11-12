import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  calibration,
  changeEffectPack,
  effectPacks,
  installedLv2,
  libraryCatalog,
  presetDetails,
  publishRig,
} from '../../../api';
import catalog from '../../../fixtures/factory-lv2.json';
import { lv2ShowcaseRecipes } from '../../../recipes/lv2Showcase';
import { effectsOnlyNeeds, finishEffectsOnly, matchLevels } from './finish';

/** @see docs/factory-collection.md */
vi.mock('../../../api', () => ({
  calibration: vi.fn(async () => null),
  installedLv2: vi.fn(),
  libraryCatalog: vi.fn(),
  effectPacks: vi.fn(),
  changeEffectPack: vi.fn(),
  publishRig: vi.fn(),
  presetDetails: vi.fn(),
  rigLibrary: vi.fn(async () => ({
    native_profile: 'profile',
    presets: [],
    next: null,
  })),
  nativeDefaults: vi.fn(async () => ({
    revision: 'd',
    settings: { nam_size: 1, multi_core: true, parameters: {} },
  })),
}));

const pack = (id: string, installed: boolean) => ({
  id,
  installed,
  name: id.toUpperCase(),
  package: id,
  qualification: 'q',
  size_mib: 5,
  usable_plugins: 3,
  website: 'https://example.invalid',
});
const packs = (installed: boolean, patch = {}) => ({
  audio_running: false,
  available: true,
  message: '',
  storage_writable: true,
  packs: ['guitarix', 'mda', 'dragonfly', 'calf', 'x42', 'invada'].map((id) =>
    pack(id, installed),
  ),
  ...patch,
});
const sounds = lv2ShowcaseRecipes.slice(0, 3);

beforeEach(() => {
  vi.mocked(libraryCatalog).mockResolvedValue({
    revision: 'c',
    starter_offered: false,
    items: [],
  } as never);
  vi.mocked(installedLv2).mockResolvedValue([]);
  vi.mocked(effectPacks).mockResolvedValue(packs(false) as never);
  vi.mocked(publishRig).mockResolvedValue({ revision: 'r' } as never);
  vi.mocked(presetDetails).mockResolvedValue({
    revision: 'p',
    entries: [],
  } as never);
});
afterEach(() => vi.clearAllMocks());

it('a fresh unit: names the packs the sounds need and says why they cannot install', async () => {
  const needs = await effectsOnlyNeeds(sounds);
  expect(needs.unsaved).toHaveLength(3);
  expect(needs.packs.length).toBeGreaterThan(0);
  expect(needs.blocked).toBe('');
  vi.mocked(effectPacks).mockResolvedValue(
    packs(false, { audio_running: true }) as never,
  );
  expect((await effectsOnlyNeeds(sounds)).blocked).toMatch(/Stop audio/);
});

it('installs the packs, then saves each sound with its description', async () => {
  vi.mocked(changeEffectPack).mockImplementation(async (id) => {
    // The pack's effects appear once it is installed.
    vi.mocked(installedLv2).mockResolvedValue(catalog as never);
    return { ...packs(false), packs: [pack(id, true)] } as never;
  });
  const steps: string[] = [];
  expect(await finishEffectsOnly(sounds, (s) => steps.push(s))).toBe(3);
  expect(changeEffectPack).toHaveBeenCalled();
  expect(publishRig).toHaveBeenCalledTimes(3);
  expect(steps.some((s) => s.startsWith('Installing'))).toBe(true);
  expect(
    vi
      .mocked(presetDetails)
      .mock.calls.filter(([update]) => update?.description).length,
  ).toBe(3);
});

it('a pack that fails to install stops before anything is saved', async () => {
  vi.mocked(changeEffectPack).mockImplementation(
    async (id) =>
      ({
        ...packs(false, { message: 'No network.' }),
        packs: [pack(id, false)],
      }) as never,
  );
  await expect(finishEffectsOnly(sounds, () => {})).rejects.toThrow(
    'No network.',
  );
  expect(publishRig).not.toHaveBeenCalled();
});

it('sounds already saved on the unit are left alone', async () => {
  vi.mocked(libraryCatalog).mockResolvedValue({
    revision: 'c',
    starter_offered: false,
    items: sounds.map((r, i) => ({
      kind: 'rig',
      id: String(i),
      name: r.name,
      source_name: `Oxidal · ${r.name}`,
      origin: 'oxidal_example',
      archived: false,
      in_set_list: false,
    })),
  } as never);
  expect(await finishEffectsOnly(sounds, () => {})).toBe(0);
  expect(changeEffectPack).not.toHaveBeenCalled();
});

const levels = (progress = {}) =>
  ({
    target_lufs: -20,
    entries: [],
    progress: {
      running: false,
      done: 0,
      total: 0,
      measured: 0,
      current: null,
      failed: [],
      error: null,
      ...progress,
    },
  }) as never;

it('measures newly saved sounds and waits for the run to end', async () => {
  vi.useFakeTimers();
  vi.mocked(calibration)
    .mockResolvedValueOnce(levels({ running: true }))
    .mockResolvedValueOnce(levels({ running: true }))
    .mockResolvedValueOnce(levels({ measured: 4 }));
  const done = matchLevels();
  await vi.advanceTimersByTimeAsync(1000);
  expect(await done).toBe('');
  expect(vi.mocked(calibration).mock.calls[0]?.[0]).toBe('run');
  vi.useRealTimers();
});

it('says why a level could not be matched, without failing', async () => {
  vi.mocked(calibration).mockResolvedValueOnce(
    levels({ error: 'Stop the effects preset before evening out' }),
  );
  expect(await matchLevels()).toBe(
    'Its level is not matched yet: Stop the effects preset before evening out. Use Even out in Levels.',
  );
  vi.mocked(calibration).mockRejectedValueOnce(new Error('offline'));
  expect(await matchLevels()).toContain('offline');
});
