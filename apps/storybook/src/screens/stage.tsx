import { useEffect, useState } from 'react';
import { MusicNote, SpeakerHigh } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Meter } from '@/widgets/meter';
import { PresetStepper } from '@/widgets/preset-step';
import { ScenePads } from '@/widgets/scene-pad';
import { Transport, PositionBar } from '@/widgets/transport';
import { SCENES } from '@/patterns/rig.fixtures';

const NAMES = ['Rhythm section', 'Ambient swell', 'Lead boost', 'Brown Crunch'];

/**
 * The stage (Perform): the preset name as big as the screen allows, the
 * previous/next steps, the scenes, the edge meters, Boost and Tuner, and
 * the backing player's transport along the bottom. Nothing here needs a
 * second look; every control is stage size.
 */
export function Stage() {
  const [index, setIndex] = useState(0);
  const [scene, setScene] = useState<string | null>('b');
  const [boost, setBoost] = useState(false);
  const [state, setState] = useState<'cued' | 'playing' | 'paused'>('playing');
  const [position, setPosition] = useState(42);
  const [levels, setLevels] = useState({ i: -18, o: -9 });
  useEffect(() => {
    const timer = setInterval(() => {
      setLevels({ i: -30 + Math.random() * 22, o: -20 + Math.random() * 18 });
      if (state === 'playing') setPosition((p) => (p + 0.25) % 222);
    }, 250);
    return () => clearInterval(timer);
  }, [state]);
  return (
    <div
      data-slot="stage"
      className="grid min-h-[calc(100dvh-7rem)] grid-rows-[minmax(0,1fr)_auto_auto] gap-6 px-page py-4"
    >
      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] gap-4">
        <Meter
          label="In"
          value={levels.i}
          peak={levels.i + 3}
          orientation="vertical"
          showValue={false}
        />
        <div className="grid content-center gap-8">
          <PresetStepper
            size="lg"
            name={NAMES[index]!}
            position={index + 1}
            count={NAMES.length}
            list="Friday set"
            onPrevious={() => setIndex((i) => Math.max(0, i - 1))}
            onNext={() => setIndex((i) => Math.min(NAMES.length - 1, i + 1))}
          />
          <ScenePads
            size="lg"
            scenes={SCENES}
            active={scene}
            onSelect={setScene}
          />
        </div>
        <Meter
          label="Out"
          value={levels.o}
          peak={levels.o + 2}
          orientation="vertical"
          showValue={false}
        />
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Toggle
          size="lg"
          pressed={boost}
          onPressedChange={setBoost}
          aria-label="Boost"
        >
          <SpeakerHigh /> Boost {boost ? '+3 dB' : ''}
        </Toggle>
        <Button size="lg" variant="outline">
          <MusicNote /> Tuner
        </Button>
      </div>
      <div className="grid gap-3 rounded-lg border border-border bg-card p-3 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-6">
        <Transport
          state={state}
          onPlay={() => setState('playing')}
          onPause={() => setState('paused')}
          onStop={() => {
            setState('cued');
            setPosition(0);
          }}
          onPrevious={() => setPosition(0)}
          onNext={() => setPosition(200)}
          loop={false}
          onLoop={() => {}}
          click={false}
          onClick={() => {}}
        />
        <div className="grid gap-1">
          <span className="truncate text-sm font-medium">
            Iron Pulse · 118 BPM
          </span>
          <PositionBar
            position={position}
            duration={222}
            onSeek={setPosition}
          />
        </div>
      </div>
    </div>
  );
}
