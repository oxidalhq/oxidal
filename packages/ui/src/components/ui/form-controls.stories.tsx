import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from './button';
import { Checkbox } from './checkbox';
import { ActionRow, FormField, FormGrid } from './form-layout';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from './select';
import { Switch } from './switch';
import { Caption, Label } from './text';

/**
 * Switch: a setting that stays. Checkbox: some of many, or one
 * acknowledgement. Select: one of many. Each sits in a labelled row that is
 * a touch target high.
 */
const meta: Meta = {
  title: 'Components/Switch, checkbox, select',
  parameters: { layout: 'padded' },
};
export default meta;

function Row({
  id,
  label,
  caption,
  children,
}: {
  id: string;
  label: string;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-touch grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 border-b border-border py-1">
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        {caption && <Caption className="text-xs">{caption}</Caption>}
      </div>
      {children}
    </div>
  );
}

export const Switches: StoryObj = {
  render: () => (
    <div className="grid max-w-md">
      <Row id="protect" label="Protect" caption="Stops edits from the stage">
        <Switch id="protect" defaultChecked />
      </Row>
      <Row id="awake" label="Keep screen awake">
        <Switch id="awake" />
      </Row>
      <Row id="boot" label="Play on boot" caption="Unavailable without audio">
        <Switch id="boot" disabled />
      </Row>
    </div>
  ),
};

export const Checkboxes: StoryObj = {
  render: () => (
    <div className="grid max-w-md">
      {['Vocals', 'Drums', 'Bass', 'Guitar'].map((stem, index) => (
        <Row key={stem} id={stem} label={stem}>
          <Checkbox id={stem} defaultChecked={index < 2} />
        </Row>
      ))}
      <Row id="all" label="All stems">
        <Checkbox id="all" checked="indeterminate" />
      </Row>
    </div>
  ),
};

export const Selects: StoryObj = {
  render: () => (
    <div className="grid max-w-md gap-4">
      <div className="grid gap-1">
        <Label htmlFor="device">Audio device</Label>
        <Select defaultValue="jogg">
          <SelectTrigger id="device">
            <SelectValue placeholder="Choose a device" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>USB</SelectLabel>
              <SelectItem value="jogg">Hotone Jogg</SelectItem>
              <SelectItem value="scarlett">Scarlett 2i2</SelectItem>
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>Other</SelectLabel>
              <SelectItem value="null" disabled>
                No device
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="rate">Sample rate</Label>
        <Select>
          <SelectTrigger id="rate" size="sm" className="w-40">
            <SelectValue placeholder="Choose" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="44100">44.1 kHz</SelectItem>
            <SelectItem value="48000">48 kHz</SelectItem>
            <SelectItem value="96000">96 kHz</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  ),
};

export const PresetDetails: StoryObj = {
  render: () => (
    <form onSubmit={(event) => event.preventDefault()}>
      <FormGrid>
        <FormField>
          Preset name
          <input name="preset" defaultValue="Clean amp" />
        </FormField>
        <FormField>
          Starting scene
          <select defaultValue="Clean">
            <option>Clean</option>
            <option>Lead</option>
          </select>
        </FormField>
      </FormGrid>
      <ActionRow>
        <Button type="submit">Save</Button>
        <Button type="reset" variant="outline">
          Reset
        </Button>
      </ActionRow>
    </form>
  ),
};
