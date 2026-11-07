import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EffectPacks } from './EffectPacks';
import { DeviceError } from './lib/friendlyError';
import {
  rigLibrary,
  changeEffectPack,
  effectPacks,
  type EffectPacks as EffectPacksState,
} from './api';

vi.mock('./api', () => ({
  changeEffectPack: vi.fn(),
  effectPacks: vi.fn(),
  rigLibrary: vi.fn(),
}));

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

const inventory: EffectPacksState = {
  available: true,
  audio_running: false,
  storage_writable: true,
  job: null,
  message: '',
  packs: [
    {
      id: 'dragonfly',
      name: 'Dragonfly Reverb',
      website: 'https://github.com/michaelwillis/dragonfly-reverb',
      package: 'dragonfly-reverb-lv2',
      size_mib: 9,
      usable_plugins: 4,
      installed: false,
      version: null,
      qualification: 'ARM64 harness',
    },
    {
      id: 'swh',
      name: 'SWH',
      website: 'http://plugin.org.uk/',
      package: 'swh-lv2',
      size_mib: 3,
      usable_plugins: 78,
      installed: true,
      version: '1.0',
      qualification: 'ARM64 harness and this Pi',
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('shows only the curated inventory and starts a device-owned install', async () => {
  vi.mocked(effectPacks).mockResolvedValue(inventory);
  vi.mocked(changeEffectPack).mockResolvedValue({
    ...inventory,
    job: { pack: 'dragonfly', action: 'install', phase: 'running' },
  });
  render(<EffectPacks connected audioRunning={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
  await waitFor(() =>
    expect(changeEffectPack).toHaveBeenCalledWith('dragonfly', 'install'),
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Installing Dragonfly Reverb',
  );
  expect(screen.getByText(/78 usable effects/)).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Website' })[0]).toHaveAttribute(
    'href',
    'https://github.com/michaelwillis/dragonfly-reverb',
  );
  expect(screen.getAllByRole('link', { name: 'Website' })[0]).toHaveAttribute(
    'target',
    '_blank',
  );
});

it('refuses changes while audio plays and confirms removal in a dialog', async () => {
  vi.mocked(effectPacks).mockResolvedValue(inventory);
  vi.mocked(changeEffectPack).mockResolvedValue({
    ...inventory,
    job: { pack: 'swh', action: 'remove', phase: 'running' },
  });
  const view = render(<EffectPacks connected audioRunning />);
  expect(await screen.findByRole('button', { name: 'Remove' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Stop audio');

  view.rerender(<EffectPacks connected audioRunning={false} />);
  const remove = screen.getByRole('button', { name: 'Remove' });
  fireEvent.click(remove);
  expect(changeEffectPack).not.toHaveBeenCalled();
  expect(
    screen.getByRole('dialog', { name: 'Remove SWH?' }),
  ).toBeInTheDocument();
  // Without the preset list Oxidal cannot tell, so removal needs a confirmation.
  expect(screen.getByText(/could not check which saved presets/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Remove effects' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove effects' }));
  await waitFor(() =>
    expect(changeEffectPack).toHaveBeenCalledWith('swh', 'remove'),
  );
});

it('keeps apt actions unavailable while the active system root is locked', async () => {
  vi.mocked(effectPacks).mockResolvedValue({
    ...inventory,
    storage_writable: false,
  });
  render(<EffectPacks connected audioRunning={false} />);
  expect(await screen.findByRole('button', { name: 'Install' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('Unlock system storage');
});

it('offers Try again when an install fails because the device is busy', async () => {
  vi.mocked(effectPacks).mockResolvedValue(inventory);
  vi.mocked(changeEffectPack).mockRejectedValueOnce(
    new DeviceError('Another pack change is already in progress', 'busy', 409),
  );
  vi.mocked(changeEffectPack).mockResolvedValue(inventory);
  render(<EffectPacks connected audioRunning={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not change effect packs. Another change is still running on the device.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(changeEffectPack).toHaveBeenCalledTimes(2));
  expect(changeEffectPack).toHaveBeenLastCalledWith('dragonfly', 'install');
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

it('names the saved presets a removal would leave unplayable', async () => {
  vi.mocked(effectPacks).mockResolvedValue(inventory);
  vi.mocked(rigLibrary)
    .mockResolvedValueOnce({
      native_profile: 'p',
      next: 'r1',
      presets: [
        {
          id: 'a',
          revision: 'r1',
          name: 'Swh Phaser',
          origin: 'mine',
          native_instances: 0,
          lv2_instances: 1,
          topology: 'serial',
          lv2_plugins: ['http://plugin.org.uk/swh-plugins/phasers'],
        },
      ],
    } as Awaited<ReturnType<typeof rigLibrary>>)
    .mockResolvedValueOnce({
      native_profile: 'p',
      next: null,
      presets: [
        {
          id: 'b',
          revision: 'r2',
          name: 'Clean',
          origin: 'mine',
          native_instances: 1,
          lv2_instances: 0,
          topology: 'serial',
          lv2_plugins: [],
        },
      ],
    } as Awaited<ReturnType<typeof rigLibrary>>);
  render(<EffectPacks connected audioRunning={false} />);
  expect(await screen.findByText(/Used by 1 preset/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  const users = screen.getByRole('list', {
    name: 'Presets that use these effects',
  });
  expect(users).toHaveTextContent('Swh Phaser');
  expect(users).not.toHaveTextContent('Clean');
  expect(screen.getByRole('button', { name: 'Remove effects' })).toBeDisabled();
});

it('says when no effect pack is installed', async () => {
  vi.mocked(effectPacks).mockResolvedValue({
    ...inventory,
    packs: inventory.packs.map((p) => ({ ...p, installed: false })),
  });
  vi.mocked(rigLibrary).mockResolvedValue({
    native_profile: 'p',
    next: null,
    presets: [],
  } as Awaited<ReturnType<typeof rigLibrary>>);
  render(<EffectPacks connected audioRunning={false} />);
  expect(
    await screen.findByText(/No effect packs installed yet/),
  ).toBeVisible();
});
