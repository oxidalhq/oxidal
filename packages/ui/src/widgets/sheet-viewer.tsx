import {
  ArrowDown,
  ArrowUp,
  Minus,
  Pause,
  Play,
  Plus,
  TextAa,
} from '@phosphor-icons/react';
import * as React from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Caption, Eyebrow, Readout, Title } from '../components/ui/text';
import { Toggle } from '../components/ui/toggle';
import { cn } from '../lib/cn';
import {
  type ChordPart,
  hasChords,
  type Song,
  type SongLine,
} from '../lib/song';
import { useMotion } from '../lib/use-media';

/** Text sizes the player steps through with A− and A+, in rem. */
const SHEET_SIZES = [0.875, 1, 1.125, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
/** Auto-scroll speeds, 1 (slow) to 10 (fast), in pixels per second. */
const SPEED_PX = [0, 6, 9, 13, 18, 24, 31, 40, 50, 62, 76];

function Part({ part, chords }: { part: ChordPart; chords: boolean }) {
  if (!chords || !part.chord)
    return <span className="whitespace-pre-wrap">{part.text}</span>;
  return (
    <span className="inline-flex flex-col align-bottom">
      <span
        className="pr-1 font-mono text-[0.8em] leading-tight font-semibold whitespace-pre"
        data-chord=""
      >
        {part.chord}
      </span>
      <span className="whitespace-pre-wrap">{part.text || ' '}</span>
    </span>
  );
}

function Line({ line, chords }: { line: SongLine; chords: boolean }) {
  switch (line.kind) {
    case 'blank':
      return <div aria-hidden="true" className="h-[0.8em]" />;
    case 'section':
      return (
        <Eyebrow as="h3" className="m-0 mt-[0.6em] text-[0.7em]">
          {line.text}
        </Eyebrow>
      );
    case 'comment':
      return (
        <p className="m-0 text-[0.8em] text-muted-foreground italic">
          {line.text}
        </p>
      );
    case 'chords':
      return chords ? (
        <p
          data-chord-line=""
          className="m-0 font-mono text-[0.8em] leading-tight font-semibold whitespace-pre"
        >
          {line.text}
        </p>
      ) : null;
    case 'text':
      return <p className="m-0 whitespace-pre-wrap">{line.text}</p>;
    case 'lyric':
      return (
        <p className="m-0">
          {line.parts.map((part, i) => (
            <Part key={i} part={part} chords={chords} />
          ))}
        </p>
      );
  }
}

export type SheetMidiCommand = { presses: number; speed?: number };
export type SubscribeSheetMidi = (
  listener: (command: SheetMidiCommand) => void,
) => () => void;

/**
 * A lyrics and chord sheet, readable from the floor: the title in the
 * display face, the key, tempo and capo as small facts, sections as
 * small-caps labels, chords in bold mono above the words. A− and A+ step
 * the text size (remembered per song by the caller); auto-scroll moves the
 * sheet at the chosen speed and a tap on the words pauses or resumes it.
 * `stage` drops the header so the words fill the screen.
 */
export function SheetViewer({
  song,
  size = 3,
  onSize,
  speed = 4,
  onSpeed,
  linked,
  stage = false,
  initialScroll = 0,
  onScrollPosition,
  subscribeMidi,
  chordsVisible,
  onChordsVisible,
  className,
}: {
  song: Song;
  /** Index into SHEET_SIZES. */
  size?: number;
  onSize?: (size: number) => void;
  /** 1–10. */
  speed?: number;
  onSpeed?: (speed: number) => void;
  /** What the song is linked to, shown as badges ("Preset · Rhythm section"). */
  linked?: string[];
  stage?: boolean;
  /** Viewer-owned position retained when moving between sheet, float and pin. */
  initialScroll?: number;
  onScrollPosition?: (top: number) => void;
  subscribeMidi?: SubscribeSheetMidi;
  chordsVisible?: boolean;
  onChordsVisible?: (visible: boolean) => void;
  className?: string;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const initialPosition = React.useRef(initialScroll);
  React.useLayoutEffect(() => {
    const element = scroller.current;
    if (element) element.scrollTop = Math.max(0, initialPosition.current);
  }, []);
  const [scrolling, setScrolling] = React.useState(false);
  const [localChords, setLocalChords] = React.useState(true);
  const showChords = chordsVisible ?? localChords;
  const setShowChords = onChordsVisible ?? setLocalChords;
  const motion = useMotion();
  const [previousMotion, setPreviousMotion] = React.useState(motion);
  if (previousMotion !== motion) {
    setPreviousMotion(motion);
    if (!motion) setScrolling(false);
  }
  const chords = hasChords(song);

  React.useEffect(() => {
    if (!motion || !scrolling) return;
    let frame = 0;
    let last = performance.now();
    let carry = 0;
    const tick = (now: number) => {
      const element = scroller.current;
      if (!element) return;
      carry += ((now - last) / 1000) * (SPEED_PX[speed] ?? 18);
      last = now;
      const whole = Math.floor(carry);
      if (whole) {
        element.scrollTop += whole;
        carry -= whole;
      }
      if (
        element.scrollTop + element.clientHeight >=
        element.scrollHeight - 1
      ) {
        setScrolling(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [motion, scrolling, speed]);

  const stepPage = (direction: number) => {
    const element = scroller.current;
    if (!element) return;
    const overlap = Math.max(1, Math.floor(element.clientHeight * 0.9));
    element.scrollTop = Math.max(
      0,
      Math.min(
        element.scrollHeight - element.clientHeight,
        element.scrollTop + direction * overlap,
      ),
    );
  };
  React.useEffect(
    () =>
      subscribeMidi?.(({ presses, speed: requestedSpeed }) => {
        if (requestedSpeed !== undefined) onSpeed?.(requestedSpeed);
        if (!presses) return;
        if (!motion) stepPage(presses);
        else if (presses % 2) setScrolling((on) => !on);
      }),
    [subscribeMidi, motion, onSpeed],
  );

  const facts = [
    song.key && `Key ${song.key}`,
    song.tempo && `${song.tempo} BPM`,
    song.capo && `Capo ${song.capo}`,
  ].filter(Boolean) as string[];
  const setSize = (next: number) =>
    onSize?.(Math.max(0, Math.min(SHEET_SIZES.length - 1, next)));
  const setSpeed = (next: number) => onSpeed?.(Math.max(1, Math.min(10, next)));

  return (
    <section
      data-slot="sheet-viewer"
      data-stage={stage || undefined}
      aria-label={`${song.title} sheet`}
      className={cn(
        'grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-border bg-card',
        stage && 'rounded-none border-0 bg-background',
        className,
      )}
    >
      {!stage ? (
        <header className="grid gap-1 border-b border-border px-4 pt-3 pb-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <Title as="h2" size="md" className="min-w-0 truncate">
              {song.title}
            </Title>
            <div className="flex flex-wrap gap-1">
              {facts.map((fact) => (
                <Badge key={fact} size="sm">
                  {fact}
                </Badge>
              ))}
            </div>
          </div>
          {(song.artist || linked?.length) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {song.artist && <Caption as="span">{song.artist}</Caption>}
              {linked?.map((link) => (
                <Badge key={link} tone="selected" size="sm">
                  {link}
                </Badge>
              ))}
            </div>
          )}
        </header>
      ) : (
        <div className="sr-only">
          <h2>{song.title}</h2>
        </div>
      )}
      <div
        ref={scroller}
        onScroll={(event) => onScrollPosition?.(event.currentTarget.scrollTop)}
        tabIndex={0}
        role="document"
        aria-label={`${song.title} words${chords && showChords ? ' and chords' : ''}`}
        onClick={() => motion && setScrolling((on) => !on)}
        onWheel={() => scrolling && setScrolling(false)}
        onTouchStart={() => scrolling && setScrolling(false)}
        className="min-h-0 cursor-default overflow-y-auto px-4 py-4 leading-[1.45] [overflow-wrap:anywhere] outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        style={{ fontSize: `${SHEET_SIZES[size] ?? 1.25}rem` }}
      >
        <div className="grid max-w-[60ch] gap-[0.15em] pb-[40vh]">
          {song.lines.map((line, i) => (
            <Line key={i} line={line} chords={chords && showChords} />
          ))}
        </div>
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-raised px-3 py-2">
        <div
          role="group"
          aria-label="Text size"
          className="flex items-center gap-1"
        >
          <Button
            size="icon"
            variant="outline"
            aria-label="Smaller text"
            disabled={!onSize || size <= 0}
            onClick={() => setSize(size - 1)}
          >
            <TextAa className="scale-75" />
          </Button>
          <Readout size="sm" className="w-12 text-center">
            {Math.round((SHEET_SIZES[size] ?? 1) * 100)}%
          </Readout>
          <Button
            size="icon"
            variant="outline"
            aria-label="Bigger text"
            disabled={!onSize || size >= SHEET_SIZES.length - 1}
            onClick={() => setSize(size + 1)}
          >
            <TextAa className="scale-125" />
          </Button>
        </div>
        {chords && (
          <Toggle
            size="sm"
            pressed={showChords}
            onPressedChange={setShowChords}
          >
            Chords
          </Toggle>
        )}
        {!motion ? (
          <div
            role="group"
            aria-label="Page stepping"
            className="flex items-center gap-1"
          >
            <Button size="sm" variant="outline" onClick={() => stepPage(-1)}>
              <ArrowUp /> Previous page
            </Button>
            <Button size="sm" variant="outline" onClick={() => stepPage(1)}>
              <ArrowDown /> Next page
            </Button>
          </div>
        ) : (
          <div
            role="group"
            aria-label="Auto-scroll"
            className="flex items-center gap-1"
          >
            <Button
              size="icon"
              variant="outline"
              aria-label="Scroll slower"
              disabled={!onSpeed || speed <= 1}
              onClick={() => setSpeed(speed - 1)}
            >
              <Minus />
            </Button>
            <Button
              size="icon"
              variant={scrolling ? 'default' : 'outline'}
              aria-label={scrolling ? 'Pause scrolling' : 'Start scrolling'}
              aria-pressed={scrolling}
              onClick={() => setScrolling((on) => !on)}
            >
              {scrolling ? <Pause weight="fill" /> : <Play weight="fill" />}
            </Button>
            <Readout
              size="sm"
              className="w-8 text-center"
              aria-label={`Scroll speed ${speed} of 10`}
            >
              {speed}
            </Readout>
            <Button
              size="icon"
              variant="outline"
              aria-label="Scroll faster"
              disabled={!onSpeed || speed >= 10}
              onClick={() => setSpeed(speed + 1)}
            >
              <Plus />
            </Button>
          </div>
        )}
      </footer>
    </section>
  );
}
