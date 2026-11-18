import { DownloadSimple } from '@phosphor-icons/react';
import * as React from 'react';

import { Button } from '../components/ui/button';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { StableLabel } from '../components/ui/stable-label';
import { Caption, Description } from '../components/ui/text';
import { SettingGroup, SettingRow } from './settings-page';

export type CertificateFile = {
  /** Where the device serves its public certificate. */
  href: string;
  fileName: string;
  /** SHA-256 fingerprint, to compare with what the phone or laptop shows. */
  fingerprint: string;
  /** Public certificate-only download while connected to the setup hotspot. */
  hotspotHref?: string;
};

type CopyState = 'Copy' | 'Copied' | 'Selected';
const COPY_STATES: CopyState[] = ['Copy', 'Copied', 'Selected'];

/** One address: tap to open it, or copy it to use on another device. */
function AddressRow({
  label,
  caption,
  url,
}: {
  label: string;
  caption: string;
  url: string;
}) {
  const [state, setState] = React.useState<CopyState>('Copy');
  const link = React.useRef<HTMLAnchorElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearTimeout(timer.current)),
    [],
  );
  const copy = async () => {
    let next: CopyState = 'Copied';
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // The browser refused: select the address so it can be copied by hand.
      if (link.current) window.getSelection()?.selectAllChildren(link.current);
      next = 'Selected';
    }
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('Copy'), 2000);
  };
  return (
    <SettingRow label={label} caption={caption} stacked>
      <a
        ref={link}
        href={url}
        className="min-w-0 flex-1 font-mono text-sm break-all underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring sm:w-56 sm:flex-none"
      >
        {url}
      </a>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        aria-label={`${state} ${url}`}
        onClick={copy}
      >
        <StableLabel value={state} options={COPY_STATES} />
      </Button>
    </SettingRow>
  );
}

/**
 * Every address that reaches the device, in the order to try them. The Wi-Fi
 * address says plainly that the browser warns there: the device certificate
 * names only the device's name and its hotspot address.
 */
export function DeviceAddresses({
  hostName,
  wifiAddress,
  wifiNetwork,
  hotspotAddress,
  networkAddresses = [],
}: {
  hostName: string;
  /** The address on the current Wi-Fi network, when it is on one. */
  wifiAddress?: string;
  wifiNetwork?: string;
  hotspotAddress: string;
  /** Current device readback, including wired interfaces when present. */
  networkAddresses?: readonly { label: string; address: string }[];
}) {
  return (
    <SettingGroup title="Ways to reach Oxidal">
      <Description className="mb-1">
        Open one of these on a phone, tablet or laptop connected to the same
        network as Oxidal.
      </Description>
      <AddressRow
        label="Name"
        caption="Try this first."
        url={`https://${hostName}`}
      />
      {wifiAddress && (
        <AddressRow
          label={wifiNetwork ? `Address on ${wifiNetwork}` : 'Wi-Fi address'}
          caption={`If ${hostName} will not open. Your browser warns at this address even with the certificate installed, and it can change when the router restarts.`}
          url={`https://${wifiAddress}`}
        />
      )}
      {networkAddresses.map(({ label, address }) => (
        <AddressRow
          key={address}
          label={label}
          caption={`If ${hostName} will not open. Your browser warns at this address even with the certificate installed, and it can change when the router restarts.`}
          url={`https://${address}`}
        />
      ))}
      <AddressRow
        label="Address on the hotspot"
        caption="While connected to Oxidal's hotspot."
        url={`https://${hotspotAddress}`}
      />
    </SettingGroup>
  );
}

type DeviceKind = 'iphone' | 'android' | 'mac' | 'windows';

const GUIDES: Record<
  DeviceKind,
  { name: string; heading: string; steps: string[] }
