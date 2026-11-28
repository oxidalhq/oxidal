import { Check } from '@phosphor-icons/react';

import { Button } from '../components/ui/button';
import { Caption, Eyebrow, Title } from '../components/ui/text';
import { cn } from '../lib/cn';

const STEPS = [
  {
    title: 'Put Oxidal on your Wi-Fi',
    why: 'Choose how to reach this device. Network settings show its current addresses, hotspot and certificate setup.',
    where: 'Settings › Network',
    route: 'settings/connections',
  },
  {
    title: 'Connect your audio interface',
    why: 'Choose the interface and let Oxidal find a buffer that plays without dropouts.',
    where: 'Settings › Audio',
    route: 'settings/audio',
  },
  {
    title: 'Set your input level',
    why: 'Choose your guitar, then check its input level while playing your loudest chord.',
    where: 'Guitars › Input level',
    route: 'guitars',
  },
  {
    title: 'Pair your foot controller',
    why: 'Press each switch so Oxidal learns it. Skip this if you have none.',
    where: 'Settings › MIDI',
    route: 'settings/midi',
  },
  {
    title: 'Get a tone',
    why: 'Try a finished Oxidal sound, or get a capture from TONE3000.',
    where: 'Library › Oxidal sounds or TONE3000',
    route: 'library/oxidal',
  },
] as const;

/**
 * The first time Oxidal opens: five steps to a first sound, each saying why
 * it matters and where it lives afterwards. Wi-Fi is first, because without
 * it the device is only reachable on its own hotspot after a restart. Every
 * step can be skipped.
 */
export type FirstRunRoute = (typeof STEPS)[number]['route'];

export function FirstRun({
  onDone,
  onStep,
  done = [],
  wordmark = true,
}: {
  onDone?: () => void;
  /** A step's "Do it": where to take the player, such as "Settings › MIDI". */
  onStep?: (route: FirstRunRoute) => void;
  /** Steps already done; the first one not done is the next step. */
  done?: readonly FirstRunRoute[];
  /** Leave out where the page header already shows it. */
  wordmark?: boolean;
}) {
  const next = STEPS.find((step) => !done.includes(step.route));
  const count = STEPS.filter((step) => done.includes(step.route)).length;
  return (
    <div className="mx-auto grid max-w-2xl gap-6 px-page py-8 max-md:py-5">
      <div className="grid gap-3">
        {wordmark && (
          <img
            src="/brand/wordmark.svg"
            alt="Oxidal"
            className="h-6 w-auto justify-self-start"
          />
        )}
        <div className="grid gap-1">
          <Title size="lg">Welcome. Let's get you playing.</Title>
          <Caption>
            Five steps, about five minutes. Skip any of them; each lives in its
            own place too.
          </Caption>
        </div>
      </div>
      <section aria-labelledby="steps-title" className="grid gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <Eyebrow id="steps-title">Five steps to your first sound</Eyebrow>
          <span className="font-mono text-sm text-muted-foreground tabular-nums">
            {count} of {STEPS.length} done
          </span>
        </div>
        <span
          aria-hidden="true"
          className="block h-1 overflow-hidden rounded-full bg-border"
        >
          <span
            className="block h-full bg-foreground transition-[width] duration-[var(--duration-base)]"
            style={{ width: `${(count / STEPS.length) * 100}%` }}
          />
        </span>
        <ol className="m-0 grid list-none divide-y divide-border p-0">
          {STEPS.map((step, i) => {
            const finished = done.includes(step.route);
            const current = next?.route === step.route;
            return (
              <li
                key={step.title}
                data-state={finished ? 'done' : current ? 'next' : 'to-do'}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-3',
                  current && '-mx-3 rounded-lg bg-accent px-3',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid size-7 place-items-center rounded-full font-mono text-sm font-semibold',
                    finished
                      ? 'bg-foreground text-background'
                      : current
                        ? 'border-2 border-foreground'
                        : 'border border-border text-muted-foreground',
                  )}
                >
                  {finished ? <Check className="size-4" /> : i + 1}
                </span>
                <span className="grid gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
                    {step.title}
                    {finished && (
                      <span className="small-caps text-xs font-medium text-muted-foreground">
                        Done
                      </span>
                    )}
                    {current && (
                      <span className="small-caps text-xs font-medium text-muted-foreground">
                        Next
                      </span>
                    )}
                  </span>
                  {!finished && (
                    <Caption as="span" className="text-xs">
                      {step.why}
                    </Caption>
                  )}
                  <span className="small-caps text-2xs text-muted-foreground">
                    {step.where}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant={current ? 'default' : 'ghost'}
                  aria-label={`Open: ${step.title}`}
                  onClick={() => onStep?.(step.route)}
                >
                  Open
                </Button>
              </li>
            );
          })}
        </ol>
      </section>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Caption as="span" className="mr-auto text-xs">
          You can come back to these from Settings › Before you play.
        </Caption>
        <Button
          size="sm"
          variant={next ? 'outline' : 'default'}
          onClick={onDone}
        >
          Go to Rig
        </Button>
      </div>
    </div>
  );
}
