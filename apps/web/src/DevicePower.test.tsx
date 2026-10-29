import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { DevicePower } from './DevicePower';
import { deviceNetwork, type NetworkState } from './api';
vi.mock('./api', () => ({ deviceNetwork: vi.fn() }));
vi.mock('./AdjustmentDialog', () => ({
  AdjustmentDialog: ({ children }: { children: ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));
const ready = { available: true, pending: null } as NetworkState;
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
});
it('does not power off if a network change became pending after opening the section', async () => {
  vi.mocked(deviceNetwork)
    .mockResolvedValueOnce(ready)
    .mockResolvedValue({ ...ready, pending: {} } as NetworkState);
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
});
