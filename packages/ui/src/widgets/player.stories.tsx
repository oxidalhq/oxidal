import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

import { Caption } from '../components/ui/text';
import { type StemControls, StemMixer, type StemRole } from './stem-strip';
import { PositionBar, Transport, type TransportState } from './transport';

/** The backing player's parts: transport, position with A–B, and the stem strips. */
const meta: Meta = {
  title: 'Widgets/Transport, position, stems',
  parameters: { layout: 'padded' },
};
export default meta;

function Player() {
  const [state, setState] = useState<TransportState>('cued');
  const [position, setPosition] = useState(42);
  const [range, setRange] = useState<{ a: number; b: number } | null>({
    a: 60,
    b: 92,
  });
  const [loop, setLoop] = useState(true);
  const [click, setClick] = useState(false);
  const duration = 222;
  useEffect(() => {
    if (state !== 'playing') return;
    const timer = setInterval(
      () =>
        setPosition((p) => {
          const next = p + 0.25;
          if (loop && range && next > range.b) return range.a;
          return next >= duration ? 0 : next;
        }),
      250,
    );
    return () => clearInterval(timer);
  }, [state, loop, range]);
  const beats = Array.from(
    { length: Math.floor((duration * 118) / 60) },
    (_, i) => (i * 60) / 118,
  );
  return (
    <div className="grid max-w-2xl gap-4">
      <Transport
        state={state}
        onPlay={() => setState('playing')}
        onPause={() => setState('paused')}
        onStop={() => {
          setState('cued');
          setPosition(0);
        }}
        onPrevious={() => setPosition(0)}
        onNext={() => setPosition(duration - 10)}
        loop={loop}
        onLoop={(on) => {
          setLoop(on);
          if (!on) setRange(null);
          else setRange({ a: 60, b: 92 });
        }}
        click={click}
        onClick={setClick}
        speed={1}
        onSpeed={() => {}}
      />
      <PositionBar
        position={position}
        duration={duration}
        beats={beats}
        range={loop ? range : null}
        onSeek={setPosition}
        onRange={setRange}
      />
      <Transport
        compact
        state={state}
        onPlay={() => setState('playing')}
        onPause={() => setState('paused')}
      />
      <Transport
        state="stopped"
        onPlay={() => {}}
        onPause={() => {}}
        onStop={() => {}}
      />
      <Caption>
        Drag the oxide handles to set the section; Shift+arrows nudge them from
        the keyboard.
      </Caption>
    </div>
  );
}

export const Playback: StoryObj = {
  name: 'Transport and position',
  render: () => <Player />,
};

function Stems() {
  const [stems, setStems] = useState<Partial<Record<StemRole, StemControls>>>({
    vocals: { level: -60, muted: true, solo: false },
    drums: { level: 0, muted: false, solo: false },
    bass: { level: -2, muted: false, solo: false },
    guitar: { level: -12, muted: false, solo: false },
    piano: { level: -4, muted: false, solo: false },
    other: { level: -3, muted: false, solo: false },
  });
  return (
    <div className="grid gap-3">
      <StemMixer
        stems={stems}
        onChange={(role, next) => setStems((all) => ({ ...all, [role]: next }))}
      />
      <Caption>
        Mute silences one stem; Solo silences the others. A stem you cannot hear
        is dimmed.
      </Caption>
    </div>
  );
}

export const StemStrips: StoryObj = {
  name: 'Stem mixer',
  render: () => <Stems />,
};
