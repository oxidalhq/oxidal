import { CheckCircle } from '@phosphor-icons/react';
import * as React from 'react';

import { Button } from '../components/ui/button';
import { Caption, Eyebrow, Title } from '../components/ui/text';

const STEPS = [
  {
    title: 'Put Oxidal on your Wi-Fi',
    why: 'So it is at oxidal.local after every restart. Until then you reach it on its own hotspot.',
    where: 'Settings › Network',
  },
  {
    title: 'Connect your audio interface',
    why: 'Choose the interface and let Oxidal find a buffer that plays without dropouts.',
    where: 'Settings › Audio',
  },
  {
    title: 'Set your input level',
    why: 'Play your loudest chord once; Oxidal sets the trim for that guitar.',
    where: 'Guitars › Input level',
  },
  {
    title: 'Pair your foot controller',
    why: 'Press each switch so Oxidal learns it. Skip this if you have none.',
    where: 'Settings › MIDI',
  },
  {
    title: 'Get a tone',
    why: 'Try a finished Oxidal sound, or get a capture from TONE3000.',
    where: 'Library › Oxidal sounds or TONE3000',
  },
] as const;

/**
 * The first time Oxidal opens: five steps to a first sound, each saying why
 * it matters and where it lives afterwards. Wi-Fi is first, because without
 * it the device is only reachable on its own hotspot after a restart. Every
 * step can be skipped.
 */
export function FirstRun({
  onDone,
  onStep,
}: {
  onDone?: () => void;
  /** A step's "Do it": where to take the player, such as "Settings › MIDI". */
  onStep?: (where: string) => void;
}) {
  const [done, setDone] = React.useState<Set<number>>(new Set());
  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-page py-8">
      <div className="grid gap-3">
        <img
          src="/brand/wordmark.svg"
          alt="Oxidal"
          className="h-6 w-auto justify-self-start"
        />
        <div className="grid gap-1">
          <Title size="lg">Welcome. Let's get you playing.</Title>
          <Caption>
            Five steps, about five minutes. Skip any of them; each lives in its
            own place too.
          </Caption>
        </div>
      </div>
      <section aria-labelledby="steps-title" className="grid gap-2">
        <Eyebrow id="steps-title">Five steps to your first sound</Eyebrow>
        <ol className="m-0 grid list-none gap-1.5 p-0">
          {STEPS.map((step, i) => (
            <li
              key={step.title}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5"
            >
              {done.has(i) ? (
                <CheckCircle
                  weight="fill"
                  aria-label="Done"
                  className="size-7"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid size-7 place-items-center rounded-full border border-foreground font-mono text-sm font-semibold"
                >
                  {i + 1}
                </span>
              )}
              <span className="grid gap-0.5">
                <span className="text-sm font-semibold">{step.title}</span>
                <Caption as="span" className="text-xs">
                  {step.why}
                </Caption>
                <span className="small-caps text-2xs text-muted-foreground">
                  {step.where}
                </span>
              </span>
              <Button
                size="sm"
                variant={done.has(i) ? 'ghost' : 'outline'}
                aria-label={`${done.has(i) ? 'Done' : 'Do it'}: ${step.title}`}
                onClick={() => {
                  setDone((d) => new Set(d).add(i));
                  onStep?.(step.where);
                }}
              >
                {done.has(i) ? 'Done' : 'Do it'}
              </Button>
            </li>
          ))}
        </ol>
      </section>
      <Button className="justify-self-end" onClick={onDone}>
        {done.size === STEPS.length ? 'Start playing' : 'Skip to the rig'}
      </Button>
    </div>
  );
}
