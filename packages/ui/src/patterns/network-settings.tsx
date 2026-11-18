import { Lock, WifiHigh, WifiLow, WifiMedium } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
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
import { SettingGroup, SettingRow } from './settings-page';

export type WifiNetwork = {
  ssid: string;
  /** Signal bars, 1 to 3. */
  strength: number;
  secured: boolean;
  connected?: boolean;
  /** Exactly one eligible saved profile for this SSID; otherwise use saved rows. */
  savedId?: string;
  joinDisabled?: boolean;
  reason?: string;
};
export type HotspotPolicy =
  'never' | 'no_ethernet' | 'not_at_home' | 'no_remembered' | 'always';
export type SavedWifiNetwork = {
  uuid: string;
  name: string;
  active: boolean;
  managed: boolean;
  canConnect?: boolean;
};
export type Hotspot = {
  policy?: HotspotPolicy;
  name: string;
  radio: string;
  canEditRadio?: boolean;
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
 * connection within 90 seconds, or the device goes back to how it was.
 */
export function NetworkSettings({
  networks,
  current,
  address,
  pending,
  hotspot,
  saved,
  disabled = false,
  busy = false,
  notice,
  interfaceControl,
  access,
  dialogs,
  onManualJoin,
  onConnect,
  onJoin,
  onForget,
  onScan,
  onConfirm,
  onPolicy,
  onChangeName,
  onChangeRadio,
}: {
  networks: WifiNetwork[];
  current: string;
  address: string;
  pending?: {
    label?: string;
    secondsLeft: number;
    applying?: string;
    recovery?: ReactNode;
  };
  hotspot: Hotspot;
  saved: SavedWifiNetwork[];
  disabled?: boolean;
  busy?: boolean;
  notice?: ReactNode;
  interfaceControl?: ReactNode;
  access: ReactNode;
  dialogs?: ReactNode;
  onManualJoin: () => void;
  onJoin: (ssid: string, secured: boolean) => void;
  onConnect: (uuid: string) => void;
  onForget: (uuid: string) => void;
  onScan: () => void;
  /** Keep the new network (true) or go back now (false). */
  onConfirm: (keep: boolean) => void;
  onPolicy: (policy: HotspotPolicy) => void;
  onChangeName: () => void;
  onChangeRadio: () => void;
}) {
  return (
    <div data-slot="network-settings" className="grid gap-6">
      {notice}
      <ConfirmChange
        open={Boolean(pending)}
        title={
          pending?.label ? `Keep ${pending.label}?` : 'Keep this connection?'
        }
        body={
          <>
            Reconnect to the new Wi-Fi or hotspot and keep this connection.
            Otherwise the previous network returns automatically.
          </>
        }
        applying={busy ? 'Updating network settings…' : pending?.applying}
        disabled={disabled || busy || (pending?.secondsLeft ?? 0) <= 0}
        recovery={pending?.recovery}
        canGoBackWhileApplying
        secondsLeft={pending?.secondsLeft ?? 0}
        totalSeconds={90}
        keepLabel={
          pending?.label ? `Keep ${pending.label}` : 'Keep this connection'
        }
        onKeep={() => onConfirm(true)}
        onGoBack={() => onConfirm(false)}
      />
      <SettingGroup title="Wi-Fi">
        <List aria-label="Networks">
          {networks.length === 0 && (
            <Description>
              No nearby networks. Scan again or enter a Wi-Fi name.
            </Description>
          )}
          {networks.map((n) => (
            <ListRow
              key={`${n.ssid}-${n.secured}`}
              leading={<Bars n={n.strength} />}
              title={n.ssid}
              caption={
                n.ssid === pending?.label
                  ? 'Joined · waiting for you to keep it'
                  : n.ssid === current && pending
                    ? 'Previous network · goes back here if not kept'
                    : n.connected
                      ? `Connected${address ? ` · ${address}` : ''}`
                      : n.reason
                        ? n.reason
                        : n.savedId
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
                  {n.ssid === pending?.label ? (
                    <Badge size="sm" tone="selected">
                      Joined
                    </Badge>
                  ) : n.connected ? (
                    <Badge size="sm">
                      {pending ? 'Previous' : 'Connected'}
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Join ${n.ssid}`}
                      disabled={
                        disabled || busy || Boolean(pending) || n.joinDisabled
                      }
                      onClick={() =>
                        n.savedId
                          ? onConnect(n.savedId)
                          : onJoin(n.ssid, n.secured)
                      }
                    >
                      Join
                    </Button>
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
          disabled={busy}
          onClick={onScan}
        >
          Scan again
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="justify-self-start"
          disabled={disabled || busy || Boolean(pending)}
          onClick={onManualJoin}
        >
          Enter Wi-Fi name…
        </Button>
        {interfaceControl}
        <details>
          <summary className="min-h-touch cursor-pointer py-3 text-sm">
            Saved networks
          </summary>
          <List aria-label="Saved networks">
            {saved.length === 0 && (
              <Description>No saved networks.</Description>
            )}
            {saved.map((profile) => (
              <ListRow
                key={profile.uuid}
                title={profile.name}
                caption={
                  profile.active
                    ? 'Connected'
                    : profile.managed
                      ? `Saved · ${profile.uuid}`
                      : 'Managed outside Oxidal'
                }
                trailing={
                  profile.managed &&
                  !profile.active && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={disabled || busy || Boolean(pending)}
                        aria-label={`Forget saved ${profile.name} (${profile.uuid})`}
                        onClick={() => onForget(profile.uuid)}
                      >
                        Forget
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          disabled ||
                          busy ||
                          Boolean(pending) ||
                          !profile.canConnect
                        }
                        aria-label={`Connect saved ${profile.name} (${profile.uuid})`}
                        onClick={() => onConnect(profile.uuid)}
                      >
                        Join
                      </Button>
                    </>
                  )
                }
              />
            ))}
          </List>
        </details>
      </SettingGroup>
      <SettingGroup title="Hotspot">
        <Description className="mb-1">
          A hotspot is Oxidal's own Wi-Fi network. Where there is no Wi-Fi to
          join, connect your phone or tablet to it like any other network. It
          has no internet, so your phone may say so: stay connected.
        </Description>
        <SettingRow label="Turn the hotspot on" stacked>
          <Select
            value={hotspot.policy ?? ''}
            disabled={disabled || busy || Boolean(pending)}
            onValueChange={(v) => onPolicy(v as HotspotPolicy)}
          >
            <SelectTrigger aria-label="Turn the hotspot on" className="w-full">
              <SelectValue placeholder="Appliance default" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no_remembered">
                When no saved Wi-Fi is in range
              </SelectItem>
              <SelectItem value="always">Always</SelectItem>
              <SelectItem value="no_ethernet">
                When Ethernet is disconnected
              </SelectItem>
              <SelectItem value="not_at_home">
                When home Wi-Fi is out of range
              </SelectItem>
              <SelectItem value="never">Never</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow label="Name and password" caption={hotspot.name}>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || busy || Boolean(pending)}
            onClick={onChangeName}
          >
            Change…
          </Button>
        </SettingRow>
        <SettingRow label="Country and channel" caption={hotspot.radio}>
          <Button
            size="sm"
            variant="outline"
            disabled={
              disabled || busy || Boolean(pending) || !hotspot.canEditRadio
            }
            onClick={onChangeRadio}
          >
            Change…
          </Button>
        </SettingRow>
      </SettingGroup>
      {access}
      {dialogs}
    </div>
  );
}
