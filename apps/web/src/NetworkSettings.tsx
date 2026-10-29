import { Eye, EyeSlash, WifiHigh, ArrowClockwise } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { deviceNetwork, type NetworkCommand, type NetworkState } from './api';
import { Button } from './components/ui/button';

/** Phone-first setup with explicit link-loss warning and server-owned recovery.
 * @see docs/device-service.md
 */
export function NetworkSettings({ connected }: { connected: boolean }) {
  const [state, setState] = useState<NetworkState | null>(null);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [iface, setIface] = useState('');
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'join' | 'hotspot'>('join');
  const [review, setReview] = useState(false);
  const [policyDraft, setPolicyMode] = useState<
    NonNullable<NetworkState['policy']>['mode'] | null
  >(null);
  const [homeDraft, setHome] = useState<string | null>(null);
  const policyMode = policyDraft ?? state?.policy?.mode ?? 'always';
  const home = homeDraft ?? state?.policy?.home_ssid ?? '';
  const [policyReview, setPolicyReview] = useState(false);
  const [country, setCountry] = useState('');
  const [channel, setChannel] = useState(0);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      try {
        const next = await deviceNetwork();
        if (active) {
          setState(next);
          setReadError('');
        }
      } catch {
        if (active)
          setReadError(
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
      setReadError('');
      if (command.type === 'policy') {
        setPolicyMode(null);
        setHome(null);
      }
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
          <ArrowClockwise aria-hidden="true" />
          Refresh network
        </Button>
      </div>
      {(error || readError) && (
        <p role="alert" className="error">
          {error || readError}
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
              <div className="action-row">
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
                className="action-row mt-4"
                role="group"
                aria-label="Network setup mode"
              >
                <Button
                  variant={mode === 'join' ? 'default' : 'outline'}
                  aria-pressed={mode === 'join'}
                  onClick={() => {
                    if (mode !== 'join') {
                      setMode('join');
                      setSsid('');
                      setPassword('');
                      setShowPassword(false);
                      setReview(false);
                    }
                  }}
                >
                  Join Wi-Fi
                </Button>
                <Button
                  variant={mode === 'hotspot' ? 'default' : 'outline'}
                  aria-pressed={mode === 'hotspot'}
                  onClick={() => {
                    if (mode !== 'hotspot') {
                      setMode('hotspot');
                      setSsid('');
                      setPassword('');
                      setShowPassword(false);
                      setReview(false);
                    }
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
                      variant={ssid === n.ssid ? 'secondary' : 'outline'}
                      aria-pressed={ssid === n.ssid}
                      disabled={
                        busy || !connected || !n.security || n.security === '--'
                      }
                      className="h-auto min-h-11 min-w-0 justify-between text-left whitespace-normal"
                      onClick={() => {
                        setSsid(n.ssid);
                        setReview(false);
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <WifiHigh aria-hidden="true" className="shrink-0" />
                        <span className="min-w-0 break-words">
                          {n.ssid}
                          {n.active && (
                            <span className="block text-xs">Connected</span>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs">
                        {n.signal}% ·{' '}
                        {n.security && n.security !== '--'
                          ? n.security
                          : 'Open · unsupported'}
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
                    ...(mode === 'hotspot' && state.radio
                      ? { country: country || state.radio.country, channel }
                      : {}),
                  };
                  setPassword('');
                  setShowPassword(false);
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
                <div className="field">
                  <label htmlFor="network-password">
                    {mode === 'hotspot'
                      ? 'New hotspot password'
                      : 'Wi-Fi password'}
                  </label>
                  <div className="flex min-w-0 gap-2">
                    <input
                      id="network-password"
                      className="min-w-0 flex-1"
                      type={showPassword ? 'text' : 'password'}
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
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-11 shrink-0 p-0"
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
                  </div>
                </div>
                {mode === 'hotspot' && state.radio && (
                  <>
                    <label className="field">
                      Wireless country
                      <input
                        value={country || state.radio.country}
                        onChange={(e) => {
                          setCountry(e.target.value.toUpperCase());
                          setReview(false);
                        }}
                        required
                        pattern="[A-Z]{2}"
                        maxLength={2}
                        aria-describedby="wireless-country-note"
                      />
                    </label>
                    <label className="field">
                      Hotspot channel
                      <select
                        value={channel}
                        onChange={(e) => {
                          setChannel(Number(e.target.value));
                          setReview(false);
                        }}
                      >
                        <option value={0}>Automatic</option>
                        {state.radio.channels.map((c) => (
                          <option key={c} value={c}>
                            {c} · 2.4 GHz
                          </option>
                        ))}
                      </select>
                    </label>
                    <p
                      id="wireless-country-note"
                      className="caption sm:col-span-2"
                    >
                      Use the country where the device is operating, such as NZ.
                      The kernel and radio validate the channel again when
                      applying. Country changes affect wireless operation and
                      roll back if not confirmed.
                    </p>
                  </>
                )}
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
                <summary>Automatic hotspot</summary>
                <p className="caption">
                  Saved policy:{' '}
                  {state.policy?.mode.replaceAll('_', ' ') ??
                    'Appliance default'}
                  . Changes are tested for 90 seconds before you keep them.
                </p>
                <form
                  className="mt-3 grid gap-3 sm:grid-cols-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!policyReview) {
                      setPolicyReview(true);
                      return;
                    }
                    setPolicyReview(false);
                    void run({
                      type: 'policy',
                      settings: {
                        interface: interfaceName,
                        mode: policyMode,
                        home_ssid: home,
                      },
                    });
                  }}
                >
                  <label className="field">
                    Start hotspot
                    <select
                      value={policyMode}
                      onChange={(e) => {
                        setPolicyMode(e.target.value as typeof policyMode);
                        setPolicyReview(false);
                      }}
                    >
                      <option value="always">Always</option>
                      <option value="never">Never</option>
                      <option value="no_ethernet">
                        When Ethernet is disconnected
                      </option>
                      <option value="not_at_home">
                        When home Wi-Fi is out of range
                      </option>
                      <option value="no_remembered">
                        When no saved Wi-Fi is in range
                      </option>
                    </select>
                  </label>
                  {policyMode === 'not_at_home' && (
                    <label className="field">
                      Home Wi-Fi name
                      <input
                        required
                        value={home}
                        onChange={(e) => {
                          setHome(e.target.value);
                          setPolicyReview(false);
                        }}
                      />
                    </label>
                  )}
                  <p className="caption sm:col-span-2">
                    Automatic changes wait for stable network observations. If a
                    remembered router fails to connect, the recovery hotspot
                    stays available. Never may require Ethernet for access.
                  </p>
                  {policyReview && (
                    <p className="notice sm:col-span-2">
                      Your phone may disconnect. Reconnect through the router or
                      Ethernet and confirm within 90 seconds. Without
                      confirmation, the previous policy and hotspot return.
                    </p>
                  )}
                  <Button
                    type="submit"
                    disabled={busy || !connected || !interfaceName}
                  >
                    {policyReview
                      ? 'Apply hotspot policy'
                      : 'Review hotspot policy'}
                  </Button>
                </form>
              </details>
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
