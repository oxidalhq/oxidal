import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';

import { FirstRun } from '../patterns/first-run';

/** The first time Oxidal opens: five steps, Wi-Fi first. */
const meta: Meta = {
  title: 'Screens/First run',
  parameters: { layout: 'fullscreen' },
};
export default meta;

export const FiveSteps: StoryObj<typeof FirstRun> = {
  name: 'Five steps to a first sound',
  args: { onStep: fn(), onDone: fn() },
  render: (args) => <FirstRun {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Put Oxidal on your Wi-Fi')).toBeVisible();
    await userEvent.click(
      canvas.getByRole('button', { name: 'Open: Put Oxidal on your Wi-Fi' }),
    );
    await expect(args.onStep).toHaveBeenCalledWith('settings/connections');
    await userEvent.click(canvas.getByRole('button', { name: 'Go to Rig' }));
    await expect(args.onDone).toHaveBeenCalledOnce();
  },
};
