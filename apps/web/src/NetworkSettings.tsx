import { useEffect, useState } from 'react';
import { deviceNetwork, type NetworkCommand, type NetworkState } from './api';
import { Button } from './components/ui/button';

/** Phone-first setup with explicit link-loss warning and server-owned recovery.
 * @see docs/device-service.md
 */
export function NetworkSettings({ connected }: { connected: boolean }) {
  const [state, setState] = useState<NetworkState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [iface, setIface] = useState('');
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'join' | 'hotspot'>('join');
  const [review, setReview] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const next = await deviceNetwork();
        if (active) setState(next);
      } catch {
        if (active)
          setError(
            'Cannot reach device settings. If the network changed, reconnect to the device and refresh.',
          );
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const wireless = state?.interfaces.filter((d) => d.kind === 'wifi') ?? [];
  const interfaceName = wireless.some((d) => d.name === iface)
    ? iface
    : (wireless[0]?.name ?? '');
  async function run(command: NetworkCommand) {
    setBusy(true);
    setError('');
    try {
      setState(await deviceNetwork(command));
      setReview(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network operation failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" aria-label="Wi-Fi and hotspot">
      <div className="section-heading">
        <h2>Wi-Fi & hotspot</h2>
        <Button
          variant="outline"
          disabled={!connected || busy}
          onClick={() => void run({ type: 'status' })}
        >
          Refresh network
        </Button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status">{state?.message || 'Reading device network…'}</p>
      {state?.available && (
        <>
          <ul
            className="my-3 grid gap-2 text-sm"
            aria-label="Network interfaces"
          >
            {state.interfaces.map((d) => (
              <li key={d.name}>
                <strong>{d.name}</strong> · {d.state}
                {d.connection && d.connection !== '--'
                  ? ` · ${d.connection}`
                  : ''}
              </li>
            ))}
          </ul>
          <p className="caption">
            Wi-Fi radio: {state.wireless_enabled ? 'on' : 'off'}. Access the
            device at <strong>https://oxidal.local</strong>; the hotspot also
            uses <strong>https://10.42.0.1</strong>.
          </p>
          {state.pending ? (
            <div
              className="mt-4 grid gap-3 rounded-md border border-input p-3"
              aria-label="Pending network change"
            >
              <strong>
                Network change pending · {state.pending.seconds_remaining}s
              </strong>
              <p>
                Reconnect your phone to the new Wi-Fi or hotspot, then confirm
                here. Without confirmation the previous network returns
                automatically.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    busy ||
                    !connected ||
                    state.pending.phase !== 'awaiting_confirmation'
                  }
                  onClick={() =>
                    void run({
                      type: 'confirm',
                      transaction: state.pending!.transaction,
                    })
                  }
                >
                  Keep this connection
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !connected}
                  onClick={() =>
                    void run({
                      type: 'cancel',
                      transaction: state.pending!.transaction,
                    })
                  }
                >
                  Restore previous network
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div
                className="mt-4 flex flex-wrap gap-2"
                role="group"
                aria-label="Network setup mode"
              >
                <Button
                  variant={mode === 'join' ? 'default' : 'outline'}
                  aria-pressed={mode === 'join'}
                  onClick={() => {
                    setMode('join');
                    setPassword('');
                    setReview(false);
                  }}
                >
                  Join Wi-Fi
                </Button>
                <Button
                  variant={mode === 'hotspot' ? 'default' : 'outline'}
                  aria-pressed={mode === 'hotspot'}
                  onClick={() => {
                    setMode('hotspot');
                    setPassword('');
                    setReview(false);
                  }}
                >
                  Edit hotspot
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || !connected}
                  onClick={() => void run({ type: 'scan' })}
                >
                  Scan Wi-Fi
                </Button>
              </div>
              {mode === 'join' && state.networks.length > 0 && (
                <div
                  className="my-3 grid gap-2 sm:grid-cols-2"
                  aria-label="Nearby networks"
                >
                  {state.networks.map((n) => (
                    <Button
                      key={`${n.ssid}-${n.security}`}
                      variant="outline"
                      className="h-auto min-h-11 min-w-0 justify-between text-left whitespace-normal"
                      onClick={() => {
                        setSsid(n.ssid);
                        setReview(false);
                      }}
                    >
                      <span className="min-w-0 break-words">{n.ssid}</span>
                      <span className="shrink-0 text-xs">
                        {n.signal}% · {n.security || 'Open'}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
              <form
                className="mt-4 grid gap-3 sm:grid-cols-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!review) {
                    setReview(true);
                    return;
                  }
                  const command: NetworkCommand = {
                    type: mode,
                    interface: interfaceName,
                    ssid,
                    password,
                  };
                  setPassword('');
                  void run(command);
                }}
              >
                <label className="field">
                  Wireless interface
                  <select
                    value={interfaceName}
                    onChange={(e) => {
                      setIface(e.target.value);
                      setReview(false);
                    }}
                    disabled={busy}
                  >
                    {wireless.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  {mode === 'hotspot' ? 'Hotspot name' : 'Wi-Fi name'}
                  <input
                    required
                    value={ssid}
                    autoComplete="off"
                    onChange={(e) => {
                      setSsid(e.target.value);
                      setReview(false);
                    }}
                    disabled={busy}
                  />
                </label>
                <label className="field">
                  {mode === 'hotspot'
                    ? 'New hotspot password'
                    : 'Wi-Fi password'}
                  <input
                    type="password"
                    required
                    minLength={8}
                    maxLength={63}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setReview(false);
                    }}
                    disabled={busy}
                  />
                </label>
                <p className="caption">
                  WPA2 Personal, 8–63 printable characters. Open and enterprise
                  Wi-Fi are not supported yet. This changes the wireless link;
                  it does not change your web login.
                </p>
                {review && (
                  <p className="notice sm:col-span-2">
                    The phone may disconnect. Switch it to {ssid}, or the same
                    router Wi-Fi when joining a network, then open
                    https://oxidal.local and confirm within 90 seconds.
                    Otherwise the previous connection returns.
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={busy || !connected || !interfaceName}
                >
                  {review ? 'Apply network change' : 'Review network change'}
                </Button>
              </form>
              <details className="mt-4">
                <summary>Saved networks</summary>
                <ul className="grid gap-2">
                  {state.saved.map((n) => (
                    <li
                      key={n.uuid}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        {n.name}
                        {n.active ? ' · connected' : ''}
                      </span>
                      {n.managed && !n.active && (
                        <Button
                          variant="outline"
                          disabled={busy || !connected}
                          aria-label={`Forget ${n.name}`}
                          onClick={() =>
                            void run({ type: 'forget', uuid: n.uuid })
                          }
                        >
                          Forget
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </>
      )}
    </section>
  );
}
