import { afterEach, describe, expect, it, vi } from 'vitest';

import { deviceCertificate, parseSnapshot } from './api';

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
