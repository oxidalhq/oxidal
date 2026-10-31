import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EffectPacks } from './EffectPacks';
import {
  changeEffectPack,
  effectPacks,
  type EffectPacks as EffectPacksState,
} from './api';

vi.mock('./api', () => ({
  changeEffectPack: vi.fn(),
  effectPacks: vi.fn(),
}));

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

it('refuses changes while audio plays and confirms removal inline', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }));
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
