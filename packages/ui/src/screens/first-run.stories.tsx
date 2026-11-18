import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { FirstRun } from '../patterns/first-run';

/** The first time Oxidal opens: five steps, Wi-Fi first. */
const meta: Meta = {
  title: 'Screens/First run',
  parameters: { layout: 'fullscreen' },
};
export default meta;

export const FiveSteps: StoryObj = {
  name: 'Five steps to a first sound',
  render: () => <FirstRun />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Put Oxidal on your Wi-Fi')).toBeVisible();
    for (const b of canvas.getAllByRole('button', { name: /^Do it/ }))
      await userEvent.click(b);
    await expect(
      canvas.getByRole('button', { name: 'Start playing' }),
    ).toBeVisible();
  },
};
