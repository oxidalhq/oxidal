import { Lock, WifiHigh, WifiLow, WifiMedium } from '@phosphor-icons/react';
import * as React from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import { List, ListRow } from '../components/ui/list-row';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Description } from '../components/ui/text';
import { ConfirmChange } from './confirm-change';
import {
  type CertificateFile,
  DeviceAddresses,
  DeviceCertificate,
} from './device-access';
import { SettingGroup, SettingRow } from './settings-page';

export type WifiNetwork = {
  ssid: string;
  /** Signal bars, 1 to 3. */
  strength: number;
  secured: boolean;
  /** Saved on the device. */
  known: boolean;
};
export type HotspotPolicy = 'no-wifi' | 'always' | 'boot' | 'button' | 'never';
export type Hotspot = {
  policy: HotspotPolicy;
  /** Name and when its password last changed, such as "Oxidal-7F2A · changed on 2 Nov". */
  name: string;
  /** Country and channel, such as "United Kingdom · channel 6". */
  radio: string;
};

const Bars = ({ n }: { n: number }) =>
  n >= 3 ? (
    <WifiHigh aria-hidden="true" />
  ) : n === 2 ? (
    <WifiMedium aria-hidden="true" />
  ) : (
    <WifiLow aria-hidden="true" />
  );

/**
 * Settings › Network: the networks the device can see, joining one, the
 * device's own hotspot, every address that reaches it, and the certificate
 * that stops browsers warning. A change that could cut this screen off (a
 * new network, a new hotspot password) has to be confirmed from the new
 * connection within a minute, or the device goes back to how it was.
 */
export function NetworkSettings({
  networks,
  current,
  address,
  pending,
  hotspot,
  hostName,
  hotspotAddress,
  certificate,
  onJoin,
  onForget,
  onScan,
  onConfirm,
  onPolicy,
  onChangeName,
  onChangeRadio,
}: {
  networks: WifiNetwork[];
  /** The network the device is on now. */
  current: string;
  /** The device's address on it. */
  address: string;
  /** A network just joined, waiting for confirmation, and the seconds left. */
  pending?: { ssid: string; secondsLeft: number };
  hotspot: Hotspot;
  /** The device's name on the network, such as "oxidal.local". */
  hostName: string;
  /** The device's address on its own hotspot, such as "10.42.0.1". */
  hotspotAddress: string;
  certificate: CertificateFile;
  /** Join a network; the password only for a new secured one. */
  onJoin: (ssid: string, password?: string) => void;
  onForget: (ssid: string) => void;
  onScan: () => void;
  /** Keep the new network (true) or go back now (false). */
  onConfirm: (keep: boolean) => void;
  onPolicy: (policy: HotspotPolicy) => void;
  onChangeName: () => void;
  onChangeRadio: () => void;
}) {
  const [joining, setJoining] = React.useState<string | null>(null);
  const [password, setPassword] = React.useState('');
  const join = (ssid: string, secret?: string) => {
    setJoining(null);
    setPassword('');
    onJoin(ssid, secret);
  };
  return (
    <div data-slot="network-settings" className="grid gap-6">
      <ConfirmChange
        open={Boolean(pending)}
        title={`Keep ${pending?.ssid ?? ''}?`}
        body={
          <>
            The device joined {pending?.ssid}. If you can see this, keep it.
            Otherwise it goes back to {current} so you can reach it again.
          </>
        }
        secondsLeft={pending?.secondsLeft ?? 0}
        totalSeconds={60}
        keepLabel={`Keep ${pending?.ssid ?? ''}`}
        onKeep={() => onConfirm(true)}
        onGoBack={() => onConfirm(false)}
      />
      <SettingGroup title="Wi-Fi">
        <List aria-label="Networks">
          {networks.map((n) => (
            <ListRow
              key={n.ssid}
              leading={<Bars n={n.strength} />}
              title={n.ssid}
              caption={
                n.ssid === pending?.ssid
                  ? 'Joined · waiting for you to keep it'
                  : n.ssid === current && pending
                    ? 'Previous network · goes back here if not kept'
                    : n.ssid === current
                      ? `Connected · ${address}`
                      : n.known
                        ? 'Saved'
                        : n.secured
                          ? 'Needs a password'
                          : 'Open network'
              }
              trailing={
                <span className="flex items-center gap-1">
                  {n.secured && (
                    <Lock
                      aria-label="Secured"
                      className="size-4 text-muted-foreground"
                    />
                  )}
                  {n.ssid === pending?.ssid ? (
                    <Badge size="sm" tone="selected">
                      Joined
                    </Badge>
                  ) : n.ssid === current ? (
                    <Badge size="sm">
                      {pending ? 'Previous' : 'Connected'}
                    </Badge>
                  ) : (
                    <>
                      {n.known && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Forget ${n.ssid}`}
                          onClick={() => onForget(n.ssid)}
                        >
                          Forget
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Join ${n.ssid}`}
                        onClick={() =>
                          n.known || !n.secured
                            ? join(n.ssid)
                            : setJoining(n.ssid)
                        }
                      >
                        Join
                      </Button>
                    </>
                  )}
                </span>
              }
            />
          ))}
        </List>
        <Button
          size="sm"
          variant="ghost"
          className="justify-self-start"
          onClick={onScan}
        >
          Scan again
        </Button>
      </SettingGroup>
      <SettingGroup title="Hotspot">
        <Description className="mb-1">
          A hotspot is Oxidal's own Wi-Fi network. Where there is no Wi-Fi to
          join, connect your phone or tablet to it like any other network. It
          has no internet, so your phone may say so: stay connected.
        </Description>
        <SettingRow label="Turn the hotspot on" stacked>
          <Select
            value={hotspot.policy}
            onValueChange={(v) => onPolicy(v as HotspotPolicy)}
          >
            <SelectTrigger aria-label="Turn the hotspot on" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no-wifi">
                When no saved Wi-Fi is in range
              </SelectItem>
              <SelectItem value="always">Always</SelectItem>
              <SelectItem value="boot">
                For ten minutes after power-on
              </SelectItem>
              <SelectItem value="button">Only when I turn it on</SelectItem>
              <SelectItem value="never">Never</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow label="Name and password" caption={hotspot.name}>
          <Button size="sm" variant="outline" onClick={onChangeName}>
            Change…
          </Button>
        </SettingRow>
        <SettingRow label="Country and channel" caption={hotspot.radio}>
          <Button size="sm" variant="outline" onClick={onChangeRadio}>
            Change…
          </Button>
        </SettingRow>
      </SettingGroup>
      <DeviceAddresses
        hostName={hostName}
        wifiAddress={address}
        wifiNetwork={current}
        hotspotAddress={hotspotAddress}
      />
      <DeviceCertificate certificate={certificate} hostName={hostName} />
      <Dialog
        open={Boolean(joining)}
        onOpenChange={(o) => !o && setJoining(null)}
      >
        <DialogContent>
          <DialogHeader
            title={`Join ${joining}`}
            description="The password stays on the device."
          />
          <DialogBody>
            <label className="grid gap-0.5">
              <span className="small-caps text-xs text-muted-foreground">
                Password
              </span>
              <input
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJoining(null)}>
              Cancel
            </Button>
            <Button onClick={() => joining && join(joining, password)}>
              Join
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
