import * as React from 'react';

import { DeviceAddresses, DeviceCertificate } from './device-access';
import {
  type NetworkChange,
  NetworkChangeDialog,
  type NetworkDraft,
} from './network-change-dialog';
import {
  type HotspotPolicy,
  NetworkSettings,
  type WifiNetwork,
} from './network-settings';

const NETWORKS: WifiNetwork[] = [
  { ssid: 'Home 5G', strength: 3, secured: true, savedId: 'home' },
  { ssid: 'Rehearsal Room', strength: 2, secured: true, savedId: 'rehearsal' },
  { ssid: 'Venue Guest', strength: 1, secured: false },
  { ssid: 'Neighbour', strength: 1, secured: true },
];

/** Device stand-in using the same 90-second operations and controlled forms. */
export function NetworkSettingsDemo() {
  const [saved, setSaved] = React.useState([
    {
      uuid: 'home',
      name: 'Home 5G',
      active: true,
      managed: true,
      canConnect: true,
    },
    {
      uuid: 'rehearsal',
      name: 'Rehearsal Room',
      active: false,
      managed: true,
      canConnect: true,
    },
  ]);
  const [current, setCurrent] = React.useState('Home 5G');
  const [draft, setDraft] = React.useState<NetworkDraft | null>(null);
  const [pending, setPending] = React.useState<
    { change: NetworkChange; label?: string; secondsLeft: number } | undefined
  >();
  const [policy, setPolicy] = React.useState<HotspotPolicy>('no_remembered');
  const [hotspot, setHotspot] = React.useState('Oxidal-7F2A');
  const [country, setCountry] = React.useState('NZ');
  const [channel, setChannel] = React.useState(6);
  const [home, setHome] = React.useState('Home 5G');
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearInterval(timer.current)),
    [],
  );
  return (
    <NetworkSettings
      networks={NETWORKS.map((network) => ({
        ...network,
        connected: network.ssid === current,
        savedId: saved.find((profile) => profile.name === network.ssid)?.uuid,
      }))}
      saved={saved}
      current={current}
      address="192.168.1.169"
      pending={pending}
      hotspot={{
        policy,
        name: hotspot,
        radio: `${country} · channel ${channel}`,
        canEditRadio: true,
      }}
      access={
        <>
          <DeviceAddresses
            hostName="oxidal.local"
            wifiAddress="192.168.1.169"
            wifiNetwork={current}
            hotspotAddress="10.42.0.1"
          />
          <DeviceCertificate
            hostName="oxidal.local"
            certificate={{
              href: '/examples/oxidal-ca.crt',
              fileName: 'oxidal-ca.crt',
              fingerprint:
                '7F:2A:91:0C:5E:D4:18:B3:6A:27:C9:40:EE:13:8D:72:AF:05:6B:C1:39:D8:64:1E:92:FB:07:5C:A3:48:E6:2D',
            }}
          />
        </>
      }
      onJoin={(ssid, secured) => setDraft({ kind: 'join', ssid, secured })}
      onManualJoin={() => setDraft({ kind: 'join', ssid: '', secured: true })}
      onConnect={(uuid) =>
        setDraft({
          kind: 'saved',
          uuid,
          ssid: saved.find((profile) => profile.uuid === uuid)!.name,
        })
      }
      onForget={(uuid) =>
        setDraft({
          kind: 'forget',
          uuid,
          ssid: saved.find((profile) => profile.uuid === uuid)!.name,
        })
      }
      onConfirm={(keep) => {
        if (timer.current) clearInterval(timer.current);
        if (keep && pending) {
          const change = pending.change;
          if (
            change.type === 'join' ||
            change.type === 'join_open' ||
            change.type === 'connect'
          ) {
            const name =
              'ssid' in change
                ? change.ssid
                : saved.find((profile) => profile.uuid === change.uuid)!.name;
            setCurrent(name);
            setSaved((all) =>
              all.map((profile) => ({
                ...profile,
                active: profile.name === name,
              })),
            );
          }
          if (change.type === 'hotspot') setHotspot(change.ssid);
          if (change.type === 'hotspot_radio' || change.type === 'hotspot') {
            if (change.country) setCountry(change.country);
            if (change.channel !== undefined) setChannel(change.channel);
          }
          if (change.type === 'policy') {
            setPolicy(change.settings.mode);
            setHome(change.settings.home_ssid);
          }
        }
        setPending(undefined);
      }}
      onScan={() => {}}
      onPolicy={(value) => setDraft({ kind: 'policy', policy: value })}
      onChangeName={() => setDraft({ kind: 'hotspot' })}
      onChangeRadio={() => setDraft({ kind: 'radio' })}
      dialogs={
        draft && (
          <NetworkChangeDialog
            draft={draft}
            interfaces={['wlan0']}
            defaultInterface="wlan0"
            hotspotName={hotspot}
            hotspotChannel={channel}
            radio={{ country, channels: [1, 6, 11] }}
            homeSsid={home}
            onCancel={() => setDraft(null)}
            onApply={(change) => {
              setDraft(null);
              if (change.type === 'forget') {
                setSaved((all) =>
                  all.filter((profile) => profile.uuid !== change.uuid),
                );
                return;
              }
              const label =
                'ssid' in change
                  ? change.ssid
                  : change.type === 'connect'
                    ? saved.find((profile) => profile.uuid === change.uuid)!
                        .name
                    : undefined;
              let n = 90;
              setPending({ change, label, secondsLeft: n });
              timer.current = setInterval(() => {
                n -= 1;
                setPending(
                  n > 0 ? { change, label, secondsLeft: n } : undefined,
                );
                if (n <= 0 && timer.current) clearInterval(timer.current);
              }, 1000);
            }}
          />
        )
      }
    />
  );
}
