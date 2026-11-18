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

import { DeviceAccess } from './DeviceAccess';
import { useDeviceNetwork } from './useDeviceNetwork';

/** Phone-first setup with explicit link-loss warning and server-owned recovery.
 * @see docs/device-service.md
 */
export function NetworkSettings({ connected }: { connected: boolean }) {
  const { state, error, readError, busy, refresh, run } =
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
            {readError && <Description role="alert">{readError}</Description>}
            {error && <Description role="alert">{error}</Description>}
            {state?.available && state.message && (
              <Description role="status">{state.message}</Description>
            )}
            {state?.available && (
              <Description>
                Wi-Fi is {state.wireless_enabled ? 'on' : 'off'}
                {current ? ` · ${current}` : ''}.
              </Description>
            )}
            {state?.saved_message && (
              <Description>{state.saved_message}</Description>
            )}
            {state?.available &&
              (!capabilities?.saved_connect ||
                !capabilities.open_join ||
                !capabilities.hotspot_radio) && (
                <Description>
                  Update the device service to enable saved-network
                  reconnection, open-network join and separate radio changes.
                  WPA2 setup remains available.
                </Description>
              )}
            {!connected && (
              <Description role="status">
                Reconnect to Oxidal before changing the network.
              </Description>
            )}
          </>
        }
        interfaceControl={
          <div className="grid gap-3">
            <label className="grid gap-1 text-sm">
              Wireless interface
              <Select
                value={interfaceName}
                disabled={busy || Boolean(state?.pending)}
                onValueChange={setIface}
              >
                <SelectTrigger aria-label="Wireless interface">
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
            </label>
            <details>
              <summary className="min-h-touch cursor-pointer py-3 text-sm">
                Connection details
              </summary>
              <ul aria-label="Network interfaces">
                {state?.interfaces.map((device) => (
                  <li key={device.name} className="py-1 text-sm">
                    {device.name} · {device.state}
                    {device.connection && device.connection !== '--'
                      ? ` · ${device.connection}`
                      : ''}
                  </li>
                ))}
              </ul>
            </details>
            {refreshButton}
          </div>
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
                void run(change);
              }}
            />
          )
        }
      />
    </section>
  );
}
