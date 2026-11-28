import { type ComponentProps, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@oxidal/design-system/components/select';
import { StateNotice } from '@oxidal/design-system/components/states';
import { Description } from '@oxidal/design-system/components/text';
import {
  NetworkChangeDialog,
  type NetworkDraft,
} from '@oxidal/design-system/patterns/network-change-dialog';
import { NetworkSettings as NetworkSettingsView } from '@oxidal/design-system/patterns/network-settings';
import {
  SettingDisclosure,
  SettingNotice,
  SettingRow,
} from '@oxidal/design-system/patterns/settings-page';

import { DeviceAccess } from './DeviceAccess';
import { useDeviceNetwork } from './useDeviceNetwork';

/** Phone-first setup with explicit link-loss warning and server-owned recovery.
 * @see docs/device-service.md
 */
export function NetworkSettings({ connected }: { connected: boolean }) {
  const { state, error, readError, busy, refresh, run, joinedSsid } =
    useDeviceNetwork(connected);
  const [iface, setIface] = useState('');
  const [edit, setEdit] = useState<Omit<
    ComponentProps<typeof NetworkChangeDialog>,
    'onApply' | 'onCancel' | 'disabled'
  > | null>(null);
  const wireless =
    state?.interfaces.filter((device) => device.kind === 'wifi') ?? [];
  const interfaceName = wireless.some((device) => device.name === iface)
    ? iface
    : (wireless[0]?.name ?? '');
  const disabled =
    !connected || Boolean(readError) || !state?.available || !interfaceName;
  const capabilities = state?.capabilities;
  const active = wireless.find((device) => device.state === 'connected');
  const current =
    state?.networks.find((network) => network.active)?.ssid ||
    state?.saved.find((profile) => profile.active)?.ssid ||
    (active?.connection === 'oxidal-hotspot' ? state?.hotspot?.ssid : '') ||
    '';
  const address =
    active?.addresses?.find((value) => value !== '10.42.0.1') ?? '';
  const savedName = (uuid: string) => {
    const profile = state?.saved.find((value) => value.uuid === uuid);
    return (
      profile?.ssid ?? `${profile?.name ?? 'Saved network'} · SSID unavailable`
    );
  };
  function open(draft: NetworkDraft) {
    if (disabled || busy || state?.pending) return;
    setEdit({
      draft,
      interfaces: wireless.map((device) => device.name),
      defaultInterface: interfaceName,
      hotspotName: state?.hotspot?.ssid,
      hotspotChannel: state?.hotspot?.channel,
      radio: state?.radio ?? undefined,
      homeSsid: state?.policy?.home_ssid,
    });
  }
  const refreshButton = (
    <Button
      size="sm"
      variant="outline"
      disabled={busy || !connected}
      onClick={() => void refresh()}
    >
      Refresh network
    </Button>
  );
  return (
    <section aria-label="Wi-Fi and hotspot">
      <NetworkSettingsView
        networks={(state?.networks ?? []).map((network) => {
          const secured = Boolean(
            network.security && network.security !== '--',
          );
          const saved =
            state?.saved.filter(
              (profile) =>
                profile.managed &&
                !profile.active &&
                profile.ssid === network.ssid,
            ) ?? [];
          const savedId = saved.length === 1 ? saved[0]!.uuid : undefined;
          const supportedSecurity =
            !secured ||
            (/WPA2/.test(network.security) &&
              !/802\.1X|EAP/.test(network.security));
          const ambiguous =
            !secured &&
            state?.networks.some(
              (other) =>
                other.ssid === network.ssid &&
                other.security &&
                other.security !== '--',
            );
          const joinDisabled =
            saved.length > 1
              ? true
              : savedId
                ? !capabilities?.saved_connect
                : !supportedSecurity ||
                  (!secured && (!capabilities?.open_join || ambiguous));
          return {
            ssid: network.ssid,
            strength: network.signal >= 66 ? 3 : network.signal >= 33 ? 2 : 1,
            secured,
            savedId,
            connected: network.active,
            joinDisabled: Boolean(joinDisabled),
            reason: !supportedSecurity
              ? 'Requires WPA2 Personal'
              : ambiguous
                ? 'Also advertised as secured · choose a different network'
                : saved.length > 1
                  ? 'Choose a saved profile below'
                  : joinDisabled
                    ? 'Update device service to join this network'
                    : undefined,
          };
        })}
        current={current}
        address={address}
        saved={(state?.saved ?? []).map((profile) => ({
          ...profile,
          name: savedName(profile.uuid),
          canConnect: Boolean(capabilities?.saved_connect),
        }))}
        disabled={disabled}
        busy={busy}
        pending={
          state?.pending
            ? {
                secondsLeft: state.pending.seconds_remaining,
                label: joinedSsid,
                applying:
                  state.pending.phase !== 'awaiting_confirmation'
                    ? 'Connecting… Reconnect your browser to the device.'
                    : undefined,
                recovery: (
                  <>
                    {readError && (
                      <Description role="alert">{readError}</Description>
                    )}
                    {error && <Description role="alert">{error}</Description>}
                    {refreshButton}
                  </>
                ),
              }
            : undefined
        }
        hotspot={{
          policy: state?.policy?.mode,
          name:
            state?.hotspot?.ssid ??
            state?.hotspot_message ??
            'Hotspot name unavailable',
          radio:
            state?.radio && state.hotspot
              ? `${state.radio.country} · ${state.hotspot.channel === 0 ? 'automatic channel' : `channel ${state.hotspot.channel}`}`
              : 'Country and channel unavailable',
          canEditRadio: Boolean(
            capabilities?.hotspot_radio && state?.radio && state.hotspot,
          ),
        }}
        notice={
          <>
            {(!state || !state.available) && (
              <StateNotice
                kind={state ? 'error' : 'loading'}
                title={state?.message || 'Reading device network…'}
                action={refreshButton}
              />
            )}
            {readError && (
              <SettingNotice tone="error">{readError}</SettingNotice>
            )}
            {error && <SettingNotice tone="error">{error}</SettingNotice>}
            {state?.available && state.message && (
              <SettingNotice tone="warning">{state.message}</SettingNotice>
            )}
            {state?.available && !state.wireless_enabled && (
              <SettingNotice tone="warning">Wi-Fi is off.</SettingNotice>
            )}
            {state?.saved_message && (
              <SettingNotice>{state.saved_message}</SettingNotice>
            )}
            {state?.available &&
              (!capabilities?.saved_connect ||
                !capabilities.open_join ||
                !capabilities.hotspot_radio) && (
                <SettingNotice>
                  Update the device service to enable saved-network
                  reconnection, open-network join and separate radio changes.
                  WPA2 setup remains available.
                </SettingNotice>
              )}
            {!connected && (
              <SettingNotice tone="warning">
                Reconnect to Oxidal before changing the network.
              </SettingNotice>
            )}
          </>
        }
        interfaceControl={
          <>
            <SettingRow id="wireless-interface" label="Wireless interface">
              <Select
                value={interfaceName}
                disabled={busy || Boolean(state?.pending)}
                onValueChange={setIface}
              >
                <SelectTrigger
                  id="wireless-interface"
                  size="sm"
                  aria-label="Wireless interface"
                  className="w-40"
                >
                  <SelectValue placeholder="No wireless interface" />
                </SelectTrigger>
                <SelectContent>
                  {wireless.map((device) => (
                    <SelectItem key={device.name} value={device.name}>
                      {device.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingRow>
            <SettingDisclosure
              label="Connection details"
              caption="Each network interface and what it is connected to."
            >
              <ul aria-label="Network interfaces" className="m-0 grid p-0">
                {state?.interfaces.map((device) => (
                  <li
                    key={device.name}
                    className="flex justify-between gap-3 border-b border-border py-1.5 text-sm last:border-0"
                  >
                    <span className="font-mono">{device.name}</span>
                    <span className="text-muted-foreground">
                      {device.state}
                      {device.connection && device.connection !== '--'
                        ? ` · ${device.connection}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
              <span>{refreshButton}</span>
            </SettingDisclosure>
          </>
        }
        onJoin={(ssid, secured) => open({ kind: 'join', ssid, secured })}
        onManualJoin={() => open({ kind: 'join', ssid: '', secured: true })}
        onConnect={(uuid) => {
          if (capabilities?.saved_connect)
            open({ kind: 'saved', uuid, ssid: savedName(uuid) });
        }}
        onForget={(uuid) =>
          open({ kind: 'forget', uuid, ssid: savedName(uuid) })
        }
        onScan={() => {
          if (!busy && connected) void run({ type: 'scan' });
        }}
        onConfirm={(keep) => {
          if (state?.pending && !disabled)
            void run({
              type: keep ? 'confirm' : 'cancel',
              transaction: state.pending.transaction,
            });
        }}
        onPolicy={(policy) => open({ kind: 'policy', policy })}
        onChangeName={() => open({ kind: 'hotspot' })}
        onChangeRadio={() => {
          if (capabilities?.hotspot_radio) open({ kind: 'radio' });
        }}
        access={<DeviceAccess network={readError ? null : state} />}
        dialogs={
          edit && (
            <NetworkChangeDialog
              {...edit}
              disabled={disabled || busy || Boolean(state?.pending)}
              onCancel={() => setEdit(null)}
              onApply={(change) => {
                setEdit(null);
                const ssid =
                  change.type === 'join' || change.type === 'join_open'
                    ? change.ssid
                    : change.type === 'connect'
                      ? state?.saved.find((p) => p.uuid === change.uuid)?.ssid
                      : undefined;
                void run(change, ssid ?? undefined);
              }}
            />
          )
        }
      />
    </section>
  );
}
