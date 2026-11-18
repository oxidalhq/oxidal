import type { Meta, StoryObj } from '@storybook/react-vite';
import { Caption, Eyebrow, Label, Readout, Title } from './text';

const meta: Meta = {
  title: 'Components/Text styles',
  parameters: { layout: 'padded' },
};
export default meta;

export const All: StoryObj = {
  render: () => (
    <div className="grid max-w-xl gap-6">
      <div className="grid gap-1">
        <Eyebrow>Playing</Eyebrow>
        <Title>Rhythm section</Title>
        <Caption>Scene 2 · Crunch · unsaved edits</Caption>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="gain">Gain</Label>
        <Readout id="gain" size="lg">
          6.5
        </Readout>
        <Caption>Drag to adjust, arrow keys for fine steps</Caption>
      </div>
      <div className="grid grid-cols-4 items-end gap-4">
        <Readout size="sm">48 × 3</Readout>
        <Readout>6 ms</Readout>
        <Readout size="lg">−12.0 dB</Readout>
        <Readout size="display">120</Readout>
      </div>
    </div>
  ),
};

export const SmallCaps: StoryObj = {
  name: 'Small caps, the label voice',
  render: () => (
    <div className="grid max-w-xl gap-5">
      <div className="grid gap-1">
        <Eyebrow>Library</Eyebrow>
        <Title>Backing tracks</Title>
      </div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 gap-y-1 border-b border-border pb-1">
        <Eyebrow as="span" className="text-xs">
          Song
        </Eyebrow>
        <Eyebrow as="span" className="text-xs">
          Length
        </Eyebrow>
        <Eyebrow as="span" className="text-xs">
          Stems
        </Eyebrow>
      </div>
      <div className="flex flex-wrap gap-2">
        {['Amp', 'Cab', 'Pedal', 'Time', 'Mod'].map((kind) => (
          <span
            key={kind}
            className="rounded-full border border-border px-2 py-0.5 small-caps text-sm"
          >
            {kind}
          </span>
        ))}
      </div>
      <Caption>
        Small caps replace uppercase everywhere: eyebrows, section and table
        heads, block categories, chips and navigation. They read as labels at a
        glance and stay calm beside the preset name, as on Livtra's and Agent
        Zero's pages.
      </Caption>
    </div>
  ),
};

export const OnTheFaceplate: StoryObj = {
  render: () => (
    <div className="grid gap-1 rounded-lg bg-enclosure p-6 text-enclosure-foreground">
      <Eyebrow className="text-enclosure-foreground/70">Tuner</Eyebrow>
      <Readout size="display" className="text-enclosure-foreground">
        A 440
      </Readout>
      <Caption className="text-enclosure-foreground/70">
        +2 cents · steady
      </Caption>
    </div>
  ),
};
