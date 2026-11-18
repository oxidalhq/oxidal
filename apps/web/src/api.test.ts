import { afterEach, describe, expect, it, vi } from 'vitest';

import { deviceCertificate, deviceNetwork, parseSnapshot } from './api';

afterEach(() => vi.unstubAllGlobals());

const certificate = {
  schema_version: 1,
  file_name: 'oxidal-ca.crt',
  fingerprint_sha256: Array(32).fill('AB').join(':'),
  https_download: '/api/v1/device/certificate',
  hotspot_download: '/certificate.crt',
  server_names: ['oxidal.local', '10.42.0.1'],
};

describe('runtime contract validation', () => {
  it('rejects incomplete or future protocol state instead of showing a false value', () => {
    expect(() => parseSnapshot({ revision: 1 })).toThrow(
      'Incompatible device state',
    );
    expect(() => parseSnapshot({ protocol: 2 })).toThrow(
      'Incompatible device state',
    );
  });

  it('accepts the generated public-certificate contract from the fixed endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(certificate));
    vi.stubGlobal('fetch', fetcher);
    await expect(deviceCertificate()).resolves.toEqual(certificate);
    expect(fetcher).toHaveBeenCalledWith('/api/v1/device/certificate.json', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
  });

  it('accepts public hotspot readback and older helpers without a summary', async () => {
    const old = {
      available: true,
      wireless_enabled: true,
      radio: null,
      policy: null,
      interfaces: [],
      networks: [],
      saved: [],
      pending: null,
      message: '',
    };
    const current = {
      ...old,
      hotspot: { ssid: 'Actual device name', channel: 0 },
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(old))
        .mockResolvedValueOnce(Response.json(current)),
    );
    await expect(deviceNetwork()).resolves.toEqual(old);
    await expect(deviceNetwork()).resolves.toEqual(current);
  });

  it.each([
    { ssid: 'Device', channel: -1 },
    { ssid: 'Device', channel: 'Automatic' },
    { ssid: 'Device', channel: 6, password: 'must never be present' },
  ])('rejects incompatible hotspot readback: %j', async (hotspot) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          available: true,
          wireless_enabled: true,
          radio: null,
          policy: null,
          interfaces: [],
          networks: [],
          saved: [],
          pending: null,
          message: '',
          hotspot,
        }),
      ),
    );
    await expect(deviceNetwork()).rejects.toThrow(
      'Incompatible network response',
    );
  });

  it.each([
    { schema_version: 2 },
    { fingerprint_sha256: 'not a fingerprint' },
    { https_download: 'https://another-device.invalid/certificate' },
    { hotspot_download: '/private.key' },
    { server_names: ['another-device.local'] },
    { file_name: 'private.key' },
  ])('refuses incompatible certificate metadata: %j', async (change) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ ...certificate, ...change })),
    );
    await expect(deviceCertificate()).rejects.toThrow(
      'Incompatible device certificate response',
    );
  });
});
