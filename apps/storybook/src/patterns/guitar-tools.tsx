import * as React from 'react';
import { CheckCircle, Warning } from '@phosphor-icons/react';
import { Button } from '../components/ui/button';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { Progress } from '../components/ui/states';
import { Caption } from '../components/ui/text';

/** Runs a fake measurement: progress 0–100 over `ms`, then done. */
function useMeasure(ms: number) {
  const [progress, setProgress] = React.useState<number | null>(null);
  const [done, setDone] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(
    () => () => void (timer.current && clearInterval(timer.current)),
    [],
  );
  const start = () => {
    let p = 0;
    setDone(false);
    setProgress(0);
    timer.current = setInterval(() => {
      p += 10;
      if (p <= 100) return setProgress(p);
      if (timer.current) clearInterval(timer.current);
      setProgress(null);
      setDone(true);
    }, ms / 10);
  };
  return { progress, done, start, reset: () => setDone(false) };
}

const CHECKS = [
  {
    ok: false,
    title: 'Input peaks at −3 dBFS',
    fix: 'Turn the interface gain down a little; aim for −12 when you play hard.',
    action: 'Show input meter',
  },
  {
    ok: false,
    title: 'Lead boost clips twice a minute',
    fix: "Lower that preset's Level by about 2 dB.",
    action: 'Open Lead boost',
  },
  {
    ok: true,
    title: 'No dropouts in the last hour',
    fix: '128 × 3 at 48 kHz is holding.',
    action: undefined,
  },
  {
    ok: true,
    title: 'Presets are within 1.5 dB of each other',
    fix: 'Even out ran on Monday.',
    action: undefined,
  },
];

/** Sound check: what to fix next, most useful first, each with one action. */
export function SoundCheck() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sound check</CardTitle>
        <Caption as="span" className="text-xs">
          Most useful first
        </Caption>
      </CardHeader>
      <ul aria-label="Fix next" className="m-0 grid list-none gap-0 p-0">
        {CHECKS.map((c) => (
          <li
            key={c.title}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-border py-2 first:border-t-0"
          >
            {c.ok ? (
              <CheckCircle aria-label="Fine" className="size-5" />
            ) : (
              <Warning aria-label="Fix" className="size-5 text-brand" />
            )}
            <span className="grid gap-0.5">
              <span className="text-sm font-medium">{c.title}</span>
              <Caption as="span" className="text-xs">
                {c.fix}
              </Caption>
            </span>
            {c.action ? (
              <Button size="sm" variant="outline">
                {c.action}
              </Button>
            ) : (
              <span />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Level match this preset: play normally for eight seconds; the preset's own
 * Output level is then set so it sits at the shared reference loudness.
 * Saved with the preset when you save.
 */
export function LevelMatch({ preset = 'Rhythm section' }: { preset?: string }) {
  const m = useMeasure(1600);
  const [kept, setKept] = React.useState<boolean | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Level match</CardTitle>
        <Caption as="span" className="text-xs">
          {preset}
        </Caption>
      </CardHeader>
      {m.progress === null && !m.done && (
        <div className="grid gap-2">
          <Caption>
            Play the way you normally do for eight seconds. Oxidal sets this
            preset's Output level to the shared loudness.
          </Caption>
          <Button
            className="justify-self-start"
            onClick={() => (setKept(null), m.start())}
          >
            Start listening
          </Button>
          {kept !== null && (
            <Caption role="status">
              {kept
                ? 'Output level kept. Save the preset to keep it for good.'
                : 'Back to how it was.'}
            </Caption>
          )}
        </div>
      )}
      {m.progress !== null && (
        <div role="status" className="grid gap-1.5">
          <span className="text-sm">Listening… keep playing.</span>
          <Progress value={m.progress} label="Listening" />
        </div>
      )}
      {m.done && (
        <div className="grid gap-2">
          <dl className="m-0 grid grid-cols-3 gap-2 text-sm">
            {[
              ['Before', '−13.8 LUFS'],
              ['Target', '−18.0 LUFS'],
              ['Output level', '−4.2 dB'],
            ].map(([k, v]) => (
              <div
                key={k}
                className="grid gap-0.5 rounded-lg border border-border px-3 py-2"
              >
                <dt className="small-caps text-xs text-muted-foreground">
                  {k}
                </dt>
                <dd className="m-0 font-mono tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2">
            <Button onClick={() => (setKept(true), m.reset())}>Keep</Button>
            <Button
              variant="outline"
              onClick={() => (setKept(false), m.reset())}
            >
              Undo
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

const PRESETS = [
  ['Rhythm section', -18.2, -18.0],
  ['Ambient swell', -22.9, -18.3],
  ['Lead boost', -13.4, -17.6],
  ['Brown Crunch', -16.1, -18.1],
  ['Neon Clean', -21.0, -18.4],
] as const;

/**
 * Even out all: every preset and scene to the same loudness so switching
 * never jumps. Corrections are bounded (±6 dB); only new or changed presets
 * are measured again.
 */
export function EvenOut() {
  const m = useMeasure(2000);
  const after = m.done;
  const spread = (i: 1 | 2) => {
    const v = PRESETS.map((p) => p[i]);
    return (Math.max(...v) - Math.min(...v)).toFixed(1);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Even out all</CardTitle>
        <Caption as="span" className="text-xs">
          Loudest to quietest: {after ? spread(2) : spread(1)} dB
        </Caption>
      </CardHeader>
      <ul
        aria-label="Preset loudness"
        className="m-0 grid list-none gap-1.5 p-0"
      >
        {PRESETS.map(([name, before, fixed]) => {
          const v = after ? fixed : before;
          return (
            <li
              key={name}
              className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-center gap-2 text-sm"
            >
              <span className="truncate">{name}</span>
              <span
                aria-hidden="true"
                className="relative h-2 rounded-full bg-wire/30"
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-full bg-foreground transition-[width] duration-300"
                  style={{ width: `${((v + 30) / 20) * 100}%` }}
                />
                <span
                  className="absolute inset-y-[-3px] w-0.5 bg-brand"
                  style={{ left: `${((-18 + 30) / 20) * 100}%` }}
                />
              </span>
              <span className="font-mono text-xs tabular-nums">
                {v.toFixed(1)}
              </span>
            </li>
          );
        })}
      </ul>
      {m.progress !== null && (
        <Progress value={m.progress} label="Measuring presets" />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={m.progress !== null} onClick={m.start}>
          {after ? 'Even out again' : 'Even out all'}
        </Button>
        <Caption as="span" role="status" className="text-xs">
          {m.progress !== null
            ? 'Measuring 5 presets and 14 scenes…'
            : after
              ? 'Done. Corrections stay within ±6 dB; the oxide line is the target.'
              : 'The oxide line is the shared loudness, −18 LUFS.'}
        </Caption>
      </div>
    </Card>
  );
}
