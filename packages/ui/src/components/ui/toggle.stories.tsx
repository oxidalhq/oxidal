import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Repeat, SpeakerSlash, Metronome } from '@phosphor-icons/react';
import { Toggle, ToggleGroup, ToggleGroupItem } from './toggle';
import { SegmentedControl, Segment } from './segmented';

/**
 * Toggle: a state that stays until pressed again (bypass, mute, loop,
 * click). SegmentedControl: one of a few visible choices. Both invert ink
 * and paper for the active state, so they read in black and white.
 */
const meta: Meta = {
  title: 'Components/Toggle and segmented',
  parameters: { layout: 'padded' },
};
export default meta;

export const Toggles: StoryObj = {
  render: () => (
    <div className="flex flex-wrap items-center gap-3">
      <Toggle aria-label="Loop">
        <Repeat /> Loop
      </Toggle>
      <Toggle defaultPressed aria-label="Click">
        <Metronome /> Click
      </Toggle>
      <Toggle size="icon" aria-label="Mute">
        <SpeakerSlash />
      </Toggle>
      <Toggle size="sm">Bypass</Toggle>
      <Toggle size="lg" defaultPressed>
        Boost
      </Toggle>
      <Toggle disabled>Disabled</Toggle>
    </div>
  ),
};

export const MultipleToggles: StoryObj = {
  name: 'Toggle group (multiple)',
  render: () => (
    <ToggleGroup type="multiple" defaultValue={['vocals']} aria-label="Mute">
      {['Vocals', 'Drums', 'Bass', 'Guitar', 'Other'].map((stem) => (
        <ToggleGroupItem key={stem} value={stem.toLowerCase()} size="sm">
          {stem}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  ),
};

export const Segmented: StoryObj = {
  render: () => (
    <div className="grid max-w-md gap-4">
      <SegmentedControl defaultValue="list" aria-label="Library view">
        <Segment value="list">List</Segment>
        <Segment value="artwork">Artwork</Segment>
      </SegmentedControl>
      <SegmentedControl defaultValue="serial" aria-label="Rig layout">
        <Segment value="serial">Serial</Segment>
        <Segment value="parallel">Parallel</Segment>
        <Segment value="custom" disabled>
          Custom
        </Segment>
      </SegmentedControl>
      <SegmentedControl defaultValue="default" size="sm" aria-label="Display">
        <Segment value="default">Default</Segment>
        <Segment value="stage">Night</Segment>
        <Segment value="sunlight">Sunlight</Segment>
        <Segment value="epaper">E-paper</Segment>
      </SegmentedControl>
    </div>
  ),
};

Segmented.play = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const artwork = canvas.getByRole('radio', { name: 'Artwork' });
  await userEvent.click(artwork);
  await expect(artwork).toHaveAttribute('data-state', 'on');
  await userEvent.click(artwork);
  await expect(artwork).toHaveAttribute('data-state', 'on');
};
