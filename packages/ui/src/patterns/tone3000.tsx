import { CheckCircle, Warning } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

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
import { Progress } from '../components/ui/states';
import { Caption } from '../components/ui/text';
import { PoweredByTone3000 } from './credits';
import { SettingDisclosure } from './settings-page';

export type Tone3000AccountState =
  | 'none'
  | 'requesting'
  | 'waiting'
  | 'connected'
  | 'loading'
  | 'reconnecting'
  | 'error';

/**
 * The TONE3000 account, signed in on the device: Oxidal asks TONE3000 for a
 * code, you enter it on TONE3000 from any phone or laptop, and the
 * device keeps the sign-in. Only the code reaches this screen.
 */
export function Tone3000Account({
  state,
  code,
  user,
  onSignIn,
  onSignOut,
  onCancel,
  onReset,
  status,
  error,
  setup,
  returnAction,
  footer,
  verificationUrl,
  expiresAt,
  disabled = false,
  signInDisabled = false,
  headingId,
}: {
  state: Tone3000AccountState;
  /** The sign-in code TONE3000 issued, while waiting. */
  code?: string;
  /** The signed-in TONE3000 user name. */
  user?: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onCancel?: () => void;
  onReset?: () => void;
  status?: string;
  error?: string;
  setup?: ReactNode;
  returnAction?: ReactNode;
  footer?: ReactNode;
  verificationUrl?: string;
  expiresAt?: number;
  disabled?: boolean;
  signInDisabled?: boolean;
  headingId?: string;
}) {
  return (
    <div
      data-slot="setting-group"
      className="grid gap-3 border-b border-border pb-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3
          id={headingId}
          className="m-0 flex min-h-control items-center small-caps text-sm font-medium text-muted-foreground"
        >
          TONE3000 account
        </h3>
        <Badge size="sm" role="status">
          {status ??
            {
              none: 'Not connected',
              loading: 'Reading account settings…',
              requesting: 'Requesting a sign-in code…',
              waiting: 'Waiting for sign-in',
              connected: 'Connected',
              reconnecting: 'Reconnecting account…',
              error: 'Connection needs attention',
            }[state]}
        </Badge>
      </header>
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
      {(state === 'none' || state === 'error') && (
        <div className="grid gap-2">
          <Caption>
            Sign in to get tones from TONE3000 straight onto this device.
          </Caption>
          {setup}
          <Button
            size="sm"
            className="justify-self-start"
            disabled={disabled || signInDisabled}
            onClick={onSignIn}
          >
            Sign in to TONE3000
          </Button>
          {state === 'error' && onReset && (
            <Button
              variant="outline"
              className="justify-self-start"
              disabled={disabled}
              onClick={onReset}
            >
              Reset connection
            </Button>
          )}
        </div>
      )}
      {state === 'loading' && <Caption>Reading account settings…</Caption>}
      {state === 'requesting' && <Caption>Requesting a sign-in code…</Caption>}
      {state === 'waiting' && (
        <div className="grid gap-2">
          <span className="text-sm">
            Open TONE3000 on any phone or laptop and enter this code:
          </span>
          <span
            aria-label="Sign-in code"
            className="justify-self-start rounded-lg border border-foreground px-4 py-2 font-mono text-2xl font-semibold tracking-widest"
          >
            {code}
          </span>
          {verificationUrl && (
            <Button asChild className="justify-self-start">
              <a
                href={verificationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open TONE3000 sign-in
              </a>
            </Button>
          )}
          {expiresAt && (
            <Caption>
              Code expires at {new Date(expiresAt * 1000).toLocaleTimeString()}.
            </Caption>
          )}
          <Caption className="text-xs">
            Waiting for sign-in. This screen updates on its own.
          </Caption>
        </div>
      )}
      {(state === 'requesting' || state === 'waiting') && onCancel && (
        <Button
          variant="outline"
          className="justify-self-start"
          disabled={disabled}
          onClick={onCancel}
        >
          Cancel sign-in
        </Button>
      )}
      {(state === 'connected' || state === 'reconnecting') && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-sm">
            {state === 'connected' && <CheckCircle aria-hidden="true" />}{' '}
            {state === 'reconnecting'
              ? "Restoring the device's sign-in…"
              : user
                ? `Signed in as ${user}`
                : 'Signed in on this device'}
          </span>
          <div className="flex flex-wrap gap-2">
            {returnAction}
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={onSignOut}
            >
              Sign out
            </Button>
          </div>
        </div>
      )}
      {footer}
      <PoweredByTone3000 className="[&_a]:min-h-touch" />
    </div>
  );
}

export type ToneDownload = {
  id: string;
  name: string;
  caption: string;
  status: 'got' | 'ready' | 'waiting' | 'downloading' | 'done' | 'failed';
  /** 0 to 100 while downloading. */
  progress?: number;
  /** For a failure: what happened in plain words, and the technical details. */
  error?: { message: string; details: string };
};

/**
 * Get tones from TONE3000: the tones you picked download one by one; ones
 * already on the device are skipped; a failure says what happened in plain
 * words, keeps the technical details one tap away, and offers Try again.
 */
export function GetTones({
  open,
  onOpenChange,
  tones,
  onDownload,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tones: ToneDownload[];
  onDownload: () => void;
  onRetry: () => void;
}) {
  const started = tones.some((t) => t.status !== 'got' && t.status !== 'ready');
  const busy = tones.some(
    (t) => t.status === 'waiting' || t.status === 'downloading',
  );
  const done = started && !busy;
  const failures = tones.filter((t) => t.status === 'failed');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Get tones"
          description="From TONE3000 to this device. Each keeps its creator and licence."
        />
        <DialogBody className="grid gap-3">
          <List aria-label="Tones">
            {tones.map((t) => (
              <ListRow
                key={t.id}
                title={t.name}
                caption={t.caption}
                trailing={
                  t.status === 'got' ? (
                    <Caption as="span" className="text-xs">
                      Already in Tones and IRs
                    </Caption>
                  ) : t.status === 'ready' ? (
                    <Caption as="span" className="text-xs">
                      Ready
                    </Caption>
                  ) : t.status === 'downloading' ? (
                    <Progress
                      value={t.progress ?? 0}
                      label={`Downloading ${t.name}`}
                      className="w-20"
                    />
                  ) : t.status === 'failed' ? (
                    <Warning
                      aria-label="Failed"
                      className="size-5 text-brand"
                    />
                  ) : t.status === 'done' ? (
                    <CheckCircle aria-label="Downloaded" className="size-5" />
                  ) : (
                    <Caption as="span" className="text-xs">
                      Waiting
                    </Caption>
                  )
                }
              />
            ))}
          </List>
          {done &&
            failures.map((t) => (
              <div
                key={t.id}
                role="alert"
                className="grid gap-2 rounded-lg border border-brand px-3 py-2"
              >
                <span className="text-sm font-semibold">
                  {t.name} did not download: {t.error?.message}
                </span>
                {t.error?.details && (
                  <SettingDisclosure label="Details">
                    <code className="text-xs">{t.error.details}</code>
                  </SettingDisclosure>
                )}
              </div>
            ))}
          {done && failures.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="justify-self-start"
              onClick={onRetry}
            >
              Try again
            </Button>
          )}
          {done && !failures.length && (
            <Caption role="status">
              Ready. The tones are in Library › Tones and IRs.
            </Caption>
          )}
          <PoweredByTone3000 />
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {done ? 'Done' : 'Cancel'}
          </Button>
          {!started && <Button onClick={onDownload}>Download all</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
