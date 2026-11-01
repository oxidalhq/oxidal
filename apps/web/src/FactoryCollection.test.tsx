import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { FactoryCollection } from './FactoryCollection';
import { installedLv2, publishRig, presetDetails } from './api';
import catalog from './fixtures/factory-lv2.json';
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
  rigLibrary: vi.fn(async () => ({ native_profile: 'profile' })),
  publishRig: vi.fn(async () => ({ revision: 'a'.repeat(64) })),
  presetDetails: vi.fn(async () => ({ revision: 'details-1', entries: [] })),
}));
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
  expect(screen.getByText(/44 starting points/)).toBeVisible();
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
