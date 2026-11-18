import type { Meta, StoryObj } from '@storybook/react-vite';
import { useRef, useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';

import { Combobox, type ComboboxOption } from './combobox';
import { NumberField, RelativeAdjustment } from './number-field';
import { InlineFader, Slider } from './slider';
import { Caption, Label } from './text';

/**
 * Values: NumberField when the number matters (drag it, or type it),
 * Slider when the position matters, vertical sliders as faders, Combobox
 * to find one of many by typing.
 */
const meta: Meta = {
  title: 'Components/Number field, slider, combobox',
  parameters: { layout: 'padded' },
};
export default meta;

function NumberFields() {
  const [gain, setGain] = useState(6.5);
  const [level, setLevel] = useState(-12);
  const [tempo, setTempo] = useState(120);
  return (
    <div className="grid max-w-md gap-4">
      <div className="flex items-center justify-between">
        <Label>Gain</Label>
        <NumberField
          label="Gain"
          value={gain}
          onChange={setGain}
          min={0}
          max={10}
          step={0.5}
          fine={0.1}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label>Level</Label>
        <NumberField
          label="Level"
          value={level}
          onChange={setLevel}
          min={-60}
          max={12}
          step={1}
          fine={0.1}
          unit="dB"
        />
      </div>
      <div className="flex items-center justify-between">
        <Label>Tempo</Label>
        <NumberField
          label="Tempo"
          value={tempo}
          onChange={setTempo}
          min={40}
          max={240}
          step={1}
          fine={0.5}
          unit="BPM"
          digits={0}
          size="lg"
        />
      </div>
      <div className="flex items-center justify-between">
        <Label>Disabled</Label>
        <NumberField
          label="Disabled"
          value={3}
          onChange={() => {}}
          size="sm"
          disabled
        />
      </div>
      <Caption>
        Drag up or right to raise; Shift for fine steps; tap to type; arrow keys
        step.
      </Caption>
    </div>
  );
}

export const NumberFields_: StoryObj = {
  name: 'Number field',
  render: () => <NumberFields />,
};

function Sliders() {
  const [gain, setGain] = useState([65]);
  const [master, setMaster] = useState([80]);
  return (
    <div className="grid max-w-md gap-6">
      <Slider
        label="Gain"
        value={gain}
        onValueChange={setGain}
        readout={(gain[0]! / 10).toFixed(1)}
        max={100}
      />
      <Slider
        label="Master"
        value={master}
        onValueChange={setMaster}
        readout={`${(master[0]! - 100) / 2} dB`}
        live
      />
      <Slider label="Disabled" defaultValue={[30]} readout="3.0" disabled />
    </div>
  );
}

export const Sliders_: StoryObj = { name: 'Slider', render: () => <Sliders /> };

function InlineFaderDemo() {
  const [value, setValue] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const starting = useRef(0.5);
  return (
    <div className="grid max-w-md grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3">
      <Label>Gain</Label>
      <NumberField
        label="Gain"
        value={value}
        onChange={setValue}
        min={0}
        max={1}
        step={0.01}
        fine={0.001}
        digits={2}
      />
      <InlineFader
        value={value}
        dragging={dragging}
        disabled={false}
        onBegin={(next) => {
          starting.current = value;
          setDragging(true);
          setValue(next);
        }}
        onMove={setValue}
        onEnd={(cancel) => {
          if (cancel) setValue(starting.current);
          setDragging(false);
        }}
      />
    </div>
  );
}

export const InlineFader_: StoryObj = {
  name: 'Inline fader with exact entry',
  render: () => <InlineFaderDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const fader = canvasElement.querySelector<HTMLElement>(
      '[data-slot=inline-fader]',
    )!;
    const box = fader.getBoundingClientRect();
    await userEvent.pointer([
      {
        keys: '[MouseLeft>]',
        target: fader,
        coords: {
          clientX: box.left + box.width / 4,
          clientY: box.top + box.height / 2,
        },
      },
      {
        target: fader,
        coords: {
          clientX: box.left + (box.width * 3) / 4,
          clientY: box.top + box.height / 2,
        },
      },
      { keys: '[/MouseLeft]', target: fader },
    ]);
    await expect(canvas.getByRole('slider', { name: 'Gain' })).toHaveAttribute(
      'aria-valuenow',
      '0.75',
    );
  },
};

