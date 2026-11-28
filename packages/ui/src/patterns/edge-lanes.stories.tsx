import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from '../components/ui/button';
import { GuitarSelector } from '../widgets/guitar-selector';
import { OutputLevelControl } from '../widgets/output-level-control';
import { type EdgeFigure, EdgeLanes } from './edge-lanes';

/**
 * The lanes along the chain's edges: IN on the left (the guitar, input peak,
 * calibration, the foot controller), OUT on the right (the output level,
 * DSP, CPU, xruns, clips). Meters rest at 60 % until a signal comes
 * through; figures are faint while you play and step aside when the lanes
 * are too narrow.
 */
const meta: Meta = {
  title: 'Patterns/Edge lanes',
  parameters: { layout: 'fullscreen' },
};
export default meta;

const GUITARS = [
  { id: 'telecaster', name: 'Telecaster', trim_db: -6 },
  { id: 'les-paul', name: 'Les Paul', trim_db: -9 },
];

function Lanes({
  inputLevel,
  outputLevel,
  playing = true,
  stopped = false,
  attention = false,
  width,
}: {
  inputLevel: number | null;
  outputLevel: number | null;
  playing?: boolean;
  stopped?: boolean;
  attention?: boolean;
  width?: number;
}) {
  const [guitar, setGuitar] = useState('telecaster');
  const [level, setLevel] = useState(-6);
  const [mono, setMono] = useState(false);
  const left: EdgeFigure[] = [
    { label: 'Input', value: '−12 dBFS' },
    attention
      ? { label: 'Calibration', value: 'Not set', attention: true }
      : { label: 'Calibrated', value: '−12 dBu' },
    {
      label: 'MIDI',
      value: 'Chocolate',
      light: 'on',
      title: 'Chocolate connected. Open Settings › MIDI',
      onOpen: () => undefined,
    },
  ];
  const right: EdgeFigure[] = [
    { label: 'DSP', value: attention ? '86%' : '31%', attention },
    { label: 'CPU', value: '18%' },
    { label: 'Xruns', value: '0' },
    { label: 'Clips', value: '0' },
    ...(attention
      ? [{ label: 'Temp', value: '81 °C', attention: true } as EdgeFigure]
      : []),
  ];
  return (
    <div
      className="relative h-[28rem] border-b border-border bg-background"
      style={width ? { width } : undefined}
    >
      <EdgeLanes
        stopped={stopped}
        playing={playing}
        input={{
          level: inputLevel,
          peak: inputLevel == null ? null : inputLevel + 4,
          figures: left,
          control: (
            <GuitarSelector
              guitars={GUITARS}
              active={guitar}
              onSelect={setGuitar}
            />
          ),
        }}
        output={{
          level: outputLevel,
          peak: outputLevel == null ? null : outputLevel + 3,
          figures: right,
          control: (
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
          ),
        }}
      />
    </div>
  );
}

export const Playing: StoryObj = {
  name: 'Playing: meters forward, figures faint',
  render: () => <Lanes inputLevel={-16} outputLevel={-10} />,
};

export const Silent: StoryObj = {
  name: 'Silent: meters rest at 60 %',
  render: () => <Lanes inputLevel={null} outputLevel={null} playing={false} />,
};

export const Attention: StoryObj = {
  name: 'Needs attention: calibration, DSP and temperature light up',
  render: () => <Lanes inputLevel={-16} outputLevel={-10} attention />,
};

export const Narrow: StoryObj = {
  name: 'Narrow: the figures step aside',
  render: () => <Lanes inputLevel={-16} outputLevel={-10} width={760} />,
};

export const Stopped: StoryObj = {
  name: 'Audio stopped',
  render: () => <Lanes inputLevel={null} outputLevel={null} stopped />,
};
