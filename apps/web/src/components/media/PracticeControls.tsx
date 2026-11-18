/**
 * Practice tools in the backing player: waveform seek, an A–B loop, playback
 * speed that keeps pitch, and a click that follows the song.
 *
 * @see docs/media.md#song-preparation-and-practice-timing
 */
import { Metronome, Repeat, Waveform } from '@phosphor-icons/react';
import { type PointerEvent, useEffect, useRef, useState } from 'react';

import { Button } from '@oxidal/design-system/components/button';
import { Switch } from '@oxidal/design-system/components/switch';

import './media.css';
import { type PracticeTiming, practiceTiming } from '../../api';
import type { PlayerCommand } from '../../generated/contract';
import { deviceSentence } from '../../lib/friendlyError';
import { clock, tapTempo } from '../../lib/playerClock';
import { Slider } from '../ui/slider';
import { ToggleGroup, ToggleGroupItem } from '../ui/toggle-group';
import { usePlayerPosition, useProtect, useSessionMedia } from './sessionMedia';

type ClickCommand = Extract<PlayerCommand, { kind: 'set_click' }>['click'];
const SPEEDS = [50, 75, 100, 125, 150];
const WIDTH = 240;
/** Shortest loop the reader handles cleanly, in seconds. */
const MIN_LOOP = 0.25;

