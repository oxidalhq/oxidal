import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { deviceNetwork, type NetworkState } from './api';
import { DevicePower } from './DevicePower';
vi.mock('./api', () => ({ deviceNetwork: vi.fn() }));
const ready: NetworkState = {
  available: true,
  wireless_enabled: true,
  interfaces: [],
  networks: [],
  saved: [],
  pending: null,
  message: '',
  capabilities: { schema_version: 1, saved_connect: true, guarded_power: true },
};
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('requires confirmation and rechecks network state before requesting device power', async () => {
  vi.mocked(deviceNetwork).mockResolvedValue(ready);
  render(<DevicePower connected />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Restart device' }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Restart device' }));
  expect(deviceNetwork).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(deviceNetwork).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Restart device' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restart' }));
  await waitFor(() =>
    expect(deviceNetwork).toHaveBeenCalledWith({
      type: 'power',
      action: 'reboot',
    }),
  );
  expect(deviceNetwork).toHaveBeenCalledTimes(3);
  expect(await screen.findByText(/Request accepted/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Restart device' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Shut down device' }),
  ).toBeDisabled();
});
it('does not power off if a network change became pending after opening the section', async () => {
  vi.mocked(deviceNetwork)
    .mockResolvedValueOnce(ready)
    .mockResolvedValue({
      ...ready,
      pending: {
        transaction: 'a'.repeat(32),
        seconds_remaining: 80,
        phase: 'connecting',
      },
    });
  render(<DevicePower connected />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Shut down device' }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Shut down device' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm shutdown' }));
  await screen.findByRole('alert');
  expect(deviceNetwork).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('dialog')).toHaveTextContent(
    'Finish the pending network change',
  );
  expect(
    screen.getByRole('button', { name: 'Confirm shutdown' }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('refuses a helper without guarded-power support before sending a power command', async () => {
  vi.mocked(deviceNetwork).mockResolvedValue({
    ...ready,
    capabilities: undefined,
  });
  render(<DevicePower connected />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Restart device' }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Restart device' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restart' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'guarded power controls',
  );
  expect(vi.mocked(deviceNetwork).mock.calls).toEqual([[], []]);
});
