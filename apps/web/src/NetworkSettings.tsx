import { Eye, EyeSlash, WifiHigh, ArrowClockwise } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { deviceNetwork, type NetworkCommand, type NetworkState } from './api';
import { AdjustmentDialog } from './AdjustmentDialog';
import { Button } from './components/ui/button';
import { ToggleGroup, ToggleGroupItem } from './components/ui/toggle-group';

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
  const activeWifi = wireless.find((device) => device.state === 'connected');
  const activeNetwork = state?.networks.find((network) => network.active);
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
  function applyNetworkChange() {
    if (!state) return;
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
  }
  return (
    <section className="panel network-settings" aria-label="Wi-Fi and hotspot">
      <div className="section-heading network-heading">
        <div>
          <h2>Wi-Fi &amp; hotspot</h2>
          <p className="caption">
            Internet access and the direct setup hotspot.
          </p>
        </div>
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
      {(!state || state.message) && (
        <p role="status" className="network-message">
          {state ? state.message : 'Reading device network…'}
        </p>
      )}
      {state?.available && (
        <>
          <div className="network-summary" aria-label="Current connection">
            <div className="network-summary-primary">
              <span
                className="network-state-dot"
                data-active={Boolean(activeWifi)}
                aria-hidden="true"
              />
              <span>
                <strong>
                  {activeNetwork?.ssid ||
                    activeWifi?.connection ||
                    'Not connected'}
                </strong>
                <small>
                  {activeWifi
                    ? `Connected via ${activeWifi.name}`
                    : state.wireless_enabled
                      ? 'Wi-Fi is on'
                      : 'Wi-Fi is off'}
                </small>
              </span>
            </div>
            <span className="network-address">oxidal.local</span>
          </div>
          <details className="network-disclosure network-interface-details">
            <summary>Connection details</summary>
            <ul aria-label="Network interfaces">
              {state.interfaces.map((device) => (
                <li key={device.name}>
                  <strong>{device.name}</strong>
                  <span>
                    {device.state}
                    {device.connection && device.connection !== '--'
                      ? ` · ${device.connection}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
            <p className="caption">
              Direct hotspot address: <strong>10.42.0.1</strong>
            </p>
          </details>
          {state.pending ? (
            <div
              className="network-pending"
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
              <div className="network-toolbar">
                <ToggleGroup
                  type="single"
                  value={mode}
                  disabled={busy}
                  aria-label="Network setup mode"
                  onValueChange={(value) => {
                    if (
                      (value === 'join' || value === 'hotspot') &&
                      value !== mode
                    ) {
                      setMode(value);
                      setSsid('');
                      setPassword('');
                      setShowPassword(false);
                      setReview(false);
                    }
                  }}
                >
                  <ToggleGroupItem value="join">Join Wi-Fi</ToggleGroupItem>
                  <ToggleGroupItem value="hotspot">
                    Edit hotspot
                  </ToggleGroupItem>
                </ToggleGroup>
                {mode === 'join' && (
                  <Button
                    variant="outline"
                    disabled={busy || !connected}
                    onClick={() => void run({ type: 'scan' })}
                  >
                    <ArrowClockwise aria-hidden="true" /> Scan
                  </Button>
                )}
              </div>
              {mode === 'join' && state.networks.length > 0 && (
                <div className="network-list" aria-label="Nearby networks">
                  {state.networks.map((n) => (
                    <Button
                      key={`${n.ssid}-${n.security}`}
                      variant="ghost"
                      aria-pressed={ssid === n.ssid}
                      disabled={
                        busy || !connected || !n.security || n.security === '--'
                      }
                      className="network-row"
                      onClick={() => {
                        setSsid(n.ssid);
                        setReview(false);
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <WifiHigh aria-hidden="true" className="shrink-0" />
                        <span className="min-w-0 break-words">
                          <strong>{n.ssid}</strong>
                          {n.active && (
                            <span className="network-connected">Connected</span>
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
                className="network-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  setReview(true);
                }}
              >
                {wireless.length > 1 && (
                  <label className="field network-interface-select">
                    Wireless interface
                    <select
                      value={interfaceName}
                      onChange={(e) => {
                        setIface(e.target.value);
                        setReview(false);
                      }}
                      disabled={busy}
                    >
                      {wireless.map((device) => (
                        <option key={device.name} value={device.name}>
                          {device.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
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
                      className="caption network-form-wide"
                    >
                      Use the country where the device is operating, such as NZ.
                      The kernel and radio validate the channel again when
                      applying. Country changes affect wireless operation and
                      roll back if not confirmed.
                    </p>
                  </>
                )}
                <p className="caption network-form-wide">
                  WPA2 Personal, 8–63 printable characters. Open and enterprise
                  Wi-Fi are not supported yet. This changes the wireless link;
                  it does not change your web login.
                </p>
                <Button
                  type="submit"
                  className="network-submit"
                  disabled={busy || !connected || !interfaceName}
                >
                  Review network change
                </Button>
              </form>
              <div className="network-secondary">
                <details className="network-disclosure">
                  <summary>Automatic hotspot</summary>
                  <p className="caption">
                    Saved policy:{' '}
                    {state.policy?.mode.replaceAll('_', ' ') ??
                      'Appliance default'}
                    . Changes are tested for 90 seconds before you keep them.
                  </p>
                  <form
                    className="network-policy-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setPolicyReview(true);
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
                    <p className="caption network-form-wide">
                      Automatic changes wait for stable network observations. If
                      a remembered router fails to connect, the recovery hotspot
                      stays available. Never may require Ethernet for access.
                    </p>
                    <Button
                      type="submit"
                      disabled={busy || !connected || !interfaceName}
                    >
                      Review hotspot policy
                    </Button>
                  </form>
                </details>
                <details className="network-disclosure">
                  <summary>Saved networks</summary>
                  <ul className="network-saved-list">
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
              </div>
            </>
          )}
        </>
      )}
      {review && (
        <AdjustmentDialog
          title={mode === 'join' ? `Join ${ssid}?` : `Update ${ssid}?`}
          onCancel={() => {
            if (!busy) setReview(false);
          }}
        >
          <p className="caption">
            This device may briefly disappear from the browser while its
            wireless connection changes.
          </p>
          <dl className="network-review">
            <div>
              <dt>{mode === 'join' ? 'Wi-Fi' : 'Hotspot'}</dt>
              <dd>{ssid}</dd>
            </div>
            <div>
              <dt>Interface</dt>
              <dd>{interfaceName}</dd>
            </div>
          </dl>
          <p className="notice">
            The phone may disconnect. Reconnect to {ssid}, then open
            oxidal.local and confirm within 90 seconds. Otherwise Oxidal
            restores the previous connection.
          </p>
          <div className="dialog-actions">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setReview(false)}
            >
              Cancel
            </Button>
            <Button disabled={busy} onClick={applyNetworkChange}>
              Apply network change
            </Button>
          </div>
        </AdjustmentDialog>
      )}
      {policyReview && (
        <AdjustmentDialog
          title="Change automatic hotspot?"
          onCancel={() => {
            if (!busy) setPolicyReview(false);
          }}
        >
          <p className="caption">
            The new rule is tested for 90 seconds before it becomes permanent.
          </p>
          <p className="notice">
            Your phone may disconnect. Reconnect through the router, hotspot or
            Ethernet and keep the connection before the timer expires.
          </p>
          <div className="dialog-actions">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setPolicyReview(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={busy || !interfaceName}
              onClick={() => {
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
              Apply hotspot policy
            </Button>
          </div>
        </AdjustmentDialog>
      )}
    </section>
  );
}
