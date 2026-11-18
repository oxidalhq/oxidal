import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import {
  changeStorage,
  deviceNetwork,
  type NetworkState,
  type StorageState,
} from './api';
import { StorageLock } from './StorageLock';

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
  const network: NetworkState = {
    available: true,
    wireless_enabled: true,
    interfaces: [],
    networks: [],
    saved: [],
    pending: null,
    message: '',
    capabilities: {
      schema_version: 1,
      saved_connect: true,
      guarded_power: true,
    },
  };
  vi.mocked(deviceNetwork).mockResolvedValue(network);
  render(<StorageLock connected state={scheduled} onState={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Reboot now' }));
  expect(
    screen.getByRole('dialog', { name: 'Restart into Locked mode?' }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restart' }));
  await waitFor(() =>
    expect(deviceNetwork).toHaveBeenLastCalledWith({
      type: 'restart_storage',
      expected_mode: 'locked',
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

it('keeps unknown storage explicit and never offers a restart without a known next mode', () => {
  render(
    <StorageLock
      connected
      state={{
        available: false,
        current: null,
        next_boot: null,
        reboot_required: true,
        message: 'Storage state is unavailable',
      }}
      onState={() => {}}
    />,
  );
  expect(screen.getByText('Current state unknown')).toBeInTheDocument();
  expect(screen.getByText('Next boot: Unknown.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Locked/ })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'Reboot now' }),
  ).not.toBeInTheDocument();
  expect(changeStorage).not.toHaveBeenCalled();
  expect(deviceNetwork).not.toHaveBeenCalled();
});

it('keeps the reviewed mode fixed and refuses a locally changed queue before any power request', () => {
  const scheduled: StorageState = {
    ...unlocked,
    next_boot: 'locked',
    reboot_required: true,
  };
  const view = render(
    <StorageLock connected state={scheduled} onState={() => {}} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Reboot now' }));
  view.rerender(
    <StorageLock
      connected
      state={{ ...scheduled, next_boot: 'unlocked', reboot_required: false }}
      onState={() => {}}
    />,
  );
  expect(
    screen.getByRole('dialog', { name: 'Restart into Locked mode?' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Storage mode changed');
  expect(
    screen.getByRole('button', { name: 'Confirm restart' }),
  ).toBeDisabled();
  expect(deviceNetwork).not.toHaveBeenCalled();
});
