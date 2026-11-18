import { Eye, EyeSlash } from '@phosphor-icons/react';
import { useId, useState } from 'react';

import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Description } from '../components/ui/text';
import type { HotspotPolicy } from './network-settings';

export type NetworkDraft =
  | { kind: 'join'; ssid: string; secured: boolean }
  | { kind: 'saved'; ssid: string; uuid: string }
  | { kind: 'forget'; ssid: string; uuid: string }
  | { kind: 'hotspot' }
  | { kind: 'radio' }
  | { kind: 'policy'; policy: HotspotPolicy };

/** Controlled device operation; this pattern owns no device access. */
export type NetworkChange =
  | { type: 'join'; interface: string; ssid: string; password: string }
  | { type: 'join_open'; interface: string; ssid: string }
  | { type: 'connect'; interface: string; uuid: string }
  | { type: 'forget'; uuid: string }
  | {
      type: 'hotspot';
      interface: string;
      ssid: string;
      password: string;
      country?: string;
      channel?: number;
    }
  | {
      type: 'hotspot_radio';
      interface: string;
      country: string;
      channel: number;
    }
  | {
      type: 'policy';
      settings: { interface: string; mode: HotspotPolicy; home_ssid: string };
    };

/** Shared review and setup fields. Mount a new instance for each explicit edit.
 * Background readback never resets an open draft. Secrets clear before apply/close.
 */
