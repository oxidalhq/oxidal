import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { FactoryCollection, UnbuiltSounds } from './FactoryCollection';
import {
  downloadVoice,
  installedLv2,
  presetDetails,
  publishRig,
  tone3000Tone,
  voiceCaptures,
} from './api';
import type { RigNativeSource } from './generated/contract';
import catalog from './fixtures/factory-lv2.json';
import { allFactoryRecipes } from './factoryCatalog';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
vi.mock('./api', () => ({
  installedLv2: vi.fn(async () => catalog),
  nativeDefaults: vi.fn(async () => ({
    revision: 'defaults-1',
    settings: {
      nam_size: 1,
      multi_core: true,
      parameters: {
        osEnabled: 1,
        osFactor: 1,
        pitchEnabled: 0,
        pitchWindow: 0.33333334,
        inputCalibrationLevel: 0.5968333,
        calibrateInput: 1,
        targetLoudness: 0.7,
      },
    },
  })),
  rigNativeSources: vi.fn(async () => []),
  rigLibrary: vi.fn(async () => ({
    native_profile: 'profile',
    presets: [],
    next: null,
  })),
  publishRig: vi.fn(async () => ({ revision: 'a'.repeat(64) })),
  presetDetails: vi.fn(async () => ({ revision: 'details-1', entries: [] })),
  voiceCaptures: vi.fn(async () => []),
  tone3000Tone: vi.fn(),
  downloadVoice: vi.fn(),
  toneImage: (id: number) => `/api/v1/tone3000/tones/${id}/image`,
}));
const nativeSource: RigNativeSource = {
  preset: {
    sha256: 'b'.repeat(64),
    name: 'Downloaded capture',
    size_bytes: 100,
    framing: 'current',
    block_count: 1,
    embedded_bytes: 20,
    parameter_count: 1,
    playback_available: true,
  },
  source: { kind: 'owned', preset: 'owned-voice-1' },
};
const tone = {
  id: 65578,
  title: 'Plexi test capture',
  user: { username: 'maker', display_name: null },
  gear: 'amp-cab',
  format: 'nam',
  license: 'cc-by',
  images: null,
  url: 'https://example.invalid/tone',
  models_count: 1,
  a1_models_count: 0,
  a2_models_count: 1,
  custom_models_count: 0,
};
it('builds an effect-only example without touching transport, then reports it built', async () => {
  const user = userEvent.setup();
  const changed = vi.fn();
  render(<FactoryCollection connected onChanged={changed} />);
  await user.click(
    screen.getByRole('button', { name: 'Explore Oxidal sounds' }),
  );
  const explore = screen.getByRole('button', { name: 'Explore Afterlight' });
  await waitFor(() => expect(explore).toBeEnabled());
  await user.click(explore);
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Build preset' }));
  await user.click(await screen.findByRole('button', { name: 'Done' }));
  await screen.findByText('Built');
  expect(changed).toHaveBeenCalledOnce();
  expect(publishRig).toHaveBeenCalledOnce();
  const request = vi.mocked(publishRig).mock.calls[0]![0];
  const manifest = JSON.parse(request.manifest_json);
  expect(manifest.extensions['urn:oxidal:authoring'].factory_recipe).toBe(
    'A01',
  );
  expect(manifest.oxidal.recall.tails).toBe('preserve');
  expect(presetDetails).toHaveBeenLastCalledWith(
    expect.objectContaining({
      entry_kind: 'rig',
      id: 'a'.repeat(64),
      expected_revision: 'details-1',
    }),
  );
});
it('requires an explicit saved NAM source before enabling a native recipe', async () => {
  const user = userEvent.setup();
  render(<FactoryCollection connected onChanged={() => {}} />);
  await user.click(
    screen.getByRole('button', { name: 'Explore Oxidal sounds' }),
  );
  const explore = screen.getByRole('button', { name: 'Explore Clear Current' });
  await waitFor(() => expect(explore).toBeEnabled());
  await user.click(explore);
  expect(screen.getByRole('combobox')).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Build preset' })).toBeDisabled();
});

