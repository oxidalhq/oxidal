import { useEffect, useRef, useState } from 'react';
import { tone3000Account, type AccountAction, type AccountState } from './api';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';
import { clearReturnTarget, readReturnTarget } from './lib/sessionState';

/** Device authorization stays on the daemon; only its public sign-in code reaches this view. */
export function Tone3000Account({ connected }: { connected: boolean }) {
  const [state, setState] = useState<AccountState | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The page that sent the player here to sign in, such as Discover (7.5).
  const [returnTo, setReturnTo] = useState(readReturnTarget);
  const epoch = useRef(0);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function refresh() {
      if (pending) return;
      pending = true;
      const generation = epoch.current;
      try {
        const next = await tone3000Account();
        if (active && generation === epoch.current) {
          setState((current) =>
            current?.session === next.session &&
            current.revision > next.revision
              ? current
              : next,
          );
          setError((current) =>
            current === 'Cannot reach account settings. Reconnect to Oxidal.'
              ? ''
              : current,
          );
        }
      } catch {
        if (active && generation === epoch.current)
          setError('Cannot reach account settings. Reconnect to Oxidal.');
      } finally {
        pending = false;
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      active = false;
      epoch.current += 1;
      clearInterval(timer);
    };
  }, []);
  async function act(action: AccountAction) {
    if (!state || busy) return;
    const generation = ++epoch.current;
    setBusy(true);
    setError('');
    try {
      const next = await tone3000Account({ state, action });
      if (generation === epoch.current)
        setState((current) =>
          current?.session === next.session && current.revision > next.revision
            ? current
            : next,
        );
    } catch (error) {
      if (generation === epoch.current)
        setError(
          error instanceof Error ? error.message : 'Account request failed',
        );
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  const clientId = key ?? state?.client_id ?? '';
  const validKey =
    /^[a-zA-Z0-9_.-]{1,256}$/.test(clientId) && !clientId.startsWith('t3k_cs_');
  const waiting = state?.phase === 'waiting' || state?.phase === 'requesting';
  const signedIn =
    state?.phase === 'connected' || state?.phase === 'reconnecting';
  const labels = {
    disconnected: 'Not connected',
    requesting: 'Requesting sign-in code…',
    waiting: 'Waiting for sign-in',
    connected: 'Account connected',
    reconnecting: 'Reconnecting account…',
    error: 'Connection needs attention',
  };
  return (
    <section
      className="panel control-stack tone3000-account"
      aria-labelledby="tone3000-account-heading"
    >
      <header className="tone3000-account-header">
        <span className="tone3000-wordmark" aria-hidden="true">
          TONE3000
        </span>
        <div className="tone3000-account-title">
          <h2 id="tone3000-account-heading">TONE3000 account</h2>
          <p className="caption">
            Browse and download NAM captures and cabinet IRs in Discover. Sounds
            already on this device never need it.
          </p>
        </div>
        <Badge role="status">
          {state ? labels[state.phase] : 'Loading account…'}
        </Badge>
      </header>
      {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
      {state && !waiting && !signedIn && (
        <>
          <label className="field">
            Publishable API key
            <input
              type="text"
              value={clientId}
              maxLength={256}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => setKey(e.target.value.trim())}
            />
          </label>
          <p className="caption">
            Use the publishable key from TONE3000 API settings.
          </p>
          {clientId.startsWith('t3k_cs_') && (
            <p role="alert">
              This is a secret key. Use the publishable key instead.
            </p>
          )}
          <div className="action-row">
            <Button
              disabled={!connected || busy || !validKey}
              onClick={() => void act({ kind: 'connect', client_id: clientId })}
            >
              Connect TONE3000
            </Button>
            {state.phase === 'error' && (
              <Button
                variant="outline"
                disabled={!connected || busy}
                onClick={() => void act({ kind: 'disconnect' })}
              >
                Reset connection
              </Button>
            )}
          </div>
        </>
      )}
      {waiting && (
        <>
          {state?.user_code && (
            <div className="control-stack">
              <p className="caption">Open TONE3000 and enter this code:</p>
              <strong
                className="text-2xl tracking-widest"
                aria-label="Sign-in code"
              >
                {state.user_code}
              </strong>
              <div className="action-row">
                <Button asChild>
                  <a
                    href="https://www.tone3000.com/activate"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open TONE3000 sign-in
                  </a>
                </Button>
              </div>
              <p className="caption">
                Return here after authorizing. Oxidal checks automatically.
              </p>
            </div>
          )}
          <div className="action-row">
            <Button
              variant="outline"
              disabled={!connected || busy}
              onClick={() => void act({ kind: 'cancel' })}
            >
              Cancel sign-in
            </Button>
          </div>
        </>
      )}
      {signedIn && (
        <div className="action-row">
          {returnTo && (
            <Button
              onClick={() => {
                clearReturnTarget();
                setReturnTo(null);
                window.location.hash = returnTo.hash.slice(1);
              }}
            >
              Back to {returnTo.label}
            </Button>
          )}
          <Button
            variant="outline"
            disabled={!connected || busy}
            onClick={() => void act({ kind: 'disconnect' })}
          >
            Disconnect TONE3000
          </Button>
        </div>
      )}
      {returnTo && !signedIn && (
        <p className="caption">
          After connecting, you can go back to {returnTo.label}.
        </p>
      )}
      <details className="control-help">
        <summary>Account help</summary>
        <div className="control-stack">
          <p className="caption">
            Oxidal needs internet access to sign in. Account tokens stay on this
            device. Disconnect removes its saved sign-in; it does not delete
            your TONE3000 account or local presets.
          </p>
        </div>
      </details>
    </section>
  );
}
