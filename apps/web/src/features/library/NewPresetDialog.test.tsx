import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { publishRig, rigLibrary, rigNativeSources } from '../../api';
import { DeviceError } from '../../lib/friendlyError';
import { NewPresetDialog } from './NewPresetDialog';

vi.mock('../../api', () => ({
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
