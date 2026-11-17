import * as React from 'react';
import {
  NetworkSettings,
  type HotspotPolicy,
  type WifiNetwork,
} from './network-settings';

const NETWORKS: WifiNetwork[] = [
  { ssid: 'Home 5G', strength: 3, secured: true, known: true },
  { ssid: 'Rehearsal Room', strength: 2, secured: true, known: true },
  { ssid: 'Venue Guest', strength: 1, secured: false, known: false },
  { ssid: 'Neighbour', strength: 1, secured: true, known: false },
];

/** Stands in for the device: a join waits 60 s for confirmation, then rolls back. */
export function NetworkSettingsDemo() {
  const [networks, setNetworks] = React.useState(NETWORKS);
  const [current, setCurrent] = React.useState('Home 5G');
  const [pending, setPending] = React.useState<
    { ssid: string; secondsLeft: number } | undefined
  >();
  const [policy, setPolicy] = React.useState<HotspotPolicy>('no-wifi');
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearInterval(timer.current)),
    [],
  );
  return (
    <NetworkSettings
      networks={networks}
      current={current}
      address="192.168.1.169"
      pending={pending}
      hotspot={{
        policy,
        name: 'Oxidal-7F2A · changed on 2 Nov',
        radio: 'United Kingdom · channel 6',
      }}
      onJoin={(ssid) => {
        let n = 60;
        setPending({ ssid, secondsLeft: n });
        timer.current = setInterval(() => {
          n -= 1;
          setPending(n > 0 ? { ssid, secondsLeft: n } : undefined);
          if (n <= 0 && timer.current) clearInterval(timer.current);
        }, 1000);
      }}
      onConfirm={(keep) => {
        if (timer.current) clearInterval(timer.current);
        if (keep && pending) setCurrent(pending.ssid);
        setPending(undefined);
      }}
      onForget={(ssid) =>
        setNetworks((all) =>
          all.map((n) => (n.ssid === ssid ? { ...n, known: false } : n)),
        )
      }
      onScan={() => {}}
      onPolicy={setPolicy}
      onChangeName={() => {}}
      onChangeRadio={() => {}}
    />
  );
}
