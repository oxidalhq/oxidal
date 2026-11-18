import * as React from 'react';

import {
  GetTones,
  Tone3000Account,
  type Tone3000AccountState,
  type ToneDownload,
} from './tone3000';

/** Stands in for the device: issues a code, then signs in. */
export function Tone3000AccountDemo({
  initial = 'none',
}: {
  initial?: Tone3000AccountState;
}) {
  const [state, setState] = React.useState(initial);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearTimeout(timer.current)),
    [],
  );
  return (
    <Tone3000Account
      state={state}
      code="WXKD-4821"
      user="jane.capture"
      verificationUrl="https://www.tone3000.com/activate"
      onCancel={() => {
        if (timer.current) clearTimeout(timer.current);
        setState('none');
      }}
      onSignIn={() => {
        setState('requesting');
        timer.current = setTimeout(() => {
          setState('waiting');
          timer.current = setTimeout(() => setState('connected'), 1500);
        }, 500);
      }}
      onSignOut={() => setState('none')}
    />
  );
}

const TONES: ToneDownload[] = [
  {
    id: 'a',
    name: 'Overdrive special',
    caption: 'NAM A2 · Standard · Jane Capture',
    status: 'got',
  },
  {
    id: 'b',
    name: 'High gain lead',
    caption: 'NAM · Standard · Studio Pack',
    status: 'ready',
  },
  {
    id: 'c',
    name: 'Deluxe reverb',
    caption: 'NAM · Feather · Porch Tones',
    status: 'ready',
  },
];

/** Stands in for the device: downloads one by one; the first try of one fails. */
export function GetTonesDemo({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [tones, setTones] = React.useState(TONES);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearInterval(timer.current)),
    [],
  );
  const run = (retry: boolean) => {
    const queue = tones
      .filter((t) => (retry ? t.status === 'failed' : t.status === 'ready'))
      .map((t) => t.id);
    setTones((all) =>
      all.map((t) =>
        queue.includes(t.id)
          ? { ...t, status: 'waiting', error: undefined }
          : t,
      ),
    );
    let n = 0;
    timer.current = setInterval(() => {
      const id = queue[n];
      const previous = queue[n - 1];
      setTones((all) =>
        all.map((t) => {
          if (t.id === previous)
            return !retry && t.id === 'b'
              ? {
                  ...t,
                  status: 'failed',
                  error: {
                    message: 'TONE3000 is busy right now.',
                    details:
                      'HTTP 503 · service_unavailable · GET /api/v1/tones/b/model',
                  },
                }
              : { ...t, status: 'done' };
          if (t.id === id) return { ...t, status: 'downloading', progress: 60 };
          return t;
        }),
      );
      n += 1;
      if (n > queue.length && timer.current) clearInterval(timer.current);
    }, 500);
  };
  return (
    <GetTones
      open={open}
      onOpenChange={onOpenChange}
      tones={tones}
      onDownload={() => run(false)}
      onRetry={() => run(true)}
    />
  );
}
