import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { EvenOut, LevelMatch, SoundCheck } from './guitar-tools';

/** Guitars: what to fix next, level match one preset, even out all of them. */
const meta: Meta = {
  title: 'Patterns/Guitar tools',
  parameters: { layout: 'padded' },
};
export default meta;

export const FixNext: StoryObj = {
  name: 'Sound check, fix next',
  render: () => <SoundCheck />,
};

export const MatchOne: StoryObj = {
  name: 'Level match a preset',
  render: () => <LevelMatch />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole('button', { name: 'Start listening' }),
    );
    await userEvent.click(
      await canvas.findByRole('button', { name: 'Keep' }, { timeout: 4000 }),
    );
    await expect(canvas.getByRole('status')).toHaveTextContent(
      'Output level kept',
    );
  },
};

export const EvenAll: StoryObj = {
  name: 'Even out all presets',
  render: () => <EvenOut />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText(/Loudest to quietest: 9\.5 dB/),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Even out all' }));
    await expect(
      await canvas.findByText(
        /Loudest to quietest: 0\.8 dB/,
        {},
        { timeout: 4000 },
      ),
    ).toBeVisible();
  },
};
