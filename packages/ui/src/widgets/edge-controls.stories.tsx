import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Button } from '../components/ui/button';
import { GuitarSelector } from './guitar-selector';
import { MiniPlayer } from './mini-player';
import { OutputLevelControl } from './output-level-control';
import { StreamStatus } from './stream-status';

/**
 * The small controls around the chain: the guitar under IN, the output
 * level under OUT, the stream and engine in the chain bar's middle, and a
 * phone's now-playing strip.
 */
const meta: Meta = {
  title: 'Widgets/Edge controls',
  parameters: { layout: 'padded' },
};
export default meta;

const GUITARS = [
  { id: 'telecaster', name: 'Telecaster', trim_db: -6 },
  { id: 'les-paul', name: 'Les Paul', trim_db: -9 },
  { id: 'stratocaster', name: 'Stratocaster', trim_db: -4.5 },
];

export const Guitar: StoryObj = {
  name: 'Guitar under IN',
  render: function Render() {
    const [active, setActive] = useState<string | null>('telecaster');
    return (
      <div className="flex gap-6">
        <GuitarSelector
          guitars={GUITARS}
          active={active}
          onSelect={setActive}
          onManage={() => undefined}
        />
        <GuitarSelector guitars={[]} active={null} onSelect={() => {}} />
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: /Telecaster/ }));
    await userEvent.click(
      await body.findByRole('menuitem', { name: /Les Paul/ }),
    );
    await expect(
      canvas.getByRole('button', { name: /Les Paul.*−9 dB/ }),
    ).toBeInTheDocument();
  },
};

export const OutputLevel: StoryObj = {
  name: 'Output level under OUT',
  render: function Render() {
    const [level, setLevel] = useState(-6);
    const [mono, setMono] = useState(false);
    return (
      <div className="flex justify-end">
        <OutputLevelControl
          levelDb={level}
          onLevel={setLevel}
          mono={mono}
          onMono={setMono}
          boost={
            <Button size="sm" variant="outline">
              Boost +0.0 dB
            </Button>
          }
        />
      </div>
    );
  },
};

export const OutputLevelRefused: StoryObj = {
  name: 'Output level: a refused change',
  render: () => (
    <div className="flex justify-end">
      <OutputLevelControl
        levelDb={-6}
        onLevel={() => undefined}
        mono
        onMono={() => undefined}
        error="The unit did not take the new level. It is still at −6.0 dB."
      />
    </div>
  ),
};

export const Stream: StoryObj = {
  name: 'Stream and engine',
  render: () => (
    <div className="grid justify-items-start gap-3">
      <StreamStatus
        fit="full"
        stream={{ sample_rate: 48000, period_frames: 128, periods: 3 }}
        engine={{
          label: 'NAM Full A2 · 2×',
          details: [
            { label: 'Model size', value: 'Full · A2' },
            { label: 'Input calibration', value: '−12 dBu' },
            { label: 'Oversampling', value: '2×' },
          ],
        }}
        onRestartAudio={() => undefined}
        onAudioSettings={() => undefined}
        onEngineSettings={() => undefined}
      />
      <StreamStatus
        fit="full"
        stream={{ sample_rate: 44100, period_frames: 256, periods: 2 }}
      />
    </div>
  ),
};

export const NowPlaying: StoryObj = {
  name: 'Phone now-playing strip',
  globals: { viewport: { value: 'iphoneXr', isRotated: false } },
  render: function Render() {
    const [playing, setPlaying] = useState(true);
    return (
      <MiniPlayer
        title="Slow Burn"
        position="1:12"
        duration="3:42"
        progress={0.32}
        playing={playing}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onOpen={() => undefined}
        note="Splitting 64%"
      />
    );
  },
};
