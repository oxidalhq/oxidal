import { CheckCircle, Warning } from '@phosphor-icons/react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { CollapsibleSection } from '../components/ui/collapsible';
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

export type Tone3000AccountState =
  'none' | 'requesting' | 'waiting' | 'connected';

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
}: {
  state: Tone3000AccountState;
  /** The sign-in code TONE3000 issued, while waiting. */
  code?: string;
  /** The signed-in TONE3000 user name. */
  user?: string;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>TONE3000 account</CardTitle>
        <Badge size="sm">
          {state === 'connected' ? 'Connected' : 'Not connected'}
        </Badge>
      </CardHeader>
      {state === 'none' && (
        <div className="grid gap-2">
          <Caption>
            Sign in to get tones from TONE3000 straight onto this device.
          </Caption>
          <Button className="justify-self-start" onClick={onSignIn}>
            Sign in to TONE3000
          </Button>
        </div>
      )}
      {state === 'requesting' && (
        <Caption role="status">Requesting a sign-in code…</Caption>
      )}
      {state === 'waiting' && (
        <div role="status" className="grid gap-2">
          <span className="text-sm">
            Open TONE3000 on any phone or laptop and enter this code:
          </span>
          <span className="justify-self-start rounded-lg border border-foreground px-4 py-2 font-mono text-2xl font-semibold tracking-widest">
            {code}
          </span>
          <Caption className="text-xs">
            Waiting for sign-in. This screen updates on its own.
          </Caption>
        </div>
      )}
      {state === 'connected' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-sm">
            <CheckCircle aria-hidden="true" /> Signed in as {user}
          </span>
          <Button size="sm" variant="outline" onClick={onSignOut}>
            Sign out
          </Button>
        </div>
      )}
      <PoweredByTone3000 />
    </Card>
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
                  <CollapsibleSection title="Details">
                    <code className="text-xs">{t.error.details}</code>
                  </CollapsibleSection>
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