it('finds the expanded bank by genre and retains the search after visiting a recipe', async () => {
  const user = userEvent.setup();
  render(<FactoryCollection connected onChanged={() => {}} />);
  await user.click(
    screen.getByRole('button', { name: 'Explore Oxidal sounds' }),
  );
  expect(
    screen.getByText(new RegExp(`${allFactoryRecipes.length} starting points`)),
  ).toBeVisible();
  for (const family of [
    'Space & ambience',
    'Bass',
    'Clean & studio',
    'Heavy',
    'Rock & drive',
    'Roots & rhythm',
    'Synth & pitch',
    'Experimental',
  ])
    expect(
      screen.getByRole('heading', { name: family, level: 3 }),
    ).toBeVisible();
  const search = screen.getByRole('searchbox', {
    name: 'Find a factory sound',
  });
  await user.type(search, 'shoegaze');
  expect(
    screen.getByRole('heading', { name: 'Space & ambience', level: 3 }),
  ).toBeVisible();
  expect(
    screen.queryByRole('heading', { name: 'Heavy', level: 3 }),
  ).not.toBeInTheDocument();
  const explore = screen.getByRole('button', { name: 'Explore Soft Ruin' });
  await waitFor(() => expect(explore).toBeEnabled());
  expect(
    screen.queryByRole('button', { name: 'Explore Clear Current' }),
  ).not.toBeInTheDocument();
  await user.click(explore);
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('searchbox')).toHaveValue('shoegaze');
  await user.clear(screen.getByRole('searchbox'));
  await user.type(screen.getByRole('searchbox'), 'serial chain');
  expect(
    screen.getByRole('button', { name: 'Explore Night Conveyor' }),
  ).toBeVisible();
  expect(screen.getByText('7 serial blocks · 0 NAM stages')).toBeVisible();
  await user.clear(screen.getByRole('searchbox'));
  await user.type(screen.getByRole('searchbox'), 'unmatched-query');
  expect(screen.getByRole('status')).toHaveTextContent('No matching sounds');
});

it('explains an unavailable catalog before the disabled recipe list', async () => {
  vi.mocked(installedLv2).mockRejectedValueOnce(
    new Error('LV2 discovery is unavailable'),
  );
  const user = userEvent.setup();
  render(<FactoryCollection connected onChanged={() => {}} />);
  await user.click(
    screen.getByRole('button', { name: 'Explore Oxidal sounds' }),
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Factory assembly unavailable',
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'You can still browse and search these sounds',
  );
  expect(
    screen.getByRole('button', { name: 'Explore Afterlight' }),
  ).toBeDisabled();
});

it('offers one download for a missing voice, then builds with the downloaded capture', async () => {
  const user = userEvent.setup();
  vi.mocked(tone3000Tone).mockResolvedValue(tone);
  vi.mocked(downloadVoice).mockResolvedValue({
    downloaded: true,
    capture: { tone_id: 65578, model_id: 418470, source: nativeSource },
  });
  render(<FactoryCollection connected onChanged={() => {}} />);
  await user.click(
    screen.getByRole('button', { name: 'Explore Oxidal sounds' }),
  );
  await user.type(
    screen.getByRole('searchbox', { name: 'Find a factory sound' }),
    'Brown Crunch',
  );
  expect(screen.getByText('Needs download')).toBeVisible();
  const explore = screen.getByRole('button', { name: 'Explore Brown Crunch' });
  await waitFor(() => expect(explore).toBeEnabled());
  await user.click(explore);
  // The capture is shown as TONE3000 presents it, and nothing downloads yet.
  await screen.findByText(
    /TONE3000 · Plexi test capture · maker · licence cc-by/,
  );
  expect(downloadVoice).not.toHaveBeenCalled();
  const build = screen.getByRole('button', { name: 'Build preset' });
  expect(build).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Download' }));
  expect(downloadVoice).toHaveBeenCalledExactlyOnceWith(
    65578,
    418470,
    'Plexi test capture',
  );
  await waitFor(() => expect(build).toBeEnabled());
  await user.click(build);
  await user.click(await screen.findByRole('button', { name: 'Done' }));
  await screen.findByText('Built');
  const request = vi.mocked(publishRig).mock.calls.at(-1)![0];
  const manifest = JSON.parse(request.manifest_json);
  expect(manifest.name).toBe('Brown Crunch');
  expect(manifest.tone3000.instances).toHaveLength(1);
});

it('uses a capture already on the device without downloading again', async () => {
  const user = userEvent.setup();
  vi.mocked(voiceCaptures).mockResolvedValue([
    { tone_id: 65578, model_id: 418470, source: nativeSource },
  ]);
  vi.mocked(downloadVoice).mockClear();
  render(<FactoryCollection connected onChanged={() => {}} />);
  await user.click(
    screen.getByRole('button', { name: 'Explore Oxidal sounds' }),
  );
  await user.type(
    screen.getByRole('searchbox', { name: 'Find a factory sound' }),
    'Brown Crunch',
  );
  expect(screen.queryByText('Needs download')).not.toBeInTheDocument();
  const explore = screen.getByRole('button', { name: 'Explore Brown Crunch' });
  await waitFor(() => expect(explore).toBeEnabled());
  await user.click(explore);
  expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Build preset' })).toBeEnabled(),
  );
  expect(downloadVoice).not.toHaveBeenCalled();
});

it('lists unbuilt sounds as rows and opens one at its download', async () => {
  const user = userEvent.setup();
  vi.mocked(tone3000Tone).mockResolvedValue(tone);
  vi.mocked(voiceCaptures).mockResolvedValue([]);
  render(
    <UnbuiltSounds connected query="Brown" refresh={0} onChanged={() => {}} />,
  );
  const row = await screen.findByRole('button', { name: 'Get Brown Crunch' });
  expect(row).toHaveTextContent('Needs download');
  expect(screen.queryByRole('button', { name: /Get Tight Eight/ })).toBeNull();
  await user.click(row);
  expect(await screen.findByRole('button', { name: 'Download' })).toBeVisible();
});
