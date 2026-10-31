import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { FactoryCollection } from './FactoryCollection';
import { publishRig, presetDetails } from './api';
import catalog from './fixtures/factory-lv2.json';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
vi.mock('./api', () => ({
  installedLv2: vi.fn(async () => catalog),
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