export function PracticeControls() {
  const { player, send, pending, slow } = useSessionMedia();
  const { at } = usePlayerPosition();
  const protect = useProtect();
  const track = player?.track;
  const id = track?.id;
  const [timing, setTiming] = useState<PracticeTiming | null>(null);
  const [local, setLocal] = useState<{ a: number; b: number | null } | null>(
    player?.range ?? null,
  );
  const click = player?.click ?? null;
  const [bpm, setBpm] = useState(
    click?.kind === 'manual' ? click.bpm_tenths / 10 : 120,
  );
  const [first, setFirst] = useState(
    click?.kind === 'manual' ? click.first_frame : 0,
  );
  const [level, setLevel] = useState(click?.level_db ?? -12);
  const [follow, setFollow] = useState(
    click ? click.kind === 'detected' : true,
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const taps = useRef<number[]>([]);
  const drag = useRef<number | null>(null);
  const [dragging, setDragging] = useState<{ from: number; to: number } | null>(
    null,
  );

  useEffect(() => {
    if (!id) return;
    let active = true;
    void practiceTiming(id).then(
      (value) => {
        if (active) setTiming(value);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [id]);

  if (!track || !player) return null;
  const { rate, frames } = track;
  const atFrame = Math.min(frames, Math.max(0, Math.round(at * rate)));
  const active = player.range ?? null;
  const shown = active ?? local;
  const minFrames = Math.round(MIN_LOOP * rate);
  const valid = (a: number, b: number | null): b is number =>
    b !== null && a >= 0 && b <= frames && b - a >= minFrames;
  const hasBeats = !!timing?.beats.length;
  const usesBeats = follow && hasBeats;
  const speed = player.speedPercent ?? 100;

  function setRange(a: number, b: number | null) {
    setLocal({ a, b });
    if (active && valid(a, b))
      void send({ kind: 'set_practice_range', range: { a, b } });
  }
  function setA() {
    const b = shown?.b ?? null;
    setRange(atFrame, b !== null && b - atFrame >= minFrames ? b : null);
  }
  function setB() {
    const a = shown?.a ?? 0;
    if (atFrame - a >= minFrames) setRange(a, atFrame);
    else setError('B must come after A. Move the playhead later, then Set B.');
  }
  function toggleLoop() {
    setError('');
    if (active) {
      setLocal(active);
      void send({ kind: 'set_practice_range', range: null });
    } else if (shown && valid(shown.a, shown.b))
      void send({
        kind: 'set_practice_range',
        range: { a: shown.a, b: shown.b },
      });
  }
  function clearLoop() {
    setLocal(null);
    if (active) void send({ kind: 'set_practice_range', range: null });
  }

  function clickSettings(
    next: Partial<{
      bpm: number;
      first: number;
      level: number;
      follow: boolean;
    }> = {},
  ): ClickCommand {
    const values = { bpm, first, level, follow, ...next };
    return values.follow && hasBeats && timing
      ? { kind: 'detected', timing: timing.source, level_db: values.level }
      : {
          kind: 'manual',
          bpm_tenths: Math.round(Math.min(300, Math.max(30, values.bpm)) * 10),
          first_frame: values.first,
          level_db: values.level,
        };
  }
  /** While the click is on, every change is sent at once. */
  function updateClick(next: Parameters<typeof clickSettings>[0] = {}) {
    if (click) void send({ kind: 'set_click', click: clickSettings(next) });
  }

  async function analyse() {
    if (!id) return;
    setWorking(true);
    setError('');
    try {
      const result = await practiceTiming(id, true);
      setTiming(result);
      if (result?.bpm != null) setBpm(result.bpm);
      setFollow(!!result?.beats.length);
    } catch (cause) {
      setError(deviceSentence(cause, 'analyse the song'));
    } finally {
      setWorking(false);
    }
  }

  /** Half- or double-time correction: a steady click from the first beat. */
  function retempo(factor: number) {
    if (timing?.bpm == null) return;
    const tempo = Math.round(timing.bpm * factor * 10) / 10;
    if (tempo < 30 || tempo > 300) {
      setError('That tempo is outside 30 to 300 BPM.');
      return;
    }
    const start = timing.beats[0] ?? first;
    setBpm(tempo);
    setFirst(start);
    setFollow(false);
    updateClick({ bpm: tempo, first: start, follow: false });
  }

  function tap() {
    const now = performance.now();
    taps.current = [...taps.current.slice(-5), now];
    const tempo = tapTempo(taps.current);
    if (tempo !== null && tempo >= 30 && tempo <= 300) {
      setBpm(tempo);
      setFollow(false);
      updateClick({ bpm: tempo, follow: false });
    }
  }

  function framesAt(event: PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return 0;
    return Math.round(
      Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)) * frames,
    );
  }
  const x = (frame: number) => (frame / frames) * WIDTH;
  const preview = dragging
    ? {
        a: Math.min(dragging.from, dragging.to),
        b: Math.max(dragging.from, dragging.to),
      }
    : null;
  const region = preview ?? (shown && shown.b !== null ? shown : null);

  return (
    <section className="practice" aria-labelledby="practice-title">
      <div className="stem-section-head">
        <h3 id="practice-title">Practice</h3>
        {timing && (
          <span className="practice-tempo">
            <span className="caption">
              {timing.bpm == null
                ? 'Tempo uncertain'
                : `Found about ${Math.round(timing.bpm)} BPM`}
            </span>
            {timing.bpm != null && (
              <>
                <Button
                  variant="ghost"
                  className="practice-octave"
                  aria-label={`Use half: ${Math.round(timing.bpm / 2)} BPM`}
                  title="The song feels half as fast"
                  onClick={() => retempo(0.5)}
                >
                  ½×
                </Button>
                <Button
                  variant="ghost"
                  className="practice-octave"
                  aria-label={`Use double: ${Math.round(timing.bpm * 2)} BPM`}
                  title="The song feels twice as fast"
                  onClick={() => retempo(2)}
                >
                  2×
                </Button>
              </>
            )}
          </span>
        )}
      </div>

      {timing?.peaks.length ? (
        <svg
          className="practice-wave"
          viewBox={`0 0 ${WIDTH} 32`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Waveform. Tap to move the playhead, drag to choose a loop.${
            region && region.b !== null
              ? ` Loop ${clock(region.a / rate)} to ${clock(region.b / rate)}.`
              : ''
          }`}
          onPointerDown={(event) => {
            if (slow) return;
            const from = framesAt(event);
            drag.current = from;
            setDragging({ from, to: from });
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const from = drag.current;
            if (from !== null) setDragging({ from, to: framesAt(event) });
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragging(null);
          }}
          onPointerUp={(event) => {
            const start = drag.current;
            const end = framesAt(event);
            drag.current = null;
            setDragging(null);
            if (start === null) return;
            if (Math.abs(start - end) >= minFrames)
              setRange(Math.min(start, end), Math.max(start, end));
            else void send({ kind: 'seek_to', frame: end });
          }}
        >
          {region && region.b !== null && (
            <rect
              className="practice-region"
              data-active={active ? '' : undefined}
              x={x(region.a)}
              y={0}
              height={32}
              width={x(region.b) - x(region.a)}
            />
          )}
          {timing.peaks.map((peak, index) => (
            <line
              key={index}
              className="practice-peak"
              x1={index + 0.5}
              x2={index + 0.5}
              y1={16 - peak * 15}
              y2={16 + peak * 15}
            />
          ))}
          {usesBeats &&
            timing.beats.map((beat) => (
              <line
                key={beat}
                className="practice-beat"
                x1={(beat / timing.frames) * WIDTH}
                x2={(beat / timing.frames) * WIDTH}
                y1={30}
                y2={32}
              />
            ))}
          <line
            className="practice-head"
            x1={x(atFrame)}
            x2={x(atFrame)}
            y1={0}
            y2={32}
          />
        </svg>
      ) : (
        <Button
          variant="outline"
          disabled={protect || working}
          onClick={() => void analyse()}
        >
          <Waveform aria-hidden="true" />
          {working ? 'Analysing…' : 'Show waveform and find the tempo'}
        </Button>
      )}

      <div className="practice-row" role="group" aria-label="A–B loop">
        <Button variant="outline" disabled={pending} onClick={setA}>
          Set A
          <span className="media-mono caption">
            {shown ? clock(shown.a / rate) : '–'}
          </span>
        </Button>
        <Button variant="outline" disabled={pending} onClick={setB}>
          Set B
          <span className="media-mono caption">
            {shown?.b != null ? clock(shown.b / rate) : '–'}
          </span>
        </Button>
        <Button
          variant="outline"
          aria-pressed={!!active}
          disabled={pending || (!active && !(shown && valid(shown.a, shown.b)))}
          onClick={toggleLoop}
        >
          <Repeat aria-hidden="true" />
          Loop A–B
        </Button>
        {shown && (
          <Button variant="ghost" disabled={pending} onClick={clearLoop}>
            Clear
          </Button>
        )}
      </div>

      <div className="practice-row">
        <span className="practice-label">Speed</span>
        <ToggleGroup
          type="single"
          aria-label="Playback speed"
          value={String(speed)}
          onValueChange={(value) => {
            if (value) void send({ kind: 'set_speed', percent: Number(value) });
          }}
        >
          {SPEEDS.map((percent) => (
            <ToggleGroupItem
              key={percent}
              value={String(percent)}
              disabled={pending}
              aria-label={`${percent / 100} times speed`}
            >
              {percent / 100}×
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="practice-click" role="group" aria-label="Click">
        <label className="practice-row">
          <Metronome aria-hidden="true" />
          <span className="practice-label">Click</span>
          <Switch
            aria-label="Click"
            checked={!!click}
            disabled={pending}
            onCheckedChange={(on) =>
              void send({
                kind: 'set_click',
                click: on ? clickSettings() : null,
              })
            }
          />
        </label>
        {hasBeats && (
          <ToggleGroup
            type="single"
            aria-label="Click timing"
            value={usesBeats ? 'beats' : 'steady'}
            onValueChange={(value) => {
              if (!value) return;
              setFollow(value === 'beats');
              updateClick({ follow: value === 'beats' });
            }}
          >
            <ToggleGroupItem value="beats">Follow the song</ToggleGroupItem>
            <ToggleGroupItem value="steady">Steady tempo</ToggleGroupItem>
          </ToggleGroup>
        )}
        {!usesBeats && (
          <div className="practice-row">
            <label className="practice-bpm">
              <span className="practice-label">BPM</span>
              <input
                type="number"
                inputMode="decimal"
                min={30}
                max={300}
                step={0.1}
                value={bpm}
                onChange={(event) => {
                  if (Number.isFinite(event.target.valueAsNumber))
                    setBpm(event.target.valueAsNumber);
                }}
                onBlur={() => updateClick()}
              />
            </label>
            <Button variant="outline" onClick={tap}>
              Tap
            </Button>
            <Button
              variant="outline"
              title="Make the playhead the first beat"
              onClick={() => {
                const frame = Math.min(frames - 1, atFrame);
                setFirst(frame);
                updateClick({ first: frame });
              }}
            >
              Beat 1 here
              <span className="media-mono caption">{clock(first / rate)}</span>
            </Button>
          </div>
        )}
        <div className="practice-row">
          <span className="practice-label">Click level</span>
          {slow ? (
            <>
              <Button
                variant="outline"
                size="icon"
                aria-label="Lower click"
                disabled={level <= -60}
                onClick={() => {
                  setLevel(level - 3);
                  updateClick({ level: level - 3 });
                }}
              >
                −
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Raise click"
                disabled={level >= 0}
                onClick={() => {
                  setLevel(level + 3);
                  updateClick({ level: level + 3 });
                }}
              >
                +
              </Button>
            </>
          ) : (
            <Slider
              className="practice-level"
              aria-label="Click level"
              min={-60}
              max={0}
              step={1}
              value={[level]}
              onValueChange={([value]) => setLevel(value ?? -12)}
              onValueCommit={([value]) => updateClick({ level: value ?? -12 })}
            />
          )}
          <output className="media-mono">{level} dB</output>
        </div>
        {!timing && !working && (
          <p className="caption">
            Find the tempo to show the waveform and let the click follow the
            song.
          </p>
        )}
        {timing && !hasBeats && (
          <Button
            variant="ghost"
            disabled={protect || working}
            onClick={() => void analyse()}
          >
            {working ? 'Analysing…' : 'Find the tempo again'}
          </Button>
        )}
      </div>
      {error && (
        <p className="caption" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
