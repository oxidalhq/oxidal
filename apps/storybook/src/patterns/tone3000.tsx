import * as React from 'react';
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

type Account = 'none' | 'requesting' | 'waiting' | 'connected';

/**
 * The TONE3000 account, signed in on the device: Oxidal asks TONE3000 for a
 * code, you enter it on TONE3000 from any phone or laptop, and the
 * device keeps the sign-in. Only the code reaches this screen.
 */
export function Tone3000Account({ initial = 'none' }: { initial?: Account }) {
  const [state, setState] = React.useState<Account>(initial);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearTimeout(timer.current)),
    [],
  );
  const signIn = () => {
    setState('requesting');
    timer.current = setTimeout(() => {
      setState('waiting');
      timer.current = setTimeout(() => setState('connected'), 1500);
    }, 500);
  };
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
          <Button className="justify-self-start" onClick={signIn}>
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
            WXKD-4821
          </span>
          <Caption className="text-xs">
            Waiting for sign-in. This screen updates on its own.
          </Caption>
        </div>
      )}
      {state === 'connected' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-sm">
            <CheckCircle aria-hidden="true" /> Signed in as jane.capture
          </span>
          <Button size="sm" variant="outline" onClick={() => setState('none')}>
            Sign out
          </Button>
        </div>
      )}
      <PoweredByTone3000 />
    </Card>
  );
}

const TONES = [
  {
    id: 'a',
    name: 'Overdrive special',
    caption: 'NAM A2 · Standard · Jane Capture',
    got: true,
  },
  {
    id: 'b',
    name: 'High gain lead',
    caption: 'NAM · Standard · Studio Pack',
    fails: true,
  },
  { id: 'c', name: 'Deluxe reverb', caption: 'NAM · Feather · Porch Tones' },
];

/**
 * Get tones from TONE3000: the tones you picked download one by one; ones
 * already on the device are skipped; a failure says what happened in plain
 * words, keeps the technical details one tap away, and offers Try again.
 */
export function GetTones({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [step, setStep] = React.useState(-1);
  const [retried, setRetried] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearInterval(timer.current)),
    [],
  );
  const run = () => {
    let n = 0;
    setStep(0);
    timer.current = setInterval(() => {
      n += 1;
      setStep(n);
      if (n >= TONES.length && timer.current) clearInterval(timer.current);
    }, 500);
  };
  const failed = (t: (typeof TONES)[number]) => t.fails && !retried;
  const done = step >= TONES.length;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title="Get tones"
          description="From TONE3000 to this device. Each keeps its creator and licence."
        />
        <DialogBody className="grid gap-3">
          <List aria-label="Tones">
            {TONES.map((t, i) => (
              <ListRow
                key={t.id}
                title={t.name}
                caption={t.caption}
                trailing={
                  t.got ? (
                    <Caption as="span" className="text-xs">
                      Already in Tones and IRs
                    </Caption>
                  ) : step < 0 ? (
                    <Caption as="span" className="text-xs">
                      Ready
                    </Caption>
                  ) : step === i ? (
                    <Progress
                      value={60}
                      label={`Downloading ${t.name}`}
                      className="w-20"
                    />
                  ) : step > i ? (
                    failed(t) ? (
                      <Warning
                        aria-label="Failed"
                        className="size-5 text-brand"
                      />
                    ) : (
                      <CheckCircle aria-label="Downloaded" className="size-5" />
                    )
                  ) : (
                    <Caption as="span" className="text-xs">
                      Waiting
                    </Caption>
                  )
                }
              />
            ))}
          </List>
          {done && TONES.some(failed) && (
            <div
              role="alert"
              className="grid gap-2 rounded-lg border border-brand px-3 py-2"
            >
              <span className="text-sm font-semibold">
                High gain lead did not download: TONE3000 is busy right now.
              </span>
              <CollapsibleSection title="Details">
                <code className="text-xs">
                  HTTP 503 · service_unavailable · GET /api/v1/tones/b/model
                </code>
              </CollapsibleSection>
              <Button
                size="sm"
                variant="outline"
                className="justify-self-start"
                onClick={() => (setRetried(true), run())}
              >
                Try again
              </Button>
            </div>
          )}
          {done && !TONES.some(failed) && (
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
          {step < 0 && <Button onClick={run}>Download all</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
