import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';

import { deviceCertificate, type NetworkState } from './api';
import { DeviceAccess } from './DeviceAccess';

vi.mock('./api', () => ({ deviceCertificate: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const certificate = {
  schema_version: 1,
  file_name: 'oxidal-ca.crt',
  fingerprint_sha256: Array(32).fill('AB').join(':'),
  https_download: '/api/v1/device/certificate',
  hotspot_download: '/certificate.crt',
  server_names: ['oxidal.local', '10.42.0.1'],
};
const network: NetworkState = {
  available: true,
  wireless_enabled: true,
  message: '',
  networks: [],
  saved: [],
  interfaces: [
    {
      name: 'wlan0',
      kind: 'wifi',
      state: 'connected',
      connection: 'Studio',
      addresses: ['192.168.1.50'],
    },
    {
      name: 'eth0',
      kind: 'ethernet',
      state: 'connected',
      connection: 'Wired',
      addresses: ['192.168.2.50'],
    },
    {
      name: 'hotspot',
      kind: 'wifi',
      state: 'connected',
      connection: 'oxidal-hotspot',
      addresses: ['10.42.0.1'],
    },
  ],
};

it('shows real wired and wireless addresses, replaces remote readback and serves only the public download', async () => {
  vi.mocked(deviceCertificate).mockResolvedValue(certificate);
  const view = render(<DeviceAccess network={network} />);
  const download = await screen.findByRole('link', {
    name: 'Download certificate',
  });
  expect(download).toHaveAttribute('href', '/api/v1/device/certificate');
  expect(download).toHaveAttribute('download', 'oxidal-ca.crt');
  expect(screen.getByText(certificate.fingerprint_sha256)).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'https://192.168.1.50' }),
  ).toBeVisible();
  expect(
    screen.getByRole('link', { name: 'https://192.168.2.50' }),
  ).toBeVisible();
  expect(
    screen.getAllByRole('link', { name: 'https://10.42.0.1' }),
  ).toHaveLength(1);
  expect(
    screen.getByRole('link', { name: 'http://10.42.0.1/certificate.crt' }),
  ).toHaveAttribute('href', 'http://10.42.0.1/certificate.crt');
  view.rerender(
    <DeviceAccess
      network={{
        ...network,
        interfaces: [],
        address_message: 'Addresses unavailable',
      }}
    />,
  );
  expect(
    screen.queryByRole('link', { name: 'https://192.168.1.50' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('Addresses unavailable')).toBeVisible();
  expect(deviceCertificate).toHaveBeenCalledTimes(1);
});

it('offers retry after a missing certificate without inventing a fingerprint or download', async () => {
  vi.mocked(deviceCertificate)
    .mockRejectedValueOnce(new Error('not installed'))
    .mockResolvedValueOnce(certificate);
  const user = userEvent.setup();
  render(<DeviceAccess network={null} />);
  const retry = await screen.findByRole('button', {
    name: 'Retry certificate',
  });
  expect(
    screen.queryByRole('link', { name: 'Download certificate' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText(certificate.fingerprint_sha256),
  ).not.toBeInTheDocument();
  await user.click(retry);
  expect(
    await screen.findByRole('link', { name: 'Download certificate' }),
  ).toBeVisible();
  expect(deviceCertificate).toHaveBeenCalledTimes(2);
});
