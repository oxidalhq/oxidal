import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StorageLock } from './StorageLock';
import { changeStorage, deviceNetwork, type StorageState } from './api';

vi.mock('./api', () => ({
  changeStorage: vi.fn(),
  deviceNetwork: vi.fn(),
}));
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open');
};

const unlocked: StorageState = {
  available: true,
  current: 'unlocked',
  next_boot: 'unlocked',
  reboot_required: false,
  message: '',
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('schedules Locked for the next boot without claiming a live remount', async () => {
  const next: StorageState = {
    ...unlocked,
    next_boot: 'locked',
    reboot_required: true,
    message: 'Storage mode changes at the next restart',
  };
  vi.mocked(changeStorage).mockResolvedValue(next);
  const onState = vi.fn();
  render(<StorageLock connected state={unlocked} onState={onState} />);
  expect(screen.getByText('Unlocked now')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Locked/ }));
  await waitFor(() =>
    expect(changeStorage).toHaveBeenCalledWith({ mode: 'locked' }),
  );
  expect(onState).toHaveBeenCalledWith(next);
  expect(screen.queryByText('Reboot now')).not.toBeInTheDocument();
});

it('requires confirmation before rebooting into the scheduled mode', async () => {
  const scheduled: StorageState = {
    ...unlocked,
    next_boot: 'locked',
    reboot_required: true,
    message: 'Storage mode changes at the next restart',
  };
  vi.mocked(deviceNetwork)
    .mockResolvedValueOnce({ available: true, pending: null } as never)
    .mockResolvedValueOnce({ available: true, pending: null } as never);
  render(<StorageLock connected state={scheduled} onState={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reboot now' }));
  expect(
    screen.getByRole('dialog', { name: 'Restart into Locked mode?' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restart' }));
  await waitFor(() =>
    expect(deviceNetwork).toHaveBeenLastCalledWith({
      type: 'power',
      action: 'reboot',
    }),
  );
  expect(screen.getByText(/Restart requested/)).toBeInTheDocument();
});

it('explains why pre-layout installations cannot be locked', () => {
  render(
    <StorageLock
      connected
      state={{
        available: false,
        current: 'unlocked',
        next_boot: 'unlocked',
        reboot_required: false,
        message: 'Storage lock requires the appliance writable-data layout',
      }}
      onState={() => {}}
    />,
  );
  expect(screen.getByRole('button', { name: /Locked/ })).toBeDisabled();
  expect(screen.getByRole('status')).toHaveTextContent('writable-data layout');
});