> = {
  iphone: {
    name: 'iPhone',
    heading: 'On an iPhone or iPad',
    steps: [
      'Open this page in Safari, tap Download certificate, then Allow.',
      'Open the Settings app, tap Profile Downloaded near the top, then Install.',
      'Go to General › About › Certificate Trust Settings and turn on Oxidal personal device CA.',
    ],
  },
  android: {
    name: 'Android',
    heading: 'On an Android phone or tablet, or a BOOX',
    steps: [
      'Tap Download certificate.',
      'Open the Settings app and search for "CA certificate".',
      'Choose to install a CA certificate, tap Install anyway, then pick the downloaded file.',
    ],
  },
  mac: {
    name: 'Mac',
    heading: 'On a Mac',
    steps: [
      'Click Download certificate and open the file, which adds it to Keychain Access.',
      'In Keychain Access, find Oxidal personal device CA and double-click it.',
      'Under Trust, set "When using this certificate" to Always Trust, then close the window and confirm.',
    ],
  },
  windows: {
    name: 'Windows',
    heading: 'On a Windows laptop',
    steps: [
      'Click Download certificate, open the file and choose Install Certificate.',
      'Choose Current User, then place it in the store named Trusted Root Certification Authorities.',
      'Finish, and accept the security question that follows.',
    ],
  },
};

/** Start on the steps for the device in the player's hand. */
const deviceInHand = (): DeviceKind => {
  const agent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/android/i.test(agent)) return 'android';
  if (/iphone|ipad/i.test(agent)) return 'iphone';
  if (/windows/i.test(agent)) return 'windows';
  if (/macintosh/i.test(agent))
    return navigator.maxTouchPoints > 1 ? 'iphone' : 'mac';
  return 'iphone';
};

/**
 * The device's certificate: what it is for, the download, and the steps for
 * each kind of device. Installed once per phone, tablet or laptop.
 */
export function DeviceCertificate({
  certificate,
  hostName,
}: {
  certificate: CertificateFile;
  hostName: string;
}) {
  const [kind, setKind] = React.useState<DeviceKind>(deviceInHand);
  const guide = GUIDES[kind];
  return (
    <SettingGroup title="Security certificate">
      <Description className="mb-1">
        Browsers warn that the connection is not private until they know your
        Oxidal. Install its certificate once on each phone, tablet or laptop and
        the warning goes away. Only install it from an Oxidal you own.
      </Description>
      <SettingRow label="Oxidal certificate" caption={certificate.fileName}>
        <Button asChild size="sm">
          <a href={certificate.href} download={certificate.fileName}>
            <DownloadSimple aria-hidden="true" /> Download certificate
          </a>
        </Button>
      </SettingRow>
      {certificate.hotspotHref && (
        <Caption>
          If a certificate warning blocks access, connect to Oxidal's hotspot
          and open{' '}
          <a className="break-all underline" href={certificate.hotspotHref}>
            {certificate.hotspotHref}
          </a>{' '}
          to download the public certificate.
        </Caption>
      )}
      <SettingRow
        label="Fingerprint"
        caption="If your device shows one while installing, it should match this."
        stacked
      >
        <code className="min-w-0 font-mono text-xs break-all text-muted-foreground">
          {certificate.fingerprint}
        </code>
      </SettingRow>
      <div className="grid gap-2 pt-3">
        <SegmentedControl
          size="sm"
          aria-label="Your device"
          value={kind}
          onValueChange={(v) => v && setKind(v as DeviceKind)}
          className="w-full"
        >
          {(Object.keys(GUIDES) as DeviceKind[]).map((k) => (
            <Segment key={k} value={k}>
              {GUIDES[k].name}
            </Segment>
          ))}
        </SegmentedControl>
        <h4 className="m-0 mt-1 text-sm font-medium">{guide.heading}</h4>
        <ol className="m-0 grid list-decimal gap-1.5 pl-5 text-sm">
          {guide.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <Caption className="text-xs">
          Then close the browser, open it again and go to https://{hostName}.
        </Caption>
      </div>
    </SettingGroup>
  );
}
