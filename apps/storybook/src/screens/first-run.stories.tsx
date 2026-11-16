import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { FirstRun } from './first-run';

/** The first time Oxidal opens (R-8): your old unit's words, then four steps. */
const meta: Meta = {
  title: 'Screens/First run',
  parameters: { layout: 'fullscreen' },
};
export default meta;

export const FromKemper: StoryObj = {
  name: 'Coming from a Kemper',
  render: () => <FirstRun />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('radio', { name: 'Kemper' }));
    await expect(canvas.getByText('Performances')).toBeVisible();
    for (const b of canvas.getAllByRole('button', { name: 'Do it' }))
      await userEvent.click(b);
    await expect(
      canvas.getByRole('button', { name: 'Start playing' }),
    ).toBeVisible();
  },
};
