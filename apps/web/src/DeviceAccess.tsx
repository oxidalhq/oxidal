import { useEffect, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { StateNotice } from '@oxidal/design-system/components/states';
import { Caption } from '@oxidal/design-system/components/text';
import {
  DeviceAddresses,
  DeviceCertificate,
} from '@oxidal/design-system/patterns/device-access';

import {
  deviceCertificate,
  type NetworkState,
  type PublicCertificate,
} from './api';

/** Actual reachability and public certificate; no network mutation ownership.
 * @see docs/device-service.md
 */
export function DeviceAccess({ network }: { network: NetworkState | null }) {
  const [certificate, setCertificate] = useState<PublicCertificate | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void deviceCertificate().then(
      (value) => {
        if (active) setCertificate(value);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  const addresses = new Map<string, string>();
  for (const iface of network?.available ? network.interfaces : []) {
    for (const address of iface.addresses ?? []) {
      if (address === '10.42.0.1') continue;
      const label =
        iface.kind === 'wifi' && iface.connection && iface.connection !== '--'
          ? `Address on ${iface.connection}`
          : `Address via ${iface.name}`;
      if (!addresses.has(address)) addresses.set(address, label);
    }
  }
  return (
    <div data-slot="device-access" className="grid gap-6">
      <DeviceAddresses
        hostName="oxidal.local"
        hotspotAddress="10.42.0.1"
        networkAddresses={[...addresses].map(([address, label]) => ({
          address,
          label,
        }))}
      />
      {(!network || !network.available || network.address_message) && (
        <Caption>
          {network?.address_message ||
            'Current network addresses are unavailable.'}
        </Caption>
      )}
      {certificate ? (
        <DeviceCertificate
          hostName="oxidal.local"
          certificate={{
            href: '/api/v1/device/certificate',
            fileName: certificate.file_name,
            fingerprint: certificate.fingerprint_sha256,
            hotspotHref: certificate.hotspot_download
              ? 'http://10.42.0.1/certificate.crt'
              : undefined,
          }}
        />
      ) : (
        <StateNotice
          kind={failed ? 'error' : 'loading'}
          title={
            failed ? 'Certificate unavailable' : 'Reading device certificate…'
          }
          action={
            failed && (
              <Button
                variant="outline"
                onClick={() => {
                  setFailed(false);
                  setAttempt((value) => value + 1);
                }}
              >
                Retry certificate
              </Button>
            )
          }
        >
          {failed
            ? 'The certificate is not available from this device yet. Retry after the device has been updated.'
            : undefined}
        </StateNotice>
      )}
    </div>
  );
}
