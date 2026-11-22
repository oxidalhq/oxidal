import { useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { FormField } from '@oxidal/design-system/components/form-layout';
import { Caption } from '@oxidal/design-system/components/text';
import { Tone3000Account as Tone3000AccountView } from '@oxidal/design-system/patterns/tone3000';

import { type AccountAction, type AccountState, tone3000Account } from './api';
import { clearReturnTarget, readReturnTarget } from './lib/sessionState';

/** Device authorization stays on the daemon; only its public sign-in code reaches this view.
 * @see docs/tone3000-account.md
 */
export function Tone3000Account({ connected }: { connected: boolean }) {
  const [state, setState] = useState<AccountState | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // The page that sent the player here to sign in, such as Oxidal sounds.
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
    <section aria-labelledby="tone3000-account-heading">
      <Tone3000AccountView
        headingId="tone3000-account-heading"
        state={
          !state
            ? 'loading'
            : state.phase === 'disconnected'
              ? 'none'
              : state.phase
        }
        status={state ? labels[state.phase] : 'Loading account…'}
        code={state?.user_code ?? undefined}
        verificationUrl={state?.verification_uri ?? undefined}
        expiresAt={state?.expires_at ?? undefined}
        error={error || state?.error || undefined}
        disabled={!connected || busy}
        signInDisabled={!validKey}
        onSignIn={() => void act({ kind: 'connect', client_id: clientId })}
        onSignOut={() => void act({ kind: 'disconnect' })}
        onCancel={() => void act({ kind: 'cancel' })}
        onReset={() => void act({ kind: 'disconnect' })}
        setup={
          <>
            <FormField>
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
            </FormField>
            <Caption>
              Use the publishable key from TONE3000 API settings.
            </Caption>
            {clientId.startsWith('t3k_cs_') && (
              <p role="alert">
                This is a secret key. Use the publishable key instead.
              </p>
            )}
          </>
        }
        returnAction={
          returnTo && (
            <Button
              onClick={() => {
                clearReturnTarget();
                setReturnTo(null);
                window.location.hash = returnTo.hash.slice(1);
              }}
            >
              Back to {returnTo.label}
            </Button>
          )
        }
        footer={
          <>
            {returnTo && !signedIn && (
              <Caption>
                After connecting, you can go back to {returnTo.label}.
              </Caption>
            )}
            <details className="border-y border-border py-1 text-sm [&>p]:mb-3 [&>p]:text-muted-foreground [&>summary]:flex [&>summary]:min-h-touch [&>summary]:cursor-pointer [&>summary]:items-center [&>summary]:justify-between [&>summary]:gap-3 [&>summary]:font-medium [&>summary]:after:text-lg [&>summary]:after:text-muted-foreground [&>summary]:after:content-['›'] open:[&>summary]:after:content-['−']">
              <summary>Account help</summary>
              <div className="grid min-w-0 items-start gap-3 [&>button]:max-w-full [&>button]:justify-self-start">
                <Caption>
                  Oxidal needs internet access to sign in. Account tokens stay
                  on this device. Disconnect removes its saved sign-in; it does
                  not delete your TONE3000 account or local presets.
                </Caption>
              </div>
            </details>
          </>
        }
      />
    </section>
  );
}
