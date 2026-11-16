import * as React from 'react';
import { CheckCircle, Circle } from '@phosphor-icons/react';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Caption, Eyebrow, Title } from '../components/ui/text';

const FROM = [
  {
    id: 'helix',
    name: 'Helix',
    words: [
      ['Snapshots', 'Scenes'],
      ['Presets', 'Presets'],
      ['Paths A and B', 'Splits with branches, as many as you like'],
    ],
  },
  {
    id: 'qc',
    name: 'Quad Cortex',
    words: [
      ['Scenes', 'Scenes'],
      ['Rows 1–4', 'Branches of a split'],
      ['Captures', 'NAM captures, from your files or TONE3000'],
    ],
  },
  {
    id: 'fractal',
    name: 'Fractal',
    words: [
      ['Scenes', 'Scenes'],
      ['Channels', 'Versions of a block, or a scene that changes it'],
      ['Grid', 'The route: blocks, splits and joins'],
    ],
  },
  {
    id: 'kemper',
    name: 'Kemper',
    words: [
      ['Profiles', 'NAM captures'],
      ['Performances', 'A set list entry'],
      ['Slots', 'Scenes'],
    ],
  },
  {
    id: 'headrush',
    name: 'HeadRush',
    words: [
      ['Rigs', 'Presets'],
      ['Stomp mode', 'A stomp-box layout on your controller'],
      ['Hotswap', 'Change… on any block'],
    ],
  },
  {
    id: 'new',
    name: 'New to modellers',
    words: [
      ['Preset', 'A whole sound: amp, cab and effects'],
      ['Scene', 'A variation inside it, switched with no gap'],
      ['Capture', 'A recording of a real amp or pedal'],
    ],
  },
] as const;

const STEPS = [
  ['Connect your interface', 'Settings › Audio'],
  ['Set your input level', 'Guitars › Input level'],
  ['Pair your foot controller', 'Settings › MIDI'],
  ['Get a tone', 'Library › Oxidal sounds or TONE3000'],
] as const;

/**
 * The first time Oxidal opens: where you are coming from (so the words
 * match what you know), then four steps to your first sound. Every step
 * can be skipped and found again in its own place.
 */
export function FirstRun({ onDone }: { onDone?: () => void }) {
  const [from, setFrom] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<Set<number>>(new Set());
  const unit = FROM.find((f) => f.id === from);
  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-page py-8">
      <div className="grid gap-1">
        <img
          src="/brand/wordmark.svg"
          alt="Oxidal"
          className="h-6 w-auto justify-self-start"
        />
        <Title size="lg">Welcome. Let's get you playing.</Title>
        <Caption>
          About five minutes. Skip anything; each step lives in its own place
          too.
        </Caption>
      </div>
      <section aria-labelledby="from-title" className="grid gap-2">
        <Eyebrow id="from-title">What have you played through before?</Eyebrow>
        <div
          role="radiogroup"
          aria-label="What have you played through before?"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        >
          {FROM.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={from === f.id}
              onClick={() => setFrom(f.id)}
              className="min-h-touch rounded-lg border border-input px-3 py-2 text-sm font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring aria-checked:border-foreground aria-checked:bg-foreground aria-checked:text-background"
            >
              {f.name}
            </button>
          ))}
        </div>
        {unit && (
          <Card>
            <dl
              aria-label={`${unit.name} words in Oxidal`}
              className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm"
            >
              {unit.words.map(([theirs, ours]) => (
                <div key={theirs} className="contents">
                  <dt className="font-semibold">{theirs}</dt>
                  <dd className="m-0">{ours}</dd>
                </div>
              ))}
            </dl>
          </Card>
        )}
      </section>
      <section aria-labelledby="steps-title" className="grid gap-2">
        <Eyebrow id="steps-title">Four steps to your first sound</Eyebrow>
        <ol className="m-0 grid list-none gap-1.5 p-0">
          {STEPS.map(([title, where], i) => (
            <li
              key={title}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-card px-3 py-2"
            >
              {done.has(i) ? (
                <CheckCircle aria-label="Done" className="size-5" />
              ) : (
                <Circle
                  aria-label="To do"
                  className="size-5 text-muted-foreground"
                />
              )}
              <span className="grid">
                <span className="text-sm font-semibold">{title}</span>
                <Caption as="span" className="text-xs">
                  {where}
                </Caption>
              </span>
              <Button
                size="sm"
                variant={done.has(i) ? 'ghost' : 'outline'}
                onClick={() => setDone((d) => new Set(d).add(i))}
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
