import * as React from 'react';
import { Lock, WifiHigh, WifiLow, WifiMedium } from '@phosphor-icons/react';
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
import { Caption } from '../components/ui/text';
import { SettingGroup, SettingRow } from './settings-page';

const NETWORKS = [
  { ssid: 'Home 5G', strength: 3, secured: true, known: true, current: true },
  { ssid: 'Rehearsal Room', strength: 2, secured: true, known: true },
  { ssid: 'Venue Guest', strength: 1, secured: false, known: false },
  { ssid: 'Neighbour', strength: 1, secured: true, known: false },
];
const Bars = ({ n }: { n: number }) =>
  n >= 3 ? (
    <WifiHigh aria-hidden="true" />
  ) : n === 2 ? (
    <WifiMedium aria-hidden="true" />
  ) : (
    <WifiLow aria-hidden="true" />
  );

/**
 * Settings › Network: the networks the device can see, joining one, and
 * the device's own hotspot. A change that could cut this screen off (a new
 * network, a new hotspot password) has to be confirmed from the new
 * connection within a minute, or the device goes back to how it was.
 */
export function NetworkSettings() {
  const [joining, setJoining] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState<string | null>(null);
  const [left, setLeft] = React.useState(60);
  const [current, setCurrent] = React.useState('Home 5G');
  const [policy, setPolicy] = React.useState('no-wifi');
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearInterval(timer.current)),
    [],
  );

  const join = (ssid: string) => {
    setJoining(null);
    setPending(ssid);
    let n = 60;
    setLeft(n);
    timer.current = setInterval(() => {
      n -= 1;
      setLeft(n);
      if (n <= 0) {
        if (timer.current) clearInterval(timer.current);
        setPending(null);
      }
    }, 1000);
  };
  const confirm = (keep: boolean) => {
    if (timer.current) clearInterval(timer.current);
    if (keep && pending) setCurrent(pending);
    setPending(null);
  };

  return (
    <>
      {pending && (
        <div
          role="status"
          className="grid gap-2 rounded-lg border border-foreground bg-card px-4 py-3"
        >
          <span className="text-sm font-semibold">
            Joined {pending}. Can you still see this screen?
          </span>
          <Caption>
            If you can, keep it. If nothing is confirmed in {left} s, the device
            goes back to {current} so you can reach it again.
          </Caption>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => confirm(true)}>
              Keep {pending}
            </Button>
            <Button size="sm" variant="outline" onClick={() => confirm(false)}>
              Go back now
            </Button>
          </div>
        </div>
      )}
      <SettingGroup title="Wi-Fi">
        <List aria-label="Networks">
          {NETWORKS.map((n) => (
            <ListRow
              key={n.ssid}
              leading={<Bars n={n.strength} />}
              title={n.ssid}
              caption={
                n.ssid === current
                  ? 'Connected · 192.168.1.169'
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
                  {n.ssid === current ? (
                    <Badge size="sm">Connected</Badge>
                  ) : (
                    <>
                      {n.known && (
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Forget ${n.ssid}`}
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
        <Button size="sm" variant="ghost" className="justify-self-start">
          Scan again
        </Button>
      </SettingGroup>
      <SettingGroup title="Hotspot">
        <SettingRow
          label="Turn the hotspot on"
          caption="The device's own network, for gigs with no Wi-Fi."
          stacked
        >
          <Select value={policy} onValueChange={setPolicy}>
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
        <SettingRow
          label="Name and password"
          caption="Oxidal-7F2A · changed on 2 Nov"
        >
          <Button size="sm" variant="outline">
            Change…
          </Button>
        </SettingRow>
        <SettingRow
          label="Country and channel"
          caption="United Kingdom · channel 6"
        >
          <Button size="sm" variant="outline">
            Change…
          </Button>
        </SettingRow>
      </SettingGroup>
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
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setJoining(null)}>
              Cancel
            </Button>
            <Button onClick={() => joining && join(joining)}>Join</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
