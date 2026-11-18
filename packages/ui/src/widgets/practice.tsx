import * as React from 'react';

import { Button } from '../components/ui/button';
import { NumberField } from '../components/ui/number-field';
import { Segment, SegmentedControl } from '../components/ui/segmented';
import { Slider } from '../components/ui/slider';
import { Caption, Eyebrow } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';
import { cn } from '../lib/cn';
import { formatTime } from '../lib/time';

const SPEEDS = [50, 75, 100, 125, 150];

/** A steady, made-up waveform: louder in the choruses. */

/**
 * Practice tools in the backing player: the waveform (tap to move the
 * playhead, drag to choose a loop), A–B loop, speed that keeps the pitch,
 * and a click that follows the song's own beats or a steady tempo.
 */
export type PracticeState = {
  /** Seconds. */
  position: number;
  loop: { a: number; b: number } | null;
  looping: boolean;
  /** Percent of normal speed; pitch stays. */
  speed: number;
  click: boolean;
  /** The click follows the song's beats, or a steady tempo. */
  timing: 'beats' | 'steady';
  /** Beats per minute of the steady click. */
  steady: number;
  /** Click level in dB. */
  level: number;
};

export function PracticePanel({
  duration,
  waveform,
  position: initial = 0,
  bpm,
  onChange,
  className,
}: {
  /** Seconds. */
  duration: number;
  /** Peak heights from 0 to 1, evenly spread across the song. */
  waveform: number[];
  position?: number;
  /** Tempo found in the song, or undefined when uncertain. */
  bpm?: number;
  /** Everything the player engine needs to follow, on every change. */
  onChange?: (state: PracticeState) => void;
  className?: string;
}) {
  const bars = waveform;
  const [position, setPosition] = React.useState(initial);
  const [loop, setLoop] = React.useState<{ a: number; b: number } | null>(null);
  const [looping, setLooping] = React.useState(false);
  const [speed, setSpeed] = React.useState('100');
  const [tempo, setTempo] = React.useState(bpm);
  const [click, setClick] = React.useState(false);
  const [timing, setTiming] = React.useState('beats');
  const [steady, setSteady] = React.useState(bpm ?? 120);
  const [level, setLevel] = React.useState(-12);
  const report = React.useRef(onChange);
  React.useEffect(() => {
    report.current = onChange;
  }, [onChange]);
  React.useEffect(() => {
    report.current?.({
      position,
      loop,
      looping,
      speed: Number(speed),
      click,
      timing: timing === 'steady' ? 'steady' : 'beats',
      steady,
      level,
    });
  }, [position, loop, looping, speed, click, timing, steady, level]);
  const wave = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<number | null>(null);

  const at = (event: React.PointerEvent) => {
    const box = wave.current!.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(duration, ((event.clientX - box.left) / box.width) * duration),
    );
  };
  const pct = (t: number) => `${(t / duration) * 100}%`;

  return (
    <section
      data-slot="practice"
      aria-labelledby="practice-title"
      className={cn('grid gap-3', className)}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Eyebrow id="practice-title">Practice</Eyebrow>
        <span className="flex items-center gap-1 text-sm">
          <Caption as="span">
            {tempo ? `Found about ${Math.round(tempo)} BPM` : 'Tempo uncertain'}
          </Caption>
          {tempo && (
            <>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`½× · use half: ${Math.round(tempo / 2)} BPM`}
                onClick={() => setTempo(tempo / 2)}
              >
                ½×
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`2× · use double: ${Math.round(tempo * 2)} BPM`}
                onClick={() => setTempo(tempo * 2)}
              >
                2×
              </Button>
            </>
          )}
        </span>
      </div>

      <div
        ref={wave}
        role="slider"
        tabIndex={0}
        aria-label="Waveform. Tap to move the playhead, drag to choose a loop."
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={formatTime(position)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight')
            setPosition((p) => Math.min(duration, p + 5));
          if (e.key === 'ArrowLeft') setPosition((p) => Math.max(0, p - 5));
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = at(e);
          setPosition(drag.current);
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const t = at(e);
          if (Math.abs(t - drag.current) > duration / 100) {
            setLoop({
              a: Math.min(drag.current, t),
              b: Math.max(drag.current, t),
            });
            setLooping(true);
          }
        }}
        onPointerUp={() => (drag.current = null)}
        className="relative flex h-20 touch-none items-center gap-px rounded-lg border border-border bg-background px-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {loop && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-y-0 border-x-2 border-foreground',
              looping ? 'bg-foreground/10' : 'border-dashed',
            )}
            style={{ left: pct(loop.a), width: pct(loop.b - loop.a) }}
          />
        )}
        {bars.map((h, i) => (
          <span
            key={i}
            aria-hidden="true"
            className={cn(
              'flex-1 rounded-full',
              (i / bars.length) * duration < position
                ? 'bg-foreground'
                : 'bg-wire',
            )}
            style={{ height: `${h * 100}%` }}
          />
        ))}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 w-0.5 bg-brand"
          style={{ left: pct(position) }}
        />
      </div>
      <div className="flex justify-between font-mono text-xs text-muted-foreground tabular-nums">
        <span>{formatTime(position)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      <div
        role="group"
        aria-label="A–B loop"
        className="flex flex-wrap items-center gap-2"
      >
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setLoop((l) => ({
              a: position,
              b: Math.max(position + 4, l?.b ?? position + 16),
            }))
          }
        >
          Set A
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!loop}
          onClick={() =>
            setLoop((l) => (l ? { a: l.a, b: Math.max(l.a + 1, position) } : l))
          }
        >
          Set B
        </Button>
        <Toggle
          size="sm"
          pressed={looping}
          disabled={!loop}
          onPressedChange={setLooping}
        >
          Loop
        </Toggle>
        {loop && (
          <>
            <Caption as="span" className="font-mono text-xs tabular-nums">
              {formatTime(loop.a)} – {formatTime(loop.b)}
            </Caption>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => (setLoop(null), setLooping(false))}
            >
              Clear
            </Button>
          </>
        )}
      </div>

      <div className="grid gap-1">
        <span className="small-caps text-xs text-muted-foreground">
          Speed · keeps the pitch
        </span>
        <SegmentedControl
          size="sm"
          value={speed}
          onValueChange={setSpeed}
          aria-label="Playback speed"
        >
          {SPEEDS.map((p) => (
            <Segment
              key={p}
              value={String(p)}
              aria-label={`${p / 100} times speed`}
            >
              {p / 100}×
            </Segment>
          ))}
        </SegmentedControl>
      </div>

      <div
        role="group"
        aria-label="Click"
        className="grid gap-2 border-t border-border pt-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Toggle size="sm" pressed={click} onPressedChange={setClick}>
            Click
          </Toggle>
          <SegmentedControl
            size="sm"
            value={timing}
            onValueChange={setTiming}
            aria-label="Click timing"
            disabled={!click}
          >
            <Segment value="beats">Follow the song</Segment>
            <Segment value="steady">Steady tempo</Segment>
          </SegmentedControl>
          {click && timing === 'steady' && (
            <div className="w-28">
              <NumberField
                label="Click BPM"
                value={steady}
                min={40}
                max={240}
                step={1}
                digits={0}
                unit="BPM"
                onChange={setSteady}
              />
            </div>
          )}
          {click && (
            <Button size="sm" variant="ghost" onClick={() => {}}>
              First beat here
            </Button>
          )}
        </div>
        {click && (
          <Slider
            label="Click level"
            min={-40}
            max={0}
            step={1}
            value={[level]}
            onValueChange={([v]) => v !== undefined && setLevel(v)}
            readout={`${level} dB`}
          />
        )}
      </div>
    </section>
  );
}