export function NetworkChangeDialog({
  draft,
  interfaces,
  defaultInterface,
  hotspotName,
  hotspotChannel,
  radio,
  homeSsid,
  onApply,
  onCancel,
  disabled = false,
}: {
  draft: NetworkDraft;
  interfaces: string[];
  defaultInterface: string;
  hotspotName?: string;
  hotspotChannel?: number;
  radio?: { country: string; channels: number[] };
  homeSsid?: string;
  onApply: (change: NetworkChange) => void;
  onCancel: () => void;
  disabled?: boolean;
}) {
  const passwordId = useId();
  const [iface, setIface] = useState(defaultInterface);
  const [ssid, setSsid] = useState(
    'ssid' in draft ? draft.ssid : (hotspotName ?? ''),
  );
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [country, setCountry] = useState(radio?.country ?? '');
  const [channel, setChannel] = useState(hotspotChannel ?? 0);
  const [home, setHome] = useState(homeSsid ?? '');
  const secret =
    draft.kind === 'hotspot' || (draft.kind === 'join' && draft.secured);
  const editingRadio =
    draft.kind === 'radio' || (draft.kind === 'hotspot' && Boolean(radio));
  const editingName = draft.kind === 'join' || draft.kind === 'hotspot';
  const validName =
    new TextEncoder().encode(ssid).length > 0 &&
    new TextEncoder().encode(ssid).length <= 32 &&
    Array.from(ssid).every(
      (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
    );
  const valid =
    (draft.kind === 'forget' || interfaces.includes(iface)) &&
    (!editingName || validName) &&
    (!secret || /^[\x20-\x7e]{8,63}$/.test(password)) &&
    (!editingRadio || /^[A-Z]{2}$/.test(country)) &&
    (draft.kind !== 'policy' ||
      draft.policy !== 'not_at_home' ||
      (new TextEncoder().encode(home).length > 0 &&
        new TextEncoder().encode(home).length <= 32 &&
        Array.from(home).every(
          (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
        )));
  const title =
    draft.kind === 'forget'
      ? `Forget ${ssid}?`
      : draft.kind === 'saved' || draft.kind === 'join'
        ? `Join ${ssid || 'Wi-Fi'}?`
        : draft.kind === 'policy'
          ? 'Change automatic hotspot?'
          : draft.kind === 'radio'
            ? 'Change country and channel?'
            : 'Change hotspot name and password?';
  const close = () => {
    setPassword('');
    setShowPassword(false);
    onCancel();
  };
  function apply() {
    if (!valid || disabled) return;
    let change: NetworkChange;
    switch (draft.kind) {
      case 'forget':
        change = { type: 'forget', uuid: draft.uuid };
        break;
      case 'saved':
        change = { type: 'connect', interface: iface, uuid: draft.uuid };
        break;
      case 'join':
        change = draft.secured
          ? { type: 'join', interface: iface, ssid, password }
          : { type: 'join_open', interface: iface, ssid };
        break;
      case 'hotspot':
        change = {
          type: 'hotspot',
          interface: iface,
          ssid,
          password,
          ...(radio ? { country, channel } : {}),
        };
        break;
      case 'radio':
        change = { type: 'hotspot_radio', interface: iface, country, channel };
        break;
      case 'policy':
        change = {
          type: 'policy',
          settings: { interface: iface, mode: draft.policy, home_ssid: home },
        };
        break;
    }
    setPassword('');
    setShowPassword(false);
    onApply(change);
  }
  const inputClass =
    'min-h-touch w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm';
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader
          title={title}
          description={
            draft.kind === 'forget'
              ? 'Removes this inactive saved profile from Oxidal.'
              : 'Your phone may disconnect while the wireless link changes.'
          }
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            apply();
          }}
        >
          <DialogBody className="grid gap-4">
            {draft.kind !== 'forget' && (
              <label className="grid gap-1 text-sm">
                Wireless interface
                <Select value={iface} onValueChange={setIface}>
                  <SelectTrigger aria-label="Wireless interface">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {interfaces.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            )}
            {editingName && (
              <label className="grid gap-1 text-sm">
                {draft.kind === 'hotspot' ? 'Hotspot name' : 'Wi-Fi name'}
                <input
                  className={inputClass}
                  value={ssid}
                  readOnly={draft.kind === 'join' && !draft.secured}
                  required
                  onChange={(event) => setSsid(event.target.value)}
                />
              </label>
            )}
            {secret && (
              <div className="grid gap-1 text-sm">
                <label htmlFor={passwordId}>Wi-Fi password</label>
                <span className="flex min-w-0 gap-2">
                  <input
                    id={passwordId}
                    aria-describedby={`${passwordId}-note`}
                    className={inputClass}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="off"
                    value={password}
                    minLength={8}
                    maxLength={63}
                    required
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeSlash aria-hidden="true" />
                    ) : (
                      <Eye aria-hidden="true" />
                    )}
                  </Button>
                </span>
                <Description id={`${passwordId}-note`}>
                  WPA2 Personal · 8–63 printable characters. The password stays
                  on the device.
                </Description>
              </div>
            )}
            {draft.kind === 'join' && !draft.secured && (
              <Description>
                This advertised network is open. Its Wi-Fi traffic is not
                protected by a password.
              </Description>
            )}
            {editingRadio && (
              <>
                <label className="grid gap-1 text-sm">
                  Wireless country
                  <input
                    className={inputClass}
                    value={country}
                    maxLength={2}
                    pattern="[A-Z]{2}"
                    required
                    onChange={(event) =>
                      setCountry(event.target.value.toUpperCase())
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Hotspot channel
                  <Select
                    value={String(channel)}
                    onValueChange={(value) => setChannel(Number(value))}
                  >
                    <SelectTrigger aria-label="Hotspot channel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Automatic</SelectItem>
                      {radio?.channels.map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {value} · 2.4 GHz
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>
                <Description>
                  Use the country where Oxidal is operating, such as NZ. The
                  kernel and radio validate it again when applying. An
                  unconfirmed change restores the previous country and channel.
                </Description>
              </>
            )}
            {draft.kind === 'policy' && (
              <>
                <Description>
                  New policy: {draft.policy.replaceAll('_', ' ')}. Decisions
                  wait for stable network observations. Never can require
                  Ethernet for access.
                </Description>
                {draft.policy === 'not_at_home' && (
                  <label className="grid gap-1 text-sm">
                    Home Wi-Fi name
                    <input
                      className={inputClass}
                      value={home}
                      required
                      onChange={(event) => setHome(event.target.value)}
                    />
                  </label>
                )}
              </>
            )}
            {draft.kind !== 'forget' && (
              <Description>
                Reconnect through the router, hotspot or Ethernet, then open
                oxidal.local and keep the connection within 90 seconds.
                Otherwise Oxidal restores the previous network. Your web login
                is unchanged.
              </Description>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || disabled}>
              {draft.kind === 'forget'
                ? 'Forget network'
                : 'Apply network change'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
