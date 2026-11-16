import { useEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Caption } from '../components/ui/text';
import { Meter, StereoMeter } from './meter';
import { PresetStepper } from './preset-step';
import { ResourceStrip } from './resource-strip';
import { ScenePads } from './scene-pad';
import { TunerFace } from './tuner-face';

/**
 * Instrument widgets: the parts of the stage and the Levels page that the
 * product drew four different ways. One drawing each, in every state.
 */
const meta: Meta = {
  title: 'Widgets/Meter, scenes, preset, strip, tuner',
  parameters: { layout: 'padded' },
};
export default meta;

function LiveMeter() {
  const [value, setValue] = useState(-18);
  const [peak, setPeak] = useState(-12);
  useEffect(() => {
    const timer = setInterval(() => {
      const next = -30 + Math.random() * 28;
      setValue(next);
      setPeak((held) => Math.max(held - 0.8, next));
    }, 120);
    return () => clearInterval(timer);
  }, []);
  return <Meter label="Output" value={value} peak={peak} />;
}

export const Meters: StoryObj = {
  render: () => (
    <div className="grid max-w-md gap-6">
      <LiveMeter />
      <Meter label="Input" value={-3.2} peak={-0.4} />
      <Meter label="Output" value={-1} peak={0} clipped />
      <Meter label="Input" value={-18} state="stale" />
      <Meter label="Output" value={null} state="stopped" />
      <Meter label="Input" value={null} state="unavailable" />
      <StereoMeter label="Master" left={-8} right={-11} peaks={[-4, -6]} />
      <div className="flex h-40 gap-6">
        <Meter label="In" value={-12} peak={-6} orientation="vertical" />
        <Meter label="Out" value={-2} peak={0} clipped orientation="vertical" />
        <StereoMeter
          label="Master"
          left={-8}
          right={-11}
          orientation="vertical"
        />
      </div>
      <Caption>
        −60 to 0 dBFS; the last 6 dB are drawn in the wire colour; a clip holds
        an oxide mark. Stale, stopped and unavailable are said in words.
      </Caption>
    </div>
  ),
};

function Scenes({ size }: { size: 'md' | 'lg' }) {
  const [active, setActive] = useState('b');
  const [fading, setFading] = useState(false);
  return (
    <ScenePads
      size={size}
      scenes={[
        { id: 'a', name: 'Clean' },
        { id: 'b', name: 'Crunch' },
        { id: 'c', name: 'Lead with delay' },
        { id: 'd', name: 'Ambient swell into the chorus' },
      ]}
      active={active}
      fading={fading}
      onSelect={(id) => {
        setActive(id);
        setFading(true);
        setTimeout(() => setFading(false), 600);
      }}
      onMenu={() => {}}
    />
  );
}

export const ScenePadGrid: StoryObj = {
  name: 'Scene pads',
  render: () => (
    <div className="grid max-w-2xl gap-6">
      <Scenes size="md" />
      <Scenes size="lg" />
      <Caption>
        Tap to change; long-press for the scene menu. The fading edge shows
        while the change settles.
      </Caption>
    </div>
  ),
};

function Stepper({ size }: { size: 'md' | 'lg' }) {
  const names = [
    'Rhythm section',
    'Ambient swell',
    'Lead boost',
    'Northern Lights (rehearsal)',
  ];
  const [index, setIndex] = useState(1);
  return (
    <PresetStepper
      size={size}
      name={names[index]!}
      position={index + 1}
      count={names.length}
      list="Friday set"
      unsaved={index === 1}
      onPrevious={() => setIndex((i) => Math.max(0, i - 1))}
      onNext={() => setIndex((i) => Math.min(names.length - 1, i + 1))}
    />
  );
}

export const PresetStepping: StoryObj = {
  name: 'Preset stepper',
  render: () => (
    <div className="grid max-w-2xl gap-8">
      <Stepper size="lg" />
      <Stepper size="md" />
    </div>
  ),
};

export const Strip: StoryObj = {
  name: 'Resource strip',
  parameters: { layout: 'fullscreen' },
  render: () => (
    <div className="grid gap-4">
      <ResourceStrip
        readings={{
          dsp: { p95: 0.42, peak: 0.61 },
          cpu: 37,
          ram: { used: 2300, total: 8192 },
          xruns: 0,
          clips: 0,
          temperature: 58,
        }}
      />
      <ResourceStrip
        readings={{
          dsp: { p95: 0.78, peak: 0.93 },
          cpu: 81,
          ram: { used: 6100, total: 8192 },
          xruns: 3,
          clips: 1,
          temperature: 77,
        }}
      />
      <ResourceStrip
        state="stale"
        readings={{
          dsp: { p95: 0.4, peak: 0.5 },
          cpu: 30,
          ram: { used: 2000, total: 8192 },
          xruns: 0,
          clips: 0,
        }}
      />
      <ResourceStrip state="stopped" readings={{}} />
      <ResourceStrip state="disconnected" readings={{}} />
    </div>
  ),
};

function Tuning({ day, size }: { day?: boolean; size?: 'md' | 'lg' }) {
  const [cents, setCents] = useState(-14);
  useEffect(() => {
    const timer = setInterval(
      () => setCents((c) => (Math.abs(c) < 1 ? -14 : c * 0.82)),
      160,
    );
    return () => clearInterval(timer);
  }, []);
  return (
    <TunerFace
      note={69}
      cents={cents}
      frequency={440 * Math.pow(2, cents / 1200)}
      day={day}
      size={size}
    />
  );
}

export const Tuner: StoryObj = {
  render: () => (
    <div className="grid max-w-2xl gap-6">
      <Tuning />
      <TunerFace note={40} cents={-32} frequency={81} />
      <TunerFace note={null} cents={0} />
      <Tuning day />
    </div>
  ),
};

export const TunerStage: StoryObj = {
  name: 'Tuner on stage',
  parameters: { layout: 'fullscreen' },
  render: () => <Tuning size="lg" />,
};