export const Faders: StoryObj = {
  render: () => (
    <div className="flex h-64 gap-4">
      {['Vocals', 'Drums', 'Bass', 'Guitar', 'Other'].map((stem, index) => (
        <Slider
          key={stem}
          orientation="vertical"
          label={stem}
          defaultValue={[70 - index * 10]}
          readout={`${((70 - index * 10 - 100) / 2).toFixed(0)}`}
        />
      ))}
    </div>
  ),
};

const MODELS: ComboboxOption[] = [
  { value: 'plexi', label: 'Plexi 50', caption: 'Amp · NAM A2 · 48 kHz' },
  { value: 'jcm', label: 'JCM 800 crunch', caption: 'Amp · NAM · 48 kHz' },
  { value: 'ac30', label: 'AC30 top boost', caption: 'Amp · NAM A2 · 48 kHz' },
  { value: 'twin', label: 'Twin clean', caption: 'Amp · NAM · 44.1 kHz' },
  { value: 'bass', label: 'B15 bass', caption: 'Amp · NAM · 48 kHz' },
  {
    value: 'broken',
    label: 'Rectifier (unavailable)',
    caption: 'Needs 96 kHz',
    disabled: true,
  },
];

function Comboboxes() {
  const [model, setModel] = useState<string | null>('plexi');
  return (
    <div className="grid max-w-md gap-2">
      <Label htmlFor="model">Model</Label>
      <Combobox
        id="model"
        label="Model"
        options={MODELS}
        value={model}
        onChange={setModel}
        placeholder="Search models…"
      />
      <Caption>{model ? `Chosen: ${model}` : 'Nothing chosen'}</Caption>
    </div>
  );
}

export const Comboboxes_: StoryObj = {
  name: 'Combobox',
  render: () => <Comboboxes />,
};

Comboboxes_.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const field = canvas.getByRole('combobox', { name: 'Model' });
  await userEvent.click(field);
  await userEvent.type(field, 'twin');
  await userEvent.keyboard('{Enter}');
  await expect(await canvas.findByText('Chosen: twin')).toBeVisible();
};

NumberFields_.play = async ({ canvasElement }) => {
  const gain = within(canvasElement).getByRole('slider', { name: 'Gain' });
  gain.focus();
  await userEvent.keyboard('{ArrowUp}{ArrowUp}');
  await expect(gain).toHaveAttribute('aria-valuenow', '7.5');
};

function RelativeField() {
  const [value, setValue] = useState(0.5);
  return (
    <RelativeAdjustment
      label="Gain"
      value={value}
      baseline={0.5}
      min={0}
      max={1}
      step={0.01}
      disabled={false}
      onChange={setValue}
      format={(value) => `${Math.round(value * 100)}%`}
      commitHint="Done keeps the owned preview. Cancel restores the sound."
    />
  );
}

export const RelativeTouch: StoryObj = {
  name: 'Relative touch adjustment with Fine and restore',
  render: () => <RelativeField />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Increase Gain' }),
    );
    await expect(
      canvas.getByRole('slider', { name: 'Adjust Gain' }),
    ).toHaveAttribute('aria-valuenow', '0.51');
    await userEvent.click(
      canvas.getByRole('button', { name: 'Restore starting value' }),
    );
    await expect(
      canvas.getByRole('slider', { name: 'Adjust Gain' }),
    ).toHaveAttribute('aria-valuenow', '0.5');
  },
};
